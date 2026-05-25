-- Migration: extend pending_kelly_actions CHECK constraint to include 'aprobar_pago'
--
-- The existing constraint (created in 20260519120000_pending_kelly_actions.sql)
-- only allows: 'reagendar', 'cancelar', 'bloqueo'.
-- We drop it and recreate it with the new value.
--
-- TTL note: 'aprobar_pago' rows use expira_at = NOW() + INTERVAL '24 hours',
-- set explicitly at INSERT time by the application. The column DEFAULT of 1 hour
-- remains unchanged for all other action_types.
--
-- Post-apply verification:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'pending_kelly_actions_tipo_valido';
--   -- expected: CHECK (action_type IN ('reagendar','cancelar','bloqueo','aprobar_pago'))

ALTER TABLE public.pending_kelly_actions
  DROP CONSTRAINT IF EXISTS pending_kelly_actions_tipo_valido;

ALTER TABLE public.pending_kelly_actions
  ADD CONSTRAINT pending_kelly_actions_tipo_valido
  CHECK (action_type IN ('reagendar', 'cancelar', 'bloqueo', 'aprobar_pago'));
