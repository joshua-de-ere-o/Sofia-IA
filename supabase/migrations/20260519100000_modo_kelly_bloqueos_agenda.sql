-- Migration: soporte para bloqueos de agenda no-paciente (modo Kelly por Telegram).
--
-- Contexto:
--   El modo-Kelly permite a la doctora crear bloqueos de agenda por texto libre
--   desde Telegram (ej. "agendá reunión con Dr. Molina manana 10:00 y bloquea
--   esa hora"). Estos bloqueos NO son citas de paciente: no tienen paciente_id,
--   llevan un motivo libre, y no entran al flujo de recordatorios de pacientes
--   (el cron usa INNER JOIN con pacientes, asi que los excluye gratis).
--
-- Cambios:
--   1. Rename del enum 'bloqueado' (huerfano: el PRD viejo lo definia como
--      "paciente eligio horario, esperando pago" pero el codigo nunca lo uso,
--      ese flujo se unifico bajo 'pendiente_pago') a 'agenda_bloqueada' con
--      semantica nueva y clara.
--   2. citas.paciente_id pasa a NULLABLE (los bloqueos no tienen paciente).
--   3. Nueva columna citas.motivo_bloqueo (texto libre, ej. "Reunion Dr. Molina").
--   4. CHECK constraint: si paciente_id IS NULL, estado DEBE ser
--      'agenda_bloqueada'. Esto evita que un bug futuro inserte una cita
--      normal sin paciente.
--
-- Seguridad verificada al momento del cambio:
--   - 0 filas con estado='bloqueado' en produccion.
--   - El cron enviar-recordatorios usa pacientes!inner: los bloqueos quedan
--     automaticamente fuera de recordatorios, confirmaciones y resumen
--     matutino de pacientes.
--   - El trigger cobrar_saldo_al_completar no toca paciente_id; sigue seguro.
--   - El CRM (useCitas.js) usa LEFT JOIN: los bloqueos aparecen ahi y los
--     componentes deben renderizar el motivo en vez de "Sin nombre"
--     (cambio de UI separado).

-- 1. Renombrar el valor del enum.
ALTER TYPE public.cita_estado_enum
  RENAME VALUE 'bloqueado' TO 'agenda_bloqueada';

-- 2. Hacer paciente_id nullable.
ALTER TABLE public.citas
  ALTER COLUMN paciente_id DROP NOT NULL;

-- 3. Agregar columna motivo_bloqueo (NULL para citas reales; texto para bloqueos).
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS motivo_bloqueo TEXT;

-- 4. Constraint de consistencia.
ALTER TABLE public.citas
  ADD CONSTRAINT citas_bloqueo_consistencia
  CHECK (
    (paciente_id IS NOT NULL) OR
    (paciente_id IS NULL AND estado = 'agenda_bloqueada')
  );
