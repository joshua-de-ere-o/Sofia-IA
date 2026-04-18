# Spec 09 — Pre-filtro de mensajes
## Sistema Sofía IA · Dra. Kely León · Quito, Ecuador

---

## 1. PROPÓSITO

El pre-filtro es la capa que decide qué mensajes llegan al agente Sofía y cuáles no.
Se ejecuta en `app/api/webhook/route.js` **antes** de invocar la Edge Function `agent-runner`.

Objetivo: proteger tokens, evitar respuestas del agente en chats personales de Kelly,
y garantizar que leads con intención real lleguen al agente con contexto.

Archivo principal: `lib/pre-filter.js`

---

## 2. ARQUITECTURA — 6 CAPAS EN ORDEN DE EJECUCIÓN

Cada capa se ejecuta en orden. Si una capa rechaza el mensaje, se detiene ahí.
El agente solo se invoca si el mensaje pasa todas las capas.

```
Mensaje entrante (YCloud webhook)
    ↓
L0 — Descartar eventos no-entrantes     [0 tokens, 0 DB]
    ↓
L1 — Blocklist / Whitelist              [0 tokens, 1 consulta DB]
    ↓
L2 — Handoff activo / Modo manual       [0 tokens, 1 consulta DB]
    ↓
L3 — Tipo de mensaje (non-text)         [0 tokens, 0 DB]
    ↓
L4 — Canned response con debounce      [0 tokens, lógica interna]
    ↓
L5 — Keywords spam                      [0 tokens, 0 DB]
    ↓
Agente Sofía
```

---

## 3. DETALLE DE CADA CAPA

### L0 — Descartar eventos no-entrantes

**Qué hace:** filtra todo lo que no sea un mensaje de texto nuevo enviado por un usuario externo.

YCloud envía múltiples tipos de eventos al webhook. Solo debe pasar `message.created` de un número externo.

**Condiciones de rechazo (descartar silenciosamente, sin responder):**
- `payload.message.from_me === true` → mensaje que Kelly envió desde WA Business
- `payload.type === 'message.updated'` → notificación de lectura o entrega (doble check)
- `payload.type !== 'message.created'` → cualquier evento que no sea mensaje nuevo

**Acción:** `return null` — no responder, no loggear como error, solo ignorar.

---

### L1 — Blocklist / Whitelist

**Qué hace:** bloquea números que nunca deben recibir respuesta de Sofía, y opcionalmente restringe a solo números permitidos.

Lee dos campos de la tabla `configuracion` en Supabase:
- `blocklist_numeros` → array de strings con números en formato E.164 (ej. `+593987654321`)
- `whitelist_activa` → boolean
- `whitelist_numeros` → array de strings

**Lógica (en este orden):**

```
1. ¿El número está en blocklist_numeros?
   SÍ → rechazar silenciosamente (no responder)
   NO → continuar

2. ¿whitelist_activa === true?
   SÍ → ¿El número está en whitelist_numeros?
         SÍ → continuar
         NO → rechazar silenciosamente
   NO → continuar
```

**Regla clave:** la blocklist siempre gana. Si un número está en ambas listas, se bloquea.

**Cómo se puebla la blocklist:** automáticamente cuando Kelly cambia el modo de una
conversación a `'personal'` en el CRM (ver sección 6 — Botón de modo).

---

### L2 — Handoff activo / Modo manual

**Qué hace:** silencia al agente cuando Kelly ya tomó el control de esa conversación.

Consulta dos condiciones en Supabase:

```
1. ¿Existe un handoff activo para este número?
   → SELECT * FROM handoffs WHERE phone = $phone AND active = true LIMIT 1

2. ¿El modo de la conversación es 'manual' o 'personal'?
   → SELECT mode FROM conversaciones WHERE phone = $phone LIMIT 1
```

**Lógica:**
- Si hay handoff activo → rechazar (Sofía no responde, Kelly está atendiendo)
- Si mode = 'manual' → rechazar (Kelly tomó el control manualmente)
- Si mode = 'personal' → rechazar (número bloqueado vía botón de modo — también está en blocklist pero se verifica aquí también como doble seguro)
- Si mode = 'auto' o no existe registro → continuar

**Nota:** el timeout de handoff (30 min de inactividad → agente retoma) lo maneja
`lib/handoff.js` existente. Este filtro solo lee el estado actual.

---

### L3 — Tipo de mensaje (non-text)

**Qué hace:** bloquea mensajes que el agente no puede procesar como texto.

**Tipos bloqueados:**
- `sticker`
- `location`
- `contacts`
- `reaction`
- `unsupported`

**Tipos permitidos:**
- `text` → procesado normalmente
- `image` → permitido (puede ser comprobante de pago — ver spec 04-pagos.md)
- `audio` → permitido (Sofía responde pidiendo que escriban)
- `document` → permitido

