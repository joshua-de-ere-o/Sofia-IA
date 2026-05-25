-- Migration: add pending_payment_confirmation_cita_id to conversaciones
-- Purpose: OCR fallback (FR-11) — when OCR fails on a receipt image, store the
--   cita_id so that when the patient replies with a numeric amount in their next
--   text message, the agent can re-run the payment match against the stored cita.
--
-- DO NOT EXECUTE via Supabase CLI / migration runner — run manually in Supabase
-- SQL Editor (same policy as PR 1 migrations).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS pending_payment_confirmation_cita_id UUID NULL
  REFERENCES public.citas(id) ON DELETE SET NULL;

-- Verification query (run after migration):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'conversaciones'
--   AND column_name = 'pending_payment_confirmation_cita_id';
-- Expected: 1 row, data_type = 'uuid', is_nullable = 'YES'
