# PRD — Sistema de Agendamiento por WhatsApp
## Dra. Kely León · Nutrición Clínica y Deportiva

| Campo | Detalle |
|---|---|
| **Producto** | Agente IA "Sofía" — asistente virtual de agendamiento vía WhatsApp |
| **Cliente** | Dra. Kely León — Nutricionista Clínica y Deportiva, Quito, Ecuador |
| **Versión PRD** | 1.0 |
| **Fecha** | Abril 2026 |
| **Stack** | Next.js 14 · Supabase · Vercel · YCloud · Telegram Bot · Claude Haiku 4.5 |
| **IDE** | Antigravity (Google) — Spec-Driven Development |

---

## 1. Visión del Producto

Un agente conversacional de WhatsApp llamado **Sofía** que gestiona el ciclo completo de agendamiento de citas para la consulta nutricional de la Dra. Kely León: orientación del paciente, calificación del lead, selección de plan, agendamiento, cobro de adelanto, confirmación instantánea, recordatorios automáticos y escalamiento a la doctora cuando sea necesario.

**Objetivo único del agente:** AGENDAR CITAS. Sofía no diagnostica, no da consejos médicos, no es consultora nutricional.

---

## 2. Usuarios y Roles

### 2.1 Paciente (WhatsApp)
- Persona de 12+ años que contacta a la Dra. Kely por WhatsApp.
- Target principal: 25–44 años (~73% del público).
- Interactúa exclusivamente con Sofía hasta que se requiera handoff.

### 2.2 Dra. Kely León (Telegram + CRM)
- Recibe notificaciones de citas, handoffs y reportes vía Telegram.
- Gestiona agenda y audita pagos desde un CRM web.
- Interviene directamente en WhatsApp cuando Sofía escala.

---

## 3. Stack Tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Frontend + API Routes | Next.js 14 App Router | CRM visual + webhooks de entrada |
| Base de datos + Auth | Supabase (PostgreSQL) | Datos, Auth, Realtime |
| Agent loop | Supabase Edge Functions | Evita timeout de 10s de Vercel free |
| Hosting | Vercel (plan gratuito) | Sirve CRM y rutas API ligeras |
| WhatsApp API | YCloud | Puente oficial con Meta |
| Canal doctora | Telegram Bot API | Notificaciones + control de handoff |
| Modelo IA | Claude Haiku 4.5 | $1/$5 por M tokens — costo óptimo |
| UI Components | shadcn/ui | Cards, tabs, sidebar |
| Realtime | Supabase Realtime | Chat en vivo en CRM |

---

## 4. Arquitectura del Sistema

```
Paciente → WhatsApp
         → YCloud webhook
         → app/api/webhook/route.js     (Vercel — valida + enruta)
         → supabase/functions/agent-runner/index.ts  (Edge Function)
               → Filtro 3 capas (whitelist → keywords → clasificador IA)
               → Claude Haiku 4.5 API
               → Tools: consultar_disponibilidad, calcular_precio,
                        agendar_cita, derivar_a_kelly
               → Supabase BD
         → YCloud → respuesta WhatsApp
         → Telegram Bot → notificación a Kelly (si handoff)
```

**Dos agentes distintos en el ecosistema:**
- **Agente Antigravity:** lee specs `.md` y construye el software.
- **Sofía:** vive dentro del sistema construido y atiende pacientes en producción.

---

## 5. Funcionalidades (Features)

### F1 — Conversación Inteligente con Pacientes

**Descripción:** Sofía recibe mensajes de WhatsApp, identifica la necesidad del paciente y lo guía hacia el agendamiento.

**Requisitos:**
- Pregunta de entrada: "¿Qué te trajo por aquí hoy, qué estás buscando mejorar?"
- Una pregunta a la vez, frases cortas, tuteo, emojis moderados.
- Identifica: objetivo → plan adecuado → modalidad → zona → disponibilidad.
- Si el paciente no especifica plan → presentar Plan Esencial ($35) por defecto.
- Detección de palabras clave médicas (medicamento, pastilla, inyección, fármaco) → escalar a doctora.

**Criterios de aceptación:**
- El agente nunca da recomendaciones médicas, dosifica medicamentos ni diagnostica.
- El agente presenta máximo un plan a la vez con su beneficio principal.
- La conversación promedio hasta agendar no supera 8 turnos.