**Para mensajes de audio:** el agente responde con mensaje fijo sin invocar el LLM:
> "Hola 👋 Por el momento solo puedo ayudarte por texto. ¿Me cuentas qué necesitas?"

---

### L4 — Canned response con debounce

**Qué hace:** detecta mensajes sin intención y responde con un menú pre-escrito de 0 tokens,
evitando invocar el agente para saludos vacíos.

#### 4.1 Debounce

Antes de evaluar cualquier mensaje entrante, esperar **2.5 segundos**.
Si en ese tiempo llega otro mensaje del mismo número, cancelar el procesamiento del
primero y procesar solo el más reciente.

Implementación sugerida: usar un campo `last_message_at` en la tabla `conversaciones`
con timestamp. Si el mensaje actual llega menos de 2.5s después del anterior,
ignorar el anterior.

#### 4.2 ¿Cuándo se activa el canned?

El canned se activa **solo si el mensaje NO contiene ninguna keyword de intención**
(ver tabla `configuracion.keywords_intencion`) Y es el primer mensaje del número
(no tiene historial previo en `conversaciones`).

```
¿Número tiene historial en conversaciones?
  SÍ → pasar al agente (ya está en flujo activo)
  NO → ¿mensaje contiene keyword de intención?
        SÍ → pasar al agente con contexto de la opción
        NO → enviar canned
```

#### 4.3 Mensaje canned

El texto del canned es editable desde el CRM (pestaña Configuración).
Valor por defecto:

```
Hola 👋 Soy Sofía, asistente de la Dra. Kely. ¿En qué puedo ayudarte hoy?

1. Quiero agendar una cita
2. Servicios y precios
3. Tengo una consulta o duda
```

Se envía como mensaje de lista interactiva de WhatsApp (3 botones) si YCloud lo soporta,
o como texto plano con números si no.

#### 4.4 Cooldown del canned

No reenviar el canned al mismo número en las próximas **12 horas**.
Guardar `canned_sent_at` en la tabla `conversaciones`.

#### 4.5 Cuando el lead responde una opción

Cuando llega la respuesta a una opción del menú (texto "1", "2", "3" o el texto
del botón), **pasar directamente al agente** con el contexto de la opción elegida
en el system prompt:

- Opción 1 → contexto: "El paciente quiere agendar una cita"
- Opción 2 → contexto: "El paciente quiere conocer servicios y precios"
- Opción 3 → contexto: "El paciente tiene una consulta o duda — puede incluir preguntas médicas, verificar triggers de handoff"

---

### L5 — Keywords spam

**Qué hace:** bloquea mensajes que claramente no son de pacientes.

Lee `configuracion.keywords_spam` desde Supabase. Lista editable desde el CRM.

**Lista inicial (modificable desde CRM — NO hardcoded en código):**
```
casino, crypto, bitcoin, inversiones, forex, préstamo, prestamo,
publicidad, colaboración, colaboracion, negocio, venta, MLM,
emprendimiento, oportunidad de negocio
```

**Acción:** si el mensaje contiene cualquiera de estas palabras → rechazar silenciosamente.

**IMPORTANTE — palabras que NO deben estar en spam:**
Las siguientes palabras parecen "medicamentos/farma" pero son leads calificados para
la Dra. Kely (diferenciador clave del negocio — trabaja con medicación para bajar de peso):
`medicamento, pastilla, inyección, inyeccion, ozempic, saxenda, medicación, medicacion,
fármaco, farmaco, pastillas para bajar`

Estas palabras deben ir en `keywords_intencion`, NO en `keywords_spam`.

---

## 4. TABLA DE BASE DE DATOS — CAMBIOS REQUERIDOS

### 4.1 Tabla `configuracion` — campos nuevos a agregar

```sql
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS
  blocklist_numeros text[] DEFAULT '{}';

ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS
  keywords_intencion text[] DEFAULT ARRAY[
    'precio', 'precios', 'cita', 'agendar', 'agenda', 'plan', 'planes',
    'consulta', 'bajar', 'peso', 'músculo', 'musculo', 'dieta', 'nutrición',
    'nutricion', 'doctora', 'dra', 'kely', 'kelly', 'medicamento', 'pastilla',
    'inyección', 'inyeccion', 'ozempic', 'saxenda', 'medicación', 'medicacion',
    'cuánto', 'cuanto', 'costo', 'valor', 'disponibilidad', 'horario'
  ];

ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS
  canned_texto text DEFAULT
    'Hola 👋 Soy Sofía, asistente de la Dra. Kely. ¿En qué puedo ayudarte hoy?

1. Quiero agendar una cita
2. Servicios y precios
3. Tengo una consulta o duda';

ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS
  canned_cooldown_horas integer DEFAULT 12;
```

### 4.2 Tabla `conversaciones` — campos nuevos a agregar

