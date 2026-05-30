# CRM — Borrar conversaciones + control on/off de Sofía

**Fecha:** 2026-05-29
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Objetivo

Dar a la Dra. Kely / Joshua tres controles nuevos en la pestaña **Mensajes** del CRM:

1. Borrar una o varias conversaciones del CRM (modo selección).
2. Apagar/encender a Sofía en una conversación puntual.
3. Apagar/encender a Sofía globalmente (interruptor maestro).

Fuera de alcance (descartado en brainstorming):

- Borrar mensajes individuales (rompería el contexto del agente; el mensaje ya salió por WhatsApp).
- Botón "Borrar todo de una" (se cubre con multi-selección en el modo selección).

## Contexto del código existente

- **Lista de chats:** `app/dashboard/tabs/MensajesTab.jsx`, lee `conversaciones` con realtime (`postgres_changes`). Ya refresca solo ante cambios.
- **Server actions:** `app/dashboard/actions.js` (`'use server'`). Patrón: `createServerSupabaseClient()` (sesión + RLS) o `createAdminSupabaseClient()` (service role, bypass RLS) como en `importAppointmentsCsv`.
- **Modo por conversación ya existe:** `setConversacionMode(id, 'auto'|'manual'|'personal')` — `manual` silencia a Sofía con timeout (`manual_until`), `auto` la reactiva.
- **Pre-filtro:** `lib/pre-filter.js` corta `ignore`/`block`/`handoff`/`unsupported` antes de invocar al agente. Corre en el webhook (Next/Vercel).
- **Persistencia del inbound:** la hace `supabase/functions/agent-runner/index.ts`. Hace find-or-create de la conversación (líneas 186-200) y, ya con `handoff_activo`, retorna temprano sin responder (línea 204). El historial (`mensajes_raw`) se persiste al final del flujo.
- **Hallazgo clave:** cuando el pre-filtro corta, el webhook retorna ANTES de guardar el mensaje entrante. Por eso el switch global NO se implementa en el pre-filtro (perdería mensajes), sino en el agent-runner.

## Feature 1 — Borrar conversaciones (modo selección)

### UX
- Botón en la esquina de la lista de chats (ícono de selección/tacho) que activa **modo selección**.
- En modo selección:
  - Cada item muestra un checkbox.
  - El header de la lista muestra `N seleccionados` + botones **Borrar (N)** y **Cancelar**.
- **Borrar (N)** abre un `AlertDialog` de confirmación. Al confirmar, se eliminan; el realtime refresca la lista.
- **Cancelar** sale del modo selección sin borrar.

### Backend
- Nueva server action `deleteConversaciones(ids: string[])` en `app/dashboard/actions.js`:
  - Verifica sesión autenticada (`getUser()`), igual que `importAppointmentsCsv`.
  - Usa `createAdminSupabaseClient()` para el `DELETE`, porque RLS sobre `conversaciones` podría no tener policy de DELETE para el rol autenticado y borraría 0 filas en silencio.
  - `await admin.from('conversaciones').delete().in('id', ids)`.
  - Valida que `ids` sea un array no vacío de strings.
  - Devuelve `{ success: true, deleted: n }` o `{ error }`.
- No hay FKs hacia `conversaciones` (verificado), y los mensajes viven en `mensajes_raw` (jsonb), así que el borrado es limpio: no orfaniza nada.

### Semántica
Borrar una conversación "limpia el historial". Si el paciente vuelve a escribir, el agent-runner la recrea desde cero. Esto es esperado, no un bug.

## Feature 2 — Toggle Sofía por conversación

### UX
- En el header del chat abierto, un botón **Sofía ON/OFF** (texto/ícono claro del estado actual).
- ON → `mode: 'auto'`. OFF → `mode: 'manual'` (silencio temporal con `manual_until` ya existente).
- No usamos `'personal'` acá (eso agrega a blocklist; es otra intención).

### Backend
- **Reusa `setConversacionMode(id, 'auto'|'manual')`** — sin backend nuevo.

## Feature 3 — Switch maestro global

### UX
- Switch arriba en la pestaña Mensajes: **"Sofía activa / pausada"** con estado visible.
- Refleja `configuracion.agente_activo`.

### Modelo de datos
- Nueva columna `configuracion.agente_activo boolean NOT NULL DEFAULT true`.
- Migración = **SQL manual** (se entrega listo para el SQL Editor). `DEFAULT true` preserva el comportamiento actual.

### Backend
- Nueva server action `setAgenteGlobal(activo: boolean)` → `update configuracion set agente_activo = $1 where id = 1`.
- `getSystemConfig()` agrega `agente_activo` al `select`.

### Comportamiento con Sofía pausada (decisión: "guardar igual")
- El corte vive en **`agent-runner`**, no en el pre-filtro.
- Ubicación: después de que el agent-runner hace find-or-create de la conversación y **agrega + persiste el mensaje del paciente** en `mensajes_raw`, pero **antes** del loop del LLM.
- Lógica: leer `configuracion.agente_activo`; si es `false` → persistir el inbound y retornar temprano (`status: "paused_global"`), sin generar respuesta. Mismo patrón que el early-return de `handoff_activo`.
- Resultado: con Sofía pausada, los mensajes entrantes quedan registrados y visibles en el CRM (vía realtime / `ultima_actividad`), para que la Dra. responda manual. Sofía no contesta.

## Deployment-safety

- **Migración DB** (`agente_activo`): SQL manual en el SQL Editor. `DEFAULT true` → comportamiento idéntico al actual hasta que alguien lo apague. Seguro de aplicar en cualquier momento.
- **`agent-runner`** (Deno edge function): el chequeo nuevo es aditivo y solo actúa si `agente_activo = false`. Requiere deploy manual: `supabase functions deploy agent-runner`. Hasta deployar, el switch global no tiene efecto en el runner (la columna existe pero nadie la lee) — sin regresión.
- **Pre-filtro/webhook (Vercel):** NO se tocan. Cero riesgo en el path de Vercel.
- **Orden seguro de release:** (1) correr migración → (2) deploy agent-runner → (3) deploy frontend con los botones. Si el frontend sale antes que el runner, el switch global simplemente no surte efecto todavía (pero borrar y toggle por-chat sí funcionan).

## Testing

- `deleteConversaciones`: validación de input (array vacío / no-array → error), y que use admin client.
- `setAgenteGlobal`: update correcto sobre `id = 1`.
- agent-runner: con `agente_activo = false`, persiste el inbound y retorna `paused_global` sin llamar al LLM; con `true`, flujo normal. Sumar caso en los tests existentes del runner.
- UI: modo selección entra/sale; checkboxes; confirmación antes de borrar.

## Archivos afectados

- `app/dashboard/tabs/MensajesTab.jsx` — modo selección + toggle por chat + switch global.
- `app/dashboard/actions.js` — `deleteConversaciones`, `setAgenteGlobal`, `agente_activo` en `getSystemConfig`.
- `supabase/functions/agent-runner/index.ts` — chequeo `agente_activo`.
- SQL manual — `ALTER TABLE configuracion ADD COLUMN agente_activo boolean NOT NULL DEFAULT true;`
- Tests correspondientes.