---

### F2 — Catálogo de Servicios

| Servicio | Precio | Nota |
|---|---|---|
| Evaluación InBody 270 | $20 | Extra complementario |
| Consulta Virtual | $20 | Atención remota |
| Plan Quincenal | $25 | 15 días |
| **Plan Esencial ⭐** | **$35** | **Plan base por defecto** |
| Plan Mensual Premium | $70 | Más completo |
| Plan Trimestral | $90 | 3 meses |

**Regla:** Ninguna consulta se vende independiente — siempre dentro de un plan.

---

### F3 — Motor de Agenda

**Horarios:**

| Bloque | Horario | Estado |
|---|---|---|
| Lunes–Viernes mañana | 08:00–12:00 | Agendable |
| Almuerzo | 13:00–15:00 | Bloqueado |
| Lunes–Viernes tarde | 15:00–17:00 | Agendable |
| Sábados | 08:00–12:00 | Agendable |
| Feriados | 08:00–12:00 | Agendable (calendario oficial Ecuador) |

**Reglas:**
- Separación entre citas: 30 min.
- Anticipación mínima: 1 día (mismo día permitido si hay slot).
- Ventana máxima: 14 días calendario.
- V1: agenda propia en Supabase. V2: Google Calendar.

**Datos mínimos para confirmar:**
- Nombre completo, fecha de nacimiento, teléfono, motivo, ciudad/zona, modalidad.
- Correo electrónico: opcional.

---

### F4 — Lógica de Pagos por Zona

| Zona | Adelanto | Cálculo |
|---|---|---|
| Sur de Quito | Sin adelanto | Cita confirmada directo |
| Norte de Quito | 50% | 50% del plan elegido |
| Virtual | 50% | 50% del plan elegido |
| Valle (Los Chillos) | 50% | 50% de (plan + $5 extra zona) |
| Domicilio | 50% | 50% de $40 fijo siempre = $20 |

**Flujo de pago V1 (Transferencia):**
1. Sofía envía datos bancarios.
2. Paciente envía comprobante (imagen) por WhatsApp.
3. YCloud detecta imagen → guardada en Supabase vinculada a paciente y cita.
4. Cita confirmada instantáneamente (sin esperar a Kelly).
5. Kelly recibe notificación Telegram con comprobante adjunto.
6. Kelly audita a posteriori.

**V2 preparado:** PayPhone — campos en Supabase listos desde V1.

**Estados del slot:** `bloqueado` (al elegir horario) → `confirmado` (al recibir comprobante o si zona no requiere pago).

---

### F5 — Handoff a Doctora

**Canal:** Telegram Bot → Dra. Kely.

**Triggers de escalamiento:**
- Mención de medicamentos / pastillas / fármacos / inyecciones.
- Dudas clínicas o diagnóstico.
- Paciente molesto o reclamo.
- Pago no reconocido o disputa.
- Urgencias.
- Convenios, alianzas comerciales, prensa.
- Solicitudes fuera del flujo estándar.

**Protocolo:**
1. Sofía pausa el agente **solo en ese chat**.
2. Notifica a Kelly por Telegram: nombre, motivo, historial, urgencia.
3. Kelly atiende al paciente directo en WhatsApp.
4. Agente retoma por: botón "Terminé" en Telegram, comando `/listo`, o timeout 30 min de inactividad.
5. Si Kelly no responde en 10 min → alerta Telegram. 30 min → agente retoma.

---

### F6 — Recordatorios Automáticos

| Tipo | Cuándo | Canal |
|---|---|---|
| Recordatorio 1 | 24h antes de cita | WhatsApp |
| Recordatorio 2 | 2h antes de cita | WhatsApp |
| Reactivación | 8 días sin actividad | WhatsApp |
| No-show | Tras ausencia | Telegram (reporte a Kelly) |

**Implementación:** Batch API de Anthropic para recordatorios en lote (50% descuento).

---

### F7 — Cancelación y Reprogramación

| Acción | Pacientes habituales | Pacientes nuevos |
|---|---|---|
| Cancelación | 24h de anticipación | 24h de anticipación |
| Reprogramación | 24h de anticipación | 48h de anticipación |

**No-show:** Sofía envía reporte automático a Kelly por Telegram.

---

### F8 — CRM Web (Dashboard de Kelly)

