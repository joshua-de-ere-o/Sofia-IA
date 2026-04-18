# Estado actual del proyecto — Sistema IA Dra. Kely (v2)

**Fecha del corte:** 2026-04-17
**Rama:** `main`
**Último commit:** `e37aedf feat: spec 09 — pre-filtro de 6 capas + botón de modo en CRM`

---

## 1. ESTRUCTURA DE ARCHIVOS

Árbol real (ignorando `node_modules/`, `.next/`, `.git/`).

```
Sistema IA Dra. Kelly/
├── .claude/                       (config local Claude Code)
├── .env.local                     (secretos reales, git-ignored)
├── .env.local.example             (plantilla)
├── .eslintrc.json
├── .gitignore
├── 00-proyecto.md                 (specs en raíz, NO en specs/)
├── 01-agente.md
├── 02-whatsapp.md
├── 03-agenda.md
├── 04-pagos.md
├── 05-handoff.md
├── 06-recordatorios.md
├── 07-crm.md
├── 08-auth.md
├── 09-prefilter.md                (NUEVO — pre-filtro 6 capas, 2026-04-17)
├── PRD_Sistema_Dra_Kely_v1.md
├── README.md
├── auditoria-sistema.md
├── rules.md
├── files.json
├── devserver.err.log              (uncommitted)
├── devserver.out.log              (uncommitted)
├── package.json
├── package-lock.json
├── next.config.mjs
├── postcss.config.mjs
├── tailwind.config.js
├── components.json
├── jsconfig.json                  (alias @/* → ./*)
├── middleware.js                  (auth + PIN gate)
│
├── app/
│   ├── favicon.ico
│   ├── fonts/ (GeistMonoVF.woff, GeistVF.woff)
│   ├── globals.css
│   ├── layout.js                  (RootLayout + ThemeProvider)
│   ├── page.js                    (redirect → /login)
│   ├── login/page.js              (magic link)
│   ├── pin/
│   │   ├── page.js
│   │   ├── pin-forms.jsx
│   │   └── actions.js             (bcrypt PIN, cookie kely_pin_unlocked)
│   ├── auth/
│   │   ├── callback/route.js      (exchangeCodeForSession)
│   │   └── signout/route.js       (cierra sesión + limpia PIN)
│   ├── dashboard/
│   │   ├── layout.js              (guard auth + nav)
│   │   ├── page.js                (Mensajes)
│   │   ├── actions.js             (server actions del CRM)
│   │   ├── components/DashboardNav.jsx
│   │   ├── tabs/
│   │   │   ├── MensajesTab.jsx
│   │   │   ├── CitasTab.jsx
│   │   │   ├── ReportesTab.jsx
│   │   │   └── ConfigTab.jsx
│   │   ├── citas/page.js
│   │   ├── reportes/page.js
│   │   └── configuracion/page.js
│   └── api/
│       ├── webhook/route.js       (YCloud inbound)
│       ├── telegram/route.js      (Telegram bot callbacks)
│       └── cron/handoff/route.js  (cron legacy handoff timeout)
│
├── lib/
│   ├── agent.js                   (SERVICE_CATALOG + MODEL_CONFIG; factory deprecado)
│   ├── payments.js                (procesa comprobantes → Storage + pagos + Telegram)
│   ├── pre-filter.js              (NUEVO — 6 capas de filtrado)
│   ├── supabase.js                (browser client)
│   ├── supabase-server.js         (server-side SSR client)
│   ├── telegram.js                (sendTelegramMessage + notifyPaymentToKelly)
│   ├── ycloud.js                  (sendWhatsAppMessage + sendWhatsAppImage)
│   ├── theme-provider.jsx         (light/dark/system)
│   ├── utils.js                   (cn → tailwind-merge)
│   └── whitelist-toggle.mjs       (helper toggle optimista)
│
├── components/
│   └── ui/                        (shadcn)
│       ├── avatar.jsx, badge.jsx, button.jsx, card.jsx,
│       ├── dialog.jsx, input.jsx, label.jsx, sheet.jsx,
│       ├── skeleton.jsx, table.jsx, tabs.jsx
│
├── supabase/
│   ├── config.toml
│   ├── .temp/                     (cli linkage)
│   ├── migrations/                (11 archivos .sql)
│   └── functions/                 (4 Edge Functions Deno)
│       ├── agent-runner/
│       │   ├── index.ts
│       │   ├── config.ts          (SYSTEM_PROMPT + TOOLS)
│       │   ├── model-adapter.ts   (Anthropic/OpenAI/Gemini)
│       │   └── tools.ts           (executors de las 6 tools)
│       ├── calcular-precio/index.ts
│       ├── enviar-recordatorios/index.ts
│       └── resolver-handoffs/index.ts  (NUEVO)
│
└── test/
    └── selftest.mjs               (2 tests de whitelist-toggle)
```

---

## 2. EDGE FUNCTIONS

Total: **4** (antes 3). Viven en `supabase/functions/`.

