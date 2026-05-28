-- Migration: citas_whatsapp_sync
-- Proyecto: Sistema IA Dra. Kely
-- Purpose: Enable CSV appointment imports into live CRM citas with auditability.

ALTER TABLE public.pacientes
  ALTER COLUMN telefono DROP NOT NULL,
  ALTER COLUMN zona DROP NOT NULL;

ALTER TABLE public.pacientes
  DROP CONSTRAINT IF EXISTS pacientes_telefono_key;

CREATE UNIQUE INDEX IF NOT EXISTS pacientes_telefono_unique_not_null_idx
  ON public.pacientes (telefono)
  WHERE telefono IS NOT NULL;

ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS import_source TEXT,
  ADD COLUMN IF NOT EXISTS patient_name_normalized TEXT;

CREATE TABLE IF NOT EXISTS public.citas_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_name TEXT NOT NULL,
  source_row_count INT NOT NULL DEFAULT 0,
  imported_count INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  warning_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.citas_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.citas_import_batches(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  raw_payload JSONB NOT NULL,
  cleaned_payload JSONB,
  status TEXT NOT NULL CHECK (status IN ('ready', 'duplicate', 'rejected')),
  duplicate_scope TEXT CHECK (duplicate_scope IN ('file', 'database')),
  warning_codes TEXT[] NOT NULL DEFAULT '{}',
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.citas
  ADD CONSTRAINT citas_import_batch_fk
  FOREIGN KEY (import_batch_id)
  REFERENCES public.citas_import_batches(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS citas_import_dedup_active_idx
  ON public.citas (fecha, hora, patient_name_normalized)
  WHERE patient_name_normalized IS NOT NULL AND estado NOT IN ('cancelada', 'no_show');

CREATE INDEX IF NOT EXISTS citas_import_batch_idx
  ON public.citas (import_batch_id);

ALTER TABLE public.citas_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citas_import_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "citas_import_batches_deny_non_service"
  ON public.citas_import_batches
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "citas_import_rows_deny_non_service"
  ON public.citas_import_rows
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
