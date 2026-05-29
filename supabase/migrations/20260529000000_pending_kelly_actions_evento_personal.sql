-- Migration: extend pending_kelly_actions CHECK constraint to include 'evento_personal'
--
-- The existing constraint (last updated in 20260525120200_pending_kelly_actions_aprobar_pago.sql)
-- only allows: 'reagendar', 'cancelar', 'bloqueo', 'aprobar_pago'.
-- The new Modo-Kelly tool agendar_evento_personal inserts action_type = 'evento_personal'
-- (block + reminder), which was being rejected by the constraint.
-- We drop it and recreate it with the new value.
--
-- Post-apply verification:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'pending_kelly_actions_tipo_valido';
--   -- expected: CHECK (action_type IN ('reagendar','cancelar','bloqueo','aprobar_pago','evento_personal'))

ALTER TABLE public.pending_kelly_actions
  DROP CONSTRAINT IF EXISTS pending_kelly_actions_tipo_valido;

ALTER TABLE public.pending_kelly_actions
  ADD CONSTRAINT pending_kelly_actions_tipo_valido
  CHECK (action_type IN ('reagendar', 'cancelar', 'bloqueo', 'aprobar_pago', 'evento_personal'));