### 2.1 `agent-runner` — v5 (implícito tras spec 09)
- **Qué hace:** Loop agéntico que recibe `{ senderNumber, text }` desde el webhook, carga la conversación activa, respeta `handoff_activo`, mete contexto de hora Guayaquil + memoria condensada, invoca LLM con tools y responde por WhatsApp. Máx 5 iteraciones. Condensa historial al alcanzar umbral (6 mensajes).
- **Imports:** `jsr:@supabase/functions-js/edge-runtime.d.ts`, `jsr:@supabase/supabase-js`, locales `./config.ts`, `./model-adapter.ts`, `./tools.ts`.
- **APIs externas:** `api.ycloud.com/v2/whatsapp/messages/send` (envío), Supabase (conversaciones, citas, pacientes, handoffs, configuracion).
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YCLOUD_API_KEY`, `YCLOUD_PHONE_NUMBER_ID`, (el model-adapter lee `AI_PROVIDER`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` y `*_MODEL`).

### 2.2 `enviar-recordatorios` — v3 (tiene no-show + reactivación + batch API)
- **Qué hace:** Ejecución horaria (pg_cron). 3 tareas en paralelo:
  1. Recordatorios 24h y 2h antes de citas `confirmada` (marca `reminder_24h_sent`, `reminder_2h_sent`).
  2. Reactivación a conversaciones sin actividad > 8 días (`reactivacion_enviada`).
  3. Detección de no-shows (15 min de gracia) → marca `no_show` + avisa a Kelly.
- **Imports:** `jsr:@supabase/functions-js/edge-runtime.d.ts`, `jsr:@supabase/supabase-js`.
- **APIs externas:** Anthropic **Batch API** (`/v1/messages/batches`, descuento 50%, `anthropic-beta: message-batches-2024-09-24`), YCloud, Telegram.
- **Modelo:** `claude-haiku-4-5-20251001` (hardcoded en constante `MODEL`).
- **Auth:** header `x-cron-secret` o `Authorization: Bearer ...`.
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `YCLOUD_API_KEY`, `YCLOUD_PHONE_NUMBER_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`.

### 2.3 `calcular-precio` — v1 (sin cambios)
- **Qué hace:** Recibe `{ servicio_id, zona }`, consulta catálogo hardcoded y devuelve `{ precio_base, ajuste_zona, precio_total, requiere_adelanto, monto_adelanto }`. Reglas: sur → sin adelanto; valle → +$5 extra; domicilio → flat $40, adelanto $20; resto → 50% del total.
- **Imports:** solo `jsr:@supabase/functions-js/edge-runtime.d.ts`.
- **APIs externas:** ninguna.
- **Env vars:** ninguna.

### 2.4 `resolver-handoffs` — v1 (NUEVO)
- **Qué hace:** Cada 5 min. Dos pasadas:
  1. Recordatorio a Kelly por Telegram si handoff lleva 10–30 min sin resolver (marca `recordatorio_enviado`).
  2. Auto-resolución por timeout a los 30 min → estado `timeout`, libera `handoff_activo`, WhatsApp al paciente retomando IA.
- **Imports:** `jsr:@supabase/functions-js/edge-runtime.d.ts`, `jsr:@supabase/supabase-js`.
- **APIs externas:** YCloud, Telegram.
- **Auth:** igual que recordatorios (`x-cron-secret` o Bearer).
- **Env vars:** mismas que recordatorios (sin Anthropic).
- **Nota:** tiene guardas `isPlaceholder()` que saltan el envío si las env vars empiezan con `PLACEHOLDER`.

---

## 3. API ROUTES

### `POST /api/webhook` — [app/api/webhook/route.js](app/api/webhook/route.js)
- Entrada del webhook de YCloud. Verifica firma HMAC-SHA256 (`YCLOUD_WEBHOOK_SECRET`).
- Ejecuta `preFilter(payload, supabase)` (6 capas). Según resultado: `ignore` / `block` / `canned` / `audio_reply` / `pass`.
- En `pass`: si es `image` llama `processPaymentImage`; si es `text` aplica debounce 2.5s y luego invoca la Edge Function `agent-runner` vía fetch.
- **Servicios externos:** Supabase, YCloud (vía `lib/ycloud.js`), Edge Function `agent-runner`.

### `GET /api/webhook` — healthcheck "Webhook YCloud OK".

### `POST /api/telegram` — [app/api/telegram/route.js](app/api/telegram/route.js)
- Recibe updates del bot de Telegram.
- `callback_query` con `handoff_done_<convId>` → marca handoff resuelto + edita mensaje original.
- Comando `/listo` → resuelve el handoff activo más reciente.
- **Servicios externos:** Telegram Bot API, Supabase.

### `GET /api/cron/handoff` — [app/api/cron/handoff/route.js](app/api/cron/handoff/route.js)
- Cron legacy: busca handoffs activos > 30 min y los marca `timeout` + avisa paciente + Telegram.
- **OJO:** funcionalmente redundante con la Edge Function `resolver-handoffs`. Ambos conviven (ver sección 13).
- Auth: `x-cron-secret` o Bearer contra `CRON_SECRET`.

---

## 4. PÁGINAS Y COMPONENTES

