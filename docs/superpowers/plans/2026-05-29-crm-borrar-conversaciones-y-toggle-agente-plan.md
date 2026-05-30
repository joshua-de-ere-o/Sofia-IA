# Plan de implementación — CRM: borrar conversaciones + control on/off de Sofía

Spec: `docs/superpowers/specs/2026-05-29-crm-borrar-conversaciones-y-toggle-agente-design.md`

Orden de fases pensado para que cada una sea testeable y deployable sin romper lo anterior.
Cada `[ ]` es un paso verificable.

---

## Fase 0 — Migración de datos (manual)

> Escritura a BD = manual. SQL listo para el SQL Editor de Supabase.

```sql
ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS agente_activo boolean NOT NULL DEFAULT true;
```

- [ ] Correr en SQL Editor (proyecto `azrftqhescniopmleolm`).
- [ ] Verificar: `SELECT id, agente_activo FROM configuracion WHERE id = 1;` → `true`.

`DEFAULT true` = comportamiento idéntico al actual hasta apagarlo. Seguro de aplicar ya.

---

## Fase 1 — Feature 1: Borrar conversaciones

### 1a. Server action `deleteConversaciones`
Archivo: `app/dashboard/actions.js`

- [ ] Agregar `deleteConversaciones(ids)`:
  - Valida `Array.isArray(ids) && ids.length > 0` y que todos sean strings → si no, `{ error }`.
  - `createServerSupabaseClient()` → `getUser()`; si no hay sesión → `{ error: 'Tu sesión expiró...' }`.
  - `createAdminSupabaseClient()` → `admin.from('conversaciones').delete().in('id', ids)`.
  - Retorna `{ success: true, deleted: ids.length }` o `{ error }`.

### 1b. UI modo selección
Archivo: `app/dashboard/tabs/MensajesTab.jsx`

- [ ] Estado nuevo: `selectionMode` (bool), `selectedIds` (Set/array).
- [ ] Botón en la esquina del header de la lista (junto al buscador): activa `selectionMode`.
- [ ] En `selectionMode`:
  - Cada item de la lista renderiza un checkbox; click togglea el id en `selectedIds` (no abre el chat).
  - Header de la lista cambia a `N seleccionados` + botones **Borrar (N)** y **Cancelar**.
  - **Cancelar** → `selectionMode=false`, limpia `selectedIds`.
- [ ] **Borrar (N)** abre `AlertDialog` de confirmación.
  - Confirmar → `await deleteConversaciones([...selectedIds])`; en error `alert`; en éxito limpia selección y sale del modo. El realtime refresca; igual llamar `fetchConversaciones()` por las dudas.
- [ ] Si el chat abierto (`selectedConv`) fue borrado, cerrarlo (`setSelectedConv(null)`).

### 1c. Tests
- [ ] Unit de `deleteConversaciones`: array vacío/no-array → error; array válido → llama delete con `.in('id', ids)`.

**Checkpoint deployable:** Fase 1 sola ya es útil (borrar) y no depende de nada más.

---

## Fase 2 — Feature 2: Toggle Sofía por conversación

Archivo: `app/dashboard/tabs/MensajesTab.jsx` (reusa `setConversacionMode` ya existente).

- [ ] Importar `setConversacionMode` desde `../actions`.
- [ ] En el header del chat abierto, botón **Sofía ON/OFF**:
  - Estado ON si `activeConvData.mode === 'auto'` (o `null`/default); OFF si `'manual'`.
  - Click → `setConversacionMode(activeConvData.id, on ? 'manual' : 'auto')` → `fetchConversaciones()`.
  - No mostrar/forzar `'personal'` desde acá.
- [ ] Reflejar el estado en el subtítulo del header (ya hay lógica de `mode` ahí; ajustar el copy si hace falta).

### Tests
- [ ] (Opcional) test de interacción del toggle si hay setup de RTL; si no, validación manual.

**Checkpoint deployable:** Fase 2 sola funciona (backend ya existe).

---

## Fase 3 — Feature 3: Switch maestro global

### 3a. Backend
Archivo: `app/dashboard/actions.js`

- [ ] En `getSystemConfig()` agregar `agente_activo` al `.select(...)`.
- [ ] Nueva action `setAgenteGlobal(activo)`:
  - Coerce a boolean.
  - `createServerSupabaseClient()` → `update({ agente_activo }).eq('id', 1)`.
  - `{ success: true }` o `{ error }`.

### 3b. Corte en agent-runner
Archivo: `supabase/functions/agent-runner/index.ts`

- [ ] Tras find-or-create de la conversación y **después de agregar + persistir el mensaje del paciente** en `mensajes_raw`, pero **antes** del loop del LLM:
  - Leer `configuracion.agente_activo` (`select agente_activo where id = 1`, `maybeSingle`).
  - Si `=== false` → asegurar que el inbound quedó persistido y `return` temprano con `status: "paused_global"` (mismo patrón que el early-return de `handoff_activo`, línea ~204).
- [ ] Confirmar el punto exacto: el mensaje del usuario debe estar guardado en `mensajes_raw` ANTES del return (si hoy el append+persist ocurre al final del flujo, mover el corte después del primer persist o persistir el inbound explícitamente en esta rama).

### 3c. UI switch global
Archivo: `app/dashboard/tabs/MensajesTab.jsx`

- [ ] Cargar `agente_activo` (via `getSystemConfig()` o un fetch directo a `configuracion`).
- [ ] Switch arriba de la pestaña: **"Sofía activa / pausada"**.
- [ ] Click → `setAgenteGlobal(!activo)` con feedback optimista + refetch.

### 3d. Tests
- [ ] agent-runner: `agente_activo = false` → persiste inbound, retorna `paused_global`, NO llama al LLM; `true` → flujo normal. Sumar al set de tests del runner (`__tests__/index-*.test.ts` o `test/agent-runner-*.test.mjs`).
- [ ] `setAgenteGlobal`: update sobre `id = 1`.

---

## Fase 4 — Release (manual, en orden)

Deployment-safety: el orden evita regresiones.

- [ ] (1) Migración Fase 0 corrida en prod.
- [ ] (2) `supabase functions deploy agent-runner` (sin esto, el switch global no surte efecto; el resto sí).
- [ ] (3) Deploy del frontend (Vercel) con los botones.
- [ ] Smoke test: borrar un chat de prueba; toggle por-chat; pausar global y verificar que un inbound de prueba se guarda y Sofía no responde; reactivar.

---

## Riesgos / a vigilar

- **RLS en `conversaciones`:** por eso el DELETE usa admin client. Verificar en el smoke test que borra de verdad (no 0 filas).
- **Debounce de texto:** con Sofía pausada, el debounce del webhook sigue rigiendo qué mensaje llega al runner; semántica heredada del flujo normal, aceptable para MVP.
- **Punto de persistencia del inbound en agent-runner:** confirmar que el corte global queda DESPUÉS de guardar el mensaje (si no, mensajes perdidos en pausa). Es la verificación más importante de la Fase 3.