**Acceso:** Supabase Auth (correo) + PIN de 4 dígitos para acceso rápido. Sesión persiste meses.

**Pestañas:** Mensajes · Citas · Reportes · Configuración.

**Paleta:** Blanco (#FFFFFF) · Teal suave (#F0FDFA) · Verde (#22C55E) · Grises elegantes.

**Tipografía:** Plus Jakarta Sans.

**Chat en tiempo real:** Supabase Realtime (sin polling).

---

### F9 — Filtro Pre-LLM (3 Capas)

| Capa | Función | Resultado |
|---|---|---|
| 1. Whitelist de teléfonos | Solo números permitidos pasan | Bloquea spam |
| 2. Detección de keywords | Identifica intención sin IA | Ruteo rápido |
| 3. Clasificador IA (opcional) | Evalúa si el mensaje merece agente | Evita llamadas innecesarias |

---

## 6. Modelo de Datos (Tablas Principales)

| Tabla | Campos clave |
|---|---|
| `pacientes` | id, nombre, fecha_nacimiento, telefono, email, zona, created_at |
| `citas` | id, paciente_id, servicio, fecha, hora, estado, modalidad, payment_method, payment_reference, external_calendar_id (nullable) |
| `conversaciones` | id, paciente_id, canal, estado, historial_resumido, handoff_activo, created_at |
| `pagos` | id, cita_id, monto, metodo (transfer/cash/payphone), referencia, comprobante_url, verificado |

---

## 7. Optimización de Costos

| Técnica | Ahorro estimado |
|---|---|
| Prompt caching | ~90% en system prompt |
| Historial resumido tras 6 mensajes | ~50% tokens de entrada |
| Filtro pre-LLM 3 capas | Evita llamadas innecesarias |
| max_tokens bajo (300 respuestas, 100 confirmaciones) | Reduce costo de salida |
| Batch API para recordatorios | 50% descuento |

**Costo estimado fase validación:** ~$35/mes total (YCloud ~$30 + Claude API ~$2–5).

---

## 8. KPIs

| Métrica | Definición |
|---|---|
| Leads recibidos | Conversaciones iniciadas con Sofía |
| Leads calificados | Con intención real y perfil compatible |
| Tasa de agendamiento | % de leads calificados que agendan |
| Citas confirmadas | Datos completos + pago cuando aplica |
| No-shows | Ausencias sin aviso |
| Tiempo primera respuesta | Segundos hasta primer mensaje de Sofía |
| Pacientes reactivados | Inactivos que vuelven tras mensaje automático |
| Casos escalados | Transferidos a doctora por Telegram |

**Conversación exitosa:** cita agendada, caso derivado correctamente, o paciente reactivado con intención real.

---

## 9. Estructura del Proyecto

```
agente-kelly/
├── .antigravity/rules.md
├── specs/
│   ├── 00-proyecto.md
│   ├── 01-agente.md
│   ├── 02-whatsapp.md
│   ├── 03-agenda.md
│   ├── 04-pagos.md
│   ├── 05-handoff.md
│   ├── 06-recordatorios.md
│   ├── 07-crm.md
│   └── 08-auth.md
├── app/
│   ├── api/webhook/route.js
│   ├── api/telegram/route.js
│   ├── dashboard/page.js
│   └── login/page.js
├── lib/
│   ├── agent.js
│   ├── supabase.js
│   ├── ycloud.js
│   ├── telegram.js
│   └── handoff.js
└── supabase/functions/agent-runner/index.ts
```

---

## 10. Pendientes Técnicos de Configuración

| Pendiente | Estado |
|---|---|
| Número WhatsApp Business en YCloud | En proceso |
| Chat ID de Telegram de Dra. Kely | Por confirmar |
| Datos bancarios para transferencias | Por confirmar |

Todos los pendientes de negocio están resueltos. Solo quedan configuraciones técnicas que se completan cuando los servicios estén activos.

---

## 11. Roadmap

| Fase | Alcance |
|---|---|
| **V1 — MVP** | Agente Sofía + agenda Supabase + pago por transferencia + CRM básico + recordatorios + handoff Telegram |
| **V2 — Integrations** | PayPhone + Google Calendar + métricas avanzadas en CRM |

---

*PRD v1.0 — Sistema Agendamiento WhatsApp — Dra. Kely León · Quito, Ecuador*
*Abril 2026*