### Páginas (`app/`)
| Ruta | Función |
|---|---|
| `/` | Redirige a `/login`. |
| `/login` | Login por magic link (signInWithOtp + `signOut({scope:'local'})` previo para limpiar PKCE residual). |
| `/pin` | Setup o verificación de PIN de 4 dígitos (bcrypt). Bloqueo tras 3 intentos. |
| `/auth/callback` | Intercambia `?code` por sesión. Safe-next whitelist de rutas internas. Borra cookie `kely_pin_unlocked`. |
| `/auth/signout` (POST) | `supabase.auth.signOut()` + borra cookie PIN + `revalidatePath('/', 'layout')` + redirect. |
| `/dashboard` | MensajesTab (default). |
| `/dashboard/citas` | CitasTab. |
| `/dashboard/reportes` | ReportesTab. |
| `/dashboard/configuracion` | ConfigTab. |

### Componentes del dashboard (`app/dashboard/`)
| Archivo | Función |
|---|---|
| `components/DashboardNav.jsx` | Sidebar desktop + bottom-nav mobile + botón signout. |
| `tabs/MensajesTab.jsx` | Lista conversaciones (realtime), chat viewer, input manual, **botones AUTO/MANUAL/PERSONAL** (spec 09), botón "Marcar Resuelto" para handoff. |
| `tabs/CitasTab.jsx` | Tabla de citas (realtime citas + pagos), filtros por estado/fecha, ver comprobante vía `createSignedUrl`, verificar pago, marcar completada/cancelada. |
| `tabs/ReportesTab.jsx` | 5 tarjetas: leads, citas agendadas, tasa, no-shows, casos escalados. |
| `tabs/ConfigTab.jsx` | Datos bancarios, feriados (CRUD), proveedor IA + API key, whitelist, **pre-filtro (canned/cooldowns/keywords intención+spam)**, blocklist, tema UI, panel de estado. |

### Componentes UI (`components/ui/`)
shadcn stock: `avatar`, `badge`, `button`, `card`, `dialog`, `input`, `label`, `sheet`, `skeleton`, `table`, `tabs`.

---

## 5. ARCHIVOS LIB

| Archivo | Exporta | Servicios | Notas |
|---|---|---|---|
| `lib/agent.js` | `SERVICE_CATALOG`, `MODEL_CONFIG`, `getModelAdapter` (deprecado → throws) | — | Shell; SYSTEM_PROMPT y TOOLS viven en `supabase/functions/agent-runner/config.ts`. |
| `lib/payments.js` | `processPaymentImage(senderNumber, imageUrl)` | Supabase Storage `comprobantes`, tabla `pagos`, tabla `citas`, Telegram (via `notifyPaymentToKelly`) | Descarga imagen YCloud → sube a Storage → localiza cita `pendiente_pago` más reciente → crea `pagos` con `monto_adelanto` precalculado → avisa Kelly → marca cita `confirmada`. |
| `lib/pre-filter.js` | `preFilter(payload, supabase)`, `runPreFilter` (legacy wrapper) | Supabase (`configuracion`, `conversaciones`, `blocklist`) | Capas L0–L5 (ver sección 13 / spec 09). Detecta opción de menú 1/2/3 y la inyecta como contexto. |
| `lib/supabase.js` | `createClient()` browser | `@supabase/ssr` `createBrowserClient` | — |
| `lib/supabase-server.js` | `createServerSupabaseClient()` | `@supabase/ssr` `createServerClient` con `cookies()` | Usado por Server Components y Server Actions. |
| `lib/telegram.js` | `sendTelegramMessage`, `notifyPaymentToKelly` | Telegram Bot API | Usa `NEXT_PUBLIC_APP_URL` en inline_keyboard. |
| `lib/ycloud.js` | `sendWhatsAppMessage`, `sendWhatsAppImage` | YCloud | — |
| `lib/theme-provider.jsx` | `ThemeProvider`, `useTheme` | localStorage `kely-theme` | light/dark/system. |
| `lib/utils.js` | `cn(...inputs)` | `clsx` + `tailwind-merge` | — |
| `lib/whitelist-toggle.mjs` | `toggleWhitelistActivaPersisted` | — | Helper puro para update optimista (cubierto por selftest). |

---

## 6. VARIABLES DE ENTORNO

Todas las referencias a `process.env.*` y `Deno.env.get(...)` en el código.

