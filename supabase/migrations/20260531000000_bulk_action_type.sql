-- Migration: extend pending_kelly_actions CHECK constraint to include 'reagendar_bulk'
--
-- Deployment-safety note:
--   This migration ONLY ADDS a new value to the CHECK constraint. It never
--   narrows or removes existing valid values. No existing rows are affected.
--   Safe to apply at any time — before or after PR-C is merged.
--
-- Current allowed values (from 20260529000000_pending_kelly_actions_evento_personal.sql):
--   'reagendar', 'cancelar', 'bloqueo', 'aprobar_pago', 'evento_personal'
--
-- After applying this migration:
--   'reagendar', 'cancelar', 'bloqueo', 'aprobar_pago', 'evento_personal', 'reagendar_bulk'
--
-- DO NOT apply via CLI. Copy this SQL into the Supabase SQL Editor and run manually
-- (project convention for all DDL changes to production).
--
-- Post-apply verification:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'pending_kelly_actions_tipo_valido';
--   -- expected: CHECK (action_type IN ('reagendar','cancelar','bloqueo','aprobar_pago','evento_personal','reagendar_bulk'))
--
-- Manual step M-1: apply this between PR-B merge and PR-C deploy.

ALTER TABLE public.pending_kelly_actions
  DROP CONSTRAINT IF EXISTS pending_kelly_actions_tipo_valido;

ALTER TABLE public.pending_kelly_actions
  ADD CONSTRAINT pending_kelly_actions_tipo_valido
  CHECK (action_type IN ('reagendar', 'cancelar', 'bloqueo', 'aprobar_pago', 'evento_personal', 'reagendar_bulk'));