```sql
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS
  mode text DEFAULT 'auto' CHECK (mode IN ('auto', 'manual', 'personal'));

ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS
  canned_sent_at timestamptz;

ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS
  last_message_at timestamptz;
```

### 4.3 Tabla `blocklist` — crear nueva

```sql
CREATE TABLE IF NOT EXISTS blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  tipo text DEFAULT 'personal' CHECK (tipo IN ('personal', 'spam')),
  created_at timestamptz DEFAULT now(),
  created_by text DEFAULT 'kelly'
);

ALTER TABLE blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kelly puede gestionar blocklist"
  ON blocklist FOR ALL
  USING (auth.role() = 'authenticated');
```

---

## 5. CAMBIOS EN `lib/pre-filter.js`

Reescribir el archivo completo respetando las 6 capas en orden.
El archivo exporta una función principal:

```javascript
// Retorna: { action: 'pass' | 'block' | 'canned' | 'audio_reply', context?: string }
export async function preFilter(payload, supabase) { ... }
```

El webhook `app/api/webhook/route.js` usa el resultado:
- `'pass'` → invocar agent-runner con el mensaje
- `'block'` → no hacer nada
- `'canned'` → enviar mensaje canned vía YCloud
- `'audio_reply'` → enviar respuesta fija de audio vía YCloud

---

## 6. BOTÓN DE MODO EN EL CRM

### 6.1 Qué construir

En la pestaña **Mensajes** del CRM, cada conversación muestra un selector de modo
visible junto al nombre del contacto:

```
[AUTO] [MANUAL] [PERSONAL]
```

Implementar como tres botones tipo pill/tab con shadcn/ui `ToggleGroup`.

### 6.2 Comportamiento por modo

| Modo | Efecto en Sofía | Persistencia |
|---|---|---|
| `auto` | Sofía responde normalmente | Permanente hasta cambio |
| `manual` | Sofía se calla | Temporal — revisar timeout configurable (default 6h) |
| `personal` | Sofía nunca responde | Permanente |

### 6.3 Lógica al cambiar a PERSONAL

Cuando Kelly cambia una conversación a `personal`:
1. Actualizar `conversaciones.mode = 'personal'` para ese número
2. Insertar el número en la tabla `blocklist` con `tipo = 'personal'`
3. También agregar a `configuracion.blocklist_numeros` array (sincronía)
4. Mostrar confirmación: "Número bloqueado. Sofía no responderá más a este contacto."

### 6.4 Lógica al cambiar a MANUAL

1. Actualizar `conversaciones.mode = 'manual'`
2. Guardar `manual_until = now() + 6 horas` en `conversaciones`
3. Después de 6h sin actividad de Kelly → resetear a `auto` automáticamente
4. Kelly puede reactivar manualmente cambiando a `auto` cuando quiera

### 6.5 Auto-guardado del switch de whitelist

**Fix requerido:** el switch "Whitelist activa" en la pestaña Configuración debe
llamar al update de Supabase en el momento del cambio (`onChange`), sin necesitar
botón "Guardar". Mostrar toast de confirmación o error inmediatamente.

---

## 7. COMPORTAMIENTO CON NÚMEROS DESCONOCIDOS

**Decisión de negocio:** Sofía siempre responde a números desconocidos,
a menos que estén en la blocklist.

```
Número desconocido escribe
  ↓
¿En blocklist? SÍ → silencio
  ↓ NO
¿Tiene intención? SÍ → agente directo con contexto
  ↓ NO
Canned con menú de 3 opciones
  ↓
Lead elige opción → agente con contexto
```

No se requiere whitelist en operación normal. La whitelist existe como modo de
emergencia — si algo sale muy mal, Kelly la activa y solo pasan números autorizados.

---

## 8. RELACIÓN CON OTROS SPECS

| Spec | Relación |
|---|---|
| `05-handoff.md` | L2 lee el estado de handoff que genera ese spec |
| `02-whatsapp.md` | L0 interpreta el payload de YCloud definido allí |
| `04-pagos.md` | L3 permite imágenes (comprobantes de pago) |
| `07-crm.md` | El botón de modo y el switch de whitelist viven en ese CRM |

---

## 9. LO QUE NO CAMBIA

El pre-filtro **no modifica** el flujo del agente una vez que el mensaje pasa.
Todo lo que está construido en `supabase/functions/agent-runner/index.ts` permanece
igual. Este spec solo afecta:

- `lib/pre-filter.js` (reescribir)
- `app/api/webhook/route.js` (ajuste mínimo para usar nuevo retorno)
- `app/dashboard/page.js` o componente de mensajes (agregar botón de modo)
- Migraciones SQL (4.1, 4.2, 4.3)
- Pestaña Configuración del CRM (fix auto-guardado whitelist + campos nuevos)

---

*Spec 09 — Pre-filtro · Sistema Sofía IA · Abril 2026*
*Construir con Claude Code — leer junto a specs 02, 05, 07*