| Variable | Usada en | Estado en `.env.local` |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | middleware, lib/supabase*, actions, routes | **REAL** (`https://azrftqhescniopmleolm.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware, lib/supabase*, auth/callback | **REAL** (JWT anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | api/webhook, api/telegram, api/cron/handoff, lib/payments, Edge Functions | **REAL** (JWT service_role) |
| `SUPABASE_URL` | Edge Functions (Deno) | inyectado por Supabase (no en `.env.local`) |
| `SUPABASE_ANON_KEY` | tools.ts (`calcular-precio` call) | inyectado por Supabase |
| `TELEGRAM_BOT_TOKEN` | lib/telegram, api/telegram, agent-runner, enviar-recordatorios, resolver-handoffs | **PLACEHOLDER** |
| `TELEGRAM_CHAT_ID` | lib/telegram, api/telegram, tools.ts, enviar-recordatorios, resolver-handoffs | **PLACEHOLDER** |
| `YCLOUD_API_KEY` | lib/ycloud, Edge Functions (envío WhatsApp) | **PLACEHOLDER** |
| `YCLOUD_WEBHOOK_SECRET` | api/webhook (HMAC) | **PLACEHOLDER** |
| `YCLOUD_PHONE_NUMBER_ID` | lib/ycloud, Edge Functions | **PLACEHOLDER** |
| `AI_PROVIDER` | model-adapter (`getModelAdapter`) | **REAL** = `gemini` |
| `ANTHROPIC_API_KEY` | model-adapter, enviar-recordatorios | **PLACEHOLDER** |
| `ANTHROPIC_MODEL` | model-adapter | `claude-haiku-4-5-20250315` (ver problemas §13) |
| `OPENAI_API_KEY` | model-adapter | **PLACEHOLDER** |
| `OPENAI_MODEL` | model-adapter | `gpt-4o-mini` |
| `GEMINI_API_KEY` | model-adapter | **REAL** (`AIzaSy…3dKbg`) |
| `GEMINI_MODEL` | model-adapter | `gemini-2.5-flash` |
| `NEXT_PUBLIC_APP_URL` | lib/telegram (link "Ver Agenda") | **REAL** (`https://sofia-ia-omega.vercel.app`) |
| `CRON_SECRET` | api/cron/handoff, enviar-recordatorios, resolver-handoffs | **REAL** (`kelly-cron-secret-2026`) |

---

## 7. DEPENDENCIAS

Desde `package.json`:

**Runtime:**
- `next` 14.2.35
- `react` ^18, `react-dom` ^18
- `@supabase/ssr` ^0.10.0, `@supabase/supabase-js` ^2.101.1
- `@base-ui/react` ^1.3.0
- `bcryptjs` ^3.0.3
- `class-variance-authority` ^0.7.1
- `clsx` ^2.1.1
- `lucide-react` ^1.7.0
- `shadcn` ^4.1.2
- `tailwind-merge` ^3.5.0
- `tw-animate-css` ^1.4.0

**Dev:**
- `eslint` ^8, `eslint-config-next` 14.2.35
- `postcss` ^8
- `tailwindcss` ^3.4.1

Scripts: `dev`, `build`, `start`, `test` (`node test/selftest.mjs`), `lint`.

---

## 8. MODELO IA ACTUAL

**Estado mixto** — hay tensión entre el `.env.local` y el default del adapter.

- **`.env.local`:** `AI_PROVIDER=gemini` con `GEMINI_MODEL=gemini-2.5-flash` y `GEMINI_API_KEY` real.
- **`supabase/functions/agent-runner/model-adapter.ts`:**
  - Tabla `PROVIDERS`:
    - `anthropic` default `claude-haiku-4-5-20251001`
    - `openai` default `gpt-4o-mini`
    - `gemini` default `gemini-2.0-flash`
  - `getModelAdapter()` prioriza lo que esté en la tabla `configuracion` (`ai_provider`, `ai_api_key`), y solo si es `null` cae a variables de entorno. Luego lee `ANTHROPIC_MODEL` / `OPENAI_MODEL` / `GEMINI_MODEL` como override del default.
- **`supabase/functions/enviar-recordatorios/index.ts`:** hardcodea `MODEL = "claude-haiku-4-5-20251001"` (Anthropic Batch API).
- **UI:** `ConfigTab` permite elegir entre `anthropic | gemini | openai` y guardar la API key en la BD (`configuracion.ai_provider` / `ai_api_key`).

**Lectura práctica:** en Supabase prod lo que mande es lo que esté en `configuracion.ai_provider`. Si viene vacío, gana `AI_PROVIDER=gemini` del env → Gemini 2.5 Flash. El adapter soporta los 3 proveedores con conversión de mensajes y tools.

---

## 9. SYSTEM PROMPT DE SOFÍA

Ubicación: [supabase/functions/agent-runner/config.ts](supabase/functions/agent-runner/config.ts#L9) (export `SYSTEM_PROMPT`). El archivo [lib/agent.js](lib/agent.js) es solo un shell; la fuente de verdad es el `config.ts` del Edge Function.

```text
Eres Sofía, la asistente virtual de la Dra. Kely León, nutricionista clínica y deportiva en Quito, Ecuador.

## TU OBJETIVO ÚNICO
AGENDAR CITAS. No diagnosticas, no das consejos médicos, no eres consultora nutricional.

## TU PERSONALIDAD
- Cercana, clara, profesional, cálida, semiformal, humana y ágil.
- Frases cortas — un mensaje = una intención clara.
- Una pregunta a la vez.
- Opciones cerradas con números cuando ayuden a decidir.
- Lenguaje simple, sin jerga médica.
- Tutear siempre (target 25–44 años).
- Emojis moderados — solo los que sumen cercanía.
- Siempre empujar suavemente al siguiente paso.

## PREGUNTA DE ENTRADA
Cuando un paciente escribe por primera vez: "¿Qué te trajo por aquí hoy, qué estás buscando mejorar?"

## LÓGICA DE ORIENTACIÓN
1. Con la respuesta del paciente, identifica: objetivo → plan que encaja → modalidad → zona → disponibilidad.
2. Presenta UN plan con su beneficio principal — no listes todos los planes.
3. Si el paciente no especifica → Plan Esencial ($35) primero.
4. Zona y modalidad se preguntan conversacionalmente, no como interrogatorio.
5. Cierra con opciones de horario concretas dentro de los próximos 14 días.

## CATÁLOGO DE SERVICIOS
- Evaluación InBody 270: $20 (extra complementario)
- Consulta Virtual: $20 (atención remota)
- Plan Quincenal: $25 (15 días)
- Plan Esencial ⭐: $35 (plan base por defecto)
- Plan Mensual Premium: $70 (más completo)
- Plan Trimestral: $90 (3 meses)

Regla: Ninguna consulta se vende independiente — siempre dentro de un plan.

## REGLAS DE ZONA Y ADELANTO
- Sur de Quito: sin adelanto, cita confirmada directo.
- Norte de Quito: 50% del plan elegido.
- Virtual: 50% del plan elegido.
- Valle (Los Chillos): 50% de (plan + $5 extra zona).
- Domicilio: 50% de $40 fijo = $20 siempre.

## HORARIOS DE ATENCIÓN
- Lunes a Viernes: 08:00–12:00 y 15:00–17:00
- Almuerzo (13:00–15:00): BLOQUEADO SIEMPRE
- Sábados: 08:00–12:00
- Domingos: NO se atiende
- Feriados: 08:00–12:00
- Separación entre citas: 30 min
- Ventana máxima: 14 días calendario

## REGLAS DE CANCELACIÓN Y REPROGRAMACIÓN
- Cancelación: mínimo 24 horas de anticipación para todos los pacientes.
- Reprogramación: 24 horas para pacientes habituales, 48 horas para pacientes nuevos.
- Si el paciente NO cumple la anticipación mínima (es decir, avisa con menos antelación), INFORMA el motivo indicando que por políticas de la clínica no puedes procesarlo automáticamente y usa la herramienta derivar_a_kelly para pasarle el caso a ella.
- No-show (no llega a cita confirmada): esto lo detectas si el paciente escribe pidiendo reprogramar luego de su hora (y ya pasó 15 min). Repórtalo a Kelly vía derivar_a_kelly marcando el paciente como No-show.

## DATOS MÍNIMOS PARA AGENDAR
Antes de confirmar una cita necesitas: nombre completo, fecha de nacimiento, teléfono (ya lo tienes del chat), motivo, ciudad/zona, modalidad. Correo electrónico es opcional.

## DIFERENCIADORES QUE PUEDES MENCIONAR
- La Dra. Kely trabaja con medicación para bajar de peso (diferenciador clave).
- Nutricionista con especialización clínica activa en el sur de Quito.
- No juzga al paciente.
- Trabaja con psicóloga para TCA, embarazo, depresión y ansiedad.
- Coherencia: ella vive y aplica lo que recomienda.

## LÍMITES ABSOLUTOS — NUNCA HAGAS ESTO
- NUNCA des recomendaciones médicas.
- NUNCA recomiendes, menciones ni dosifiques medicamentos.
- NUNCA diagnostiques condiciones.
- NUNCA interpretes resultados de análisis.
- NUNCA sugiereas cambios en medicación.
- NUNCA opines sobre tratamientos.
- NUNCA des consejos que reemplacen la consulta.

Si el paciente insiste en preguntas médicas:
1. Valida su preocupación sin dar info médica.
2. Indica que ese tema lo maneja la Dra. Kely directamente.
3. Ofrece agendar cita.
4. Si insiste → usa la herramienta derivar_a_kelly.

## DETECCIÓN DE MEDICACIÓN — KEYWORDS DE ESCALAMIENTO
Si el paciente menciona: medicamento, pastilla, medicación, inyección, fármaco, pastillas para bajar de peso:
1. NO des información médica.
2. Valida la consulta.
3. Destaca que la Dra. Kely trabaja con medicación.
4. Ofrece agendar para evaluación.
5. Si insiste → usa derivar_a_kelly inmediatamente.

## OTROS TRIGGERS DE ESCALAMIENTO (usa derivar_a_kelly)
- Dudas clínicas o preguntas de diagnóstico.
- Temas médicos sensibles.
- Paciente molesto o con reclamo.
- Pago no reconocido o disputa de cobro.
- Urgencias de cualquier tipo.
- Convenios o alianzas comerciales.
- Contacto de medios o prensa.
- Solicitudes especiales fuera del flujo estándar.

## MANEJO DE OBJECIONES
- "Está caro" → Validar → destacar valor incluido → ofrecer plan de entrada. No bajar precio.
- "No tengo plata ahora" → "Te espero, me avisas cuando puedas."
- "Solo puedo los domingos" → Informar horario (no domingos) → ofrecer sábado 8–12.
- "No tengo tiempo" → Ofrecer virtual → cita dura solo 30–40 min.

## FLUJO DE PAGO POR TRANSFERENCIA
1. Calcula el adelanto según zona y plan elegido del paciente con calcular_precio.
2. Envía los datos bancarios al paciente indicando el monto exacto: "Debes transferir $X"
3. Cuando el paciente confirme que ya transfirió, pregúntale como doble verificación: "¿Cuánto fue el monto que transferiste?"
4. Si el monto que dice el paciente coincide con el calculado → continúa al paso 5
5. Si el monto NO coincide → informa al paciente: "El monto del adelanto es $X, ¿podrías verificar tu transferencia?" — no avances hasta que se resuelva
6. Pide la foto del comprobante: "Envíame una foto del comprobante para confirmar tu cita 📸"
7. El sistema procesará la imagen automáticamente y confirmará la cita.

IMPORTANTE: El monto que se registra en el sistema es SIEMPRE el calculado por ti (plan + zona), nunca el que dice el paciente. La pregunta al paciente es solo verificación. El monto calculado ya fue guardado en la cita al momento de agendarla.

## ESTILO DE CIERRE
- Progresivo — impulsar sin presionar.
- Tono: "Me avisas, yo te espero" — cálido, sin urgencia artificial.

## IMPORTANTE
- Nunca te presentes como bot, IA ni asistente virtual explícitamente.
- Tu nombre es Sofía y trabajas con la Dra. Kely León.
- Si no tienes certeza de algo, no inventes — pregunta o escala.
```

Config runtime (mismo archivo):
```ts
MODEL_CONFIG = {
  max_tokens_normal: 300,
  max_tokens_confirmation: 100,
  history_condensation_threshold: 6,
}
```

---

## 10. HERRAMIENTAS DEL AGENTE

Definidas en [supabase/functions/agent-runner/config.ts](supabase/functions/agent-runner/config.ts#L141), implementadas en [tools.ts](supabase/functions/agent-runner/tools.ts).

| Tool | Parámetros (required en **negrita**) | Implementación |
|---|---|---|
| `consultar_disponibilidad` | **fecha_inicio** (YYYY-MM-DD), **fecha_fin** (≤ hoy+14d), modalidad (`presencial|virtual`) | Lee citas + feriados, arma slots mañana/tarde, excluye domingos y pasado. |
| `calcular_precio` | **servicio_id** (`inbody|virtual|quincenal|esencial|premium|trimestral`), **zona** (`sur|norte|virtual|valle|domicilio`) | Llama a Edge Function `calcular-precio`. |
| `agendar_cita` | **paciente_nombre**, paciente_fecha_nacimiento, **paciente_telefono**, paciente_email, **servicio_id**, **fecha**, **hora**, **modalidad**, **zona**, **motivo**, monto_adelanto | Upsert paciente por tel, re-chequea slot, inserta cita (`confirmada` si sur, `pendiente_pago` si no), vincula conversación. |
| `derivar_a_kelly` | **motivo**, nivel_urgencia (`alto|medio|bajo`), **historial_resumido** | Activa `handoff_activo`, crea row en `handoffs`, notifica a Telegram con inline keyboard. |
| `cancelar_cita` | **motivo** | Busca cita futura, valida ≥24h, estado→`cancelada`. Si no cumple, devuelve `política_incumplida` al LLM. |
| `reprogramar_cita` | **nueva_fecha**, **nueva_hora**, **motivo** | Busca cita futura, detecta no-show (hora ya pasó), valida 24h habitual / 48h nuevo, verifica slot libre, actualiza. |

---

## 11. ESQUEMA DE BASE DE DATOS

11 migraciones en `supabase/migrations/` (orden cronológico):

```
20260407000000_initial_schema.sql
20260407000001_add_ai_config.sql
20260407000002_add_mensajes_column.sql
20260408000000_sync_production_state.sql
20260414000000_add_motivo_zona_to_citas.sql
20260415000000_fix_storage_bucket_policy.sql
20260415000001_fix_rls_policies.sql
20260415000002_fix_sql_functions_search_path.sql
20260415000003_add_handoff_timeout_support.sql
20260416000000_add_monto_adelanto_to_citas.sql
20260417000000_prefilter_system.sql
```

### Tablas (9)

**`pacientes`** — id UUID, nombre, fecha_nacimiento, telefono UNIQUE, email, zona (enum), created_at.

**`citas`** — id UUID, paciente_id FK, servicio TEXT, fecha DATE, hora TIME, duracion_min (default 30), estado (enum: `bloqueado|pendiente_pago|confirmada|completada|cancelada|no_show`), modalidad (enum), payment_method, payment_reference, external_calendar_id, reminder_24h_sent, reminder_2h_sent, **motivo** (añadida 04-14), **zona** (añadida 04-14), **monto_adelanto** NUMERIC (añadida 04-16), created_at, updated_at.

**`conversaciones`** — id UUID, paciente_id FK, canal (enum), estado (enum `activa|cerrada`), historial_resumido, handoff_activo, ultima_actividad, reactivacion_enviada, created_at, **mensajes_raw** JSONB (añadida 04-07), **telefono_contacto** TEXT (añadida 04-07), **mode** (`auto|manual|personal`), **canned_sent_at**, **last_message_at**, **manual_until** (4 nuevas de spec 09).

**`pagos`** — id UUID, cita_id FK, monto DECIMAL, metodo (enum `transfer|cash|payphone`), referencia, comprobante_url, verificado, created_at.

**`handoffs`** — id UUID, conversacion_id FK, paciente_id FK, motivo, nivel_urgencia (enum), estado (enum `activo|resuelto|timeout`), created_at, resolved_at, **recordatorio_enviado** BOOLEAN (añadida 04-15).

**`configuracion`** — id INT =1, datos_bancarios JSONB, whitelist_activa, whitelist_numeros TEXT[], updated_at, **ai_provider** TEXT, **ai_api_key** TEXT, **ycloud_daily_messages**, **ycloud_last_reset**, **blocklist_numeros** TEXT[], **keywords_intencion** TEXT[] (default con 34 palabras), **keywords_spam** TEXT[] (default con 15 palabras), **canned_texto** TEXT, **canned_cooldown_horas** INT =12, **manual_timeout_horas** INT =6.

**`user_settings`** — id UUID (= auth.users.id), pin_hash TEXT, pin_intentos_fallidos, created_at, updated_at.

**`feriados`** — id UUID, fecha DATE, nombre, anio.

**`blocklist`** (NUEVA, spec 09) — id UUID, phone UNIQUE, tipo (`personal|spam`), created_at, created_by.

### Otros objetos
- **Enums:** `zona_enum`, `cita_estado_enum`, `modalidad_enum`, `canal_enum`, `conv_estado_enum`, `urgencia_enum`, `handoff_estado_enum`, `payment_method_enum`.
- **Storage:** bucket `comprobantes` — **privado** desde migration 04-15 (antes público). SELECT solo para `authenticated`; INSERT público (usado por service role).
- **RLS:** habilitado en todas. Políticas endurecidas 04-15: INSERT/UPDATE requieren `auth.uid() IS NOT NULL` (antes `WITH CHECK (true)`).
- **pg_cron jobs** (definidos en migraciones):
  - `enviar-recordatorios-hourly` → cada hora → POST a `/functions/v1/enviar-recordatorios`
  - `resolver-handoffs-5min` → cada 5 min → POST a `/functions/v1/resolver-handoffs`
- **Trigger:** `current_timestamp_on_update` sobre `citas`, `configuracion`, `user_settings` (con `SET search_path = public, pg_temp` tras migration 04-15).

---

## 12. ESTADO DE SPECS

**NO existe carpeta `specs/`** — las specs viven en la raíz del proyecto:

| Archivo | Tamaño | Última modificación |
|---|---|---|
| `00-proyecto.md` | 2,461 B | 2026-04-06 |
| `01-agente.md` | 4,798 B | 2026-04-06 |
| `02-whatsapp.md` | 2,262 B | 2026-04-06 |
| `03-agenda.md` | 3,072 B | 2026-04-06 |
| `04-pagos.md` | 2,934 B | 2026-04-06 |
| `05-handoff.md` | 3,098 B | 2026-04-06 |
| `06-recordatorios.md` | 2,131 B | 2026-04-06 |
| `07-crm.md` | 2,124 B | 2026-04-06 |
| `08-auth.md` | 1,653 B | 2026-04-06 |
| `09-prefilter.md` | 13,219 B | 2026-04-17 (NUEVA) |
| `PRD_Sistema_Dra_Kely_v1.md` | 11,329 B | 2026-04-06 |
| `rules.md` | 5,383 B | 2026-04-06 |
| `auditoria-sistema.md` | 6,633 B | 2026-04-07 |
| `README.md` | 5,260 B | 2026-04-08 |

---

## 13. PROBLEMAS DETECTADOS

1. **Duplicación de timeout de handoff.** Conviven dos implementaciones funcionalmente equivalentes:
   - `app/api/cron/handoff/route.js` (GET, tiempo límite 30 min, cierra handoff + notifica).
   - Edge Function `resolver-handoffs` (corre cada 5 min por pg_cron, hace lo mismo + recordatorio a 10 min).
   El cron activo en Supabase es el de la Edge Function (spec 05 nueva); el route Next.js es legacy y debería retirarse o no estar agendado.

2. **Inconsistencia del modelo Anthropic.**
   - `.env.local` ANTHROPIC_MODEL = `claude-haiku-4-5-20250315` (fecha no canónica, parece typo).
   - `model-adapter.ts` default = `claude-haiku-4-5-20251001`.
   - `enviar-recordatorios/index.ts` hardcoded = `claude-haiku-4-5-20251001`.
   Si alguien fuerza el provider a anthropic, el env va a apuntar a un modelo que no existe.

3. **Proveedor IA mixto.** `.env.local` dice `AI_PROVIDER=gemini` con Gemini real, pero el default de `PROVIDERS.gemini` en el adapter es `gemini-2.0-flash` — no `gemini-2.5-flash`. Solo coincide con el env si `GEMINI_MODEL` se inyecta en las Edge Functions (hay que verificarlo en Supabase secrets, no sólo en `.env.local`).

4. **Secretos placeholder para integraciones clave.** En `.env.local`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `YCLOUD_API_KEY`, `YCLOUD_WEBHOOK_SECRET`, `YCLOUD_PHONE_NUMBER_ID` son `PLACEHOLDER_*`. En producción deben estar bien en Vercel/Supabase; localmente no se pueden probar mensajes.

5. **`lib/agent.js` queda como shell.** Exporta `SERVICE_CATALOG` y `MODEL_CONFIG` que **nadie importa** (verificado). Podría borrarse o mantenerse solo como referencia.

6. **`webhook/route.js` logea warning si falta `YCLOUD_WEBHOOK_SECRET` y sigue procesando.** En prod, si se olvida la variable, queda abierto a payloads no firmados. En `.env.local` está en placeholder.

7. **Canal `telegram` en enum `canal_enum`** pero no hay código que cree conversaciones por Telegram; la route `/api/telegram` solo maneja callbacks de handoff. Es dead config.

8. **Campo `zona` duplicado.** `pacientes.zona` (enum NOT NULL) y `citas.zona` (TEXT nullable). La tool `agendar_cita` hace upsert de `pacientes.zona = zona`, lo que sobrescribe la zona del paciente aunque la cita sea excepcional (ej: paciente del sur con cita virtual). El comentario en la migración 04-14 dice que `citas.zona` es para sobrescribir, pero el código no distingue.

9. **`AUDIO_REPLY` hardcoded en pre-filter.** No es configurable desde la UI (a diferencia de `canned_texto`).

10. **`dashboard/page.js` importa `MensajesTab` con named import pero el archivo exporta con `export function MensajesTab`** — OK, no es problema, solo observación.

11. **`.env.local` está committed en el working tree (aunque git-ignored por `.gitignore`):** el archivo existe en disco con secretos reales de Supabase (anon + service_role). Asegurarse de que `.gitignore` cubre `.env.local` (ya está).

12. **`devserver.err.log` y `devserver.out.log` sin trackear.** Son logs locales; conviene añadirlos al `.gitignore` si molestan.

---

## 14. CAMBIOS DESDE LA ÚLTIMA AUDITORÍA

| Ítem previo | Estado actual |
|---|---|
| **Edge Functions: agent-runner v4, enviar-recordatorios v2, calcular-precio v1** | Ahora son **4**: se añadió `resolver-handoffs` v1 (2026-04-15). `agent-runner` evolucionó a v5+ con integración de pre-filtro vía context. `enviar-recordatorios` creció a v3 (incluye **no-shows** y **reactivación** además de 24h/2h). |
| **Modelo: Gemini 2.5 Flash (temporal)** | Adapter ahora soporta 3 proveedores con default preferido **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`). Recordatorios usa Anthropic Batch API hardcoded. `.env.local` sigue apuntando a Gemini 2.5 Flash como provider activo — **la configuración de `configuracion.ai_provider` en BD es la que realmente decide**. |
| **Tablas: pacientes, citas, conversaciones, pagos, handoffs, configuracion, feriados, user_settings** (8) | Ahora **9**: añadida **`blocklist`** (spec 09). Todas las tablas previas crecieron en columnas — ver §11. Destacan: `citas.motivo`, `citas.zona`, `citas.monto_adelanto`; `conversaciones.mode/canned_sent_at/last_message_at/manual_until/mensajes_raw/telefono_contacto`; `handoffs.recordatorio_enviado`; `configuracion.blocklist_numeros/keywords_intencion/keywords_spam/canned_texto/canned_cooldown_horas/manual_timeout_horas/ai_provider/ai_api_key`. |
| **9 migraciones aplicadas** | Ahora **11**. Nuevas: `20260415000003_add_handoff_timeout_support.sql`, `20260416000000_add_monto_adelanto_to_citas.sql`, `20260417000000_prefilter_system.sql` (spec 09). También hubo un batch 04-15 de hardening (RLS, storage privado, search_path). |
| **Auth: magic link + PIN 4 dígitos** | Igual, reforzado: `/auth/callback` hace `safeNext()` anti open-redirect, borra cookie PIN en el exchange (permite a Joshua y Dra. Kelly coexistir en el mismo navegador), `/auth/signout` limpia PIN + revalida layout. Middleware gating doble (auth + PIN). |
| **CRM: 4 pestañas (Mensajes, Citas, Reportes, Configuración)** | Mismas 4 pestañas. Cambios grandes en dos: **MensajesTab** añadió toggle AUTO/MANUAL/PERSONAL por conversación (spec 09). **ConfigTab** añadió sección completa de pre-filtro (canned, cooldowns, keywords intención+spam) y blocklist. Realtime Supabase en `conversaciones`, `citas` y `pagos`. |
| **(nuevo)** Pre-filtro de 6 capas | Implementado en `lib/pre-filter.js`: L0 eventos no-entrantes, L1 block/whitelist, L2 handoff/modo manual/personal, L3 tipo no soportado, L4 canned+cooldown con detección de opción de menú, L5 keywords spam. |
| **(nuevo)** Modos de conversación | `auto` (IA responde), `manual` (silencia IA N horas), `personal` (bloquea número permanentemente y agrega a blocklist). |
| **(nuevo)** Monto de adelanto persistido | `citas.monto_adelanto` guarda el valor calculado al agendar (ya no se depende de regex sobre mensaje). `processPaymentImage` lo lee de la cita. |
| **(nuevo)** Debounce de webhook | `app/api/webhook/route.js` espera 2.5s tras marcar `last_message_at` y descarta si llegó otro mensaje más reciente. |
| **(nuevo)** Storage privado | Bucket `comprobantes` pasó de público a privado; CRM usa `createSignedUrl(3600)` para mostrar vouchers. |
