-- Migration: 20260527_002_excepciones_horario
-- Creates the excepciones_horario table for day-level schedule overrides.
--
-- PREREQUISITE: migration 20260527_001 must be applied first (zona_enum needs
-- 'santo_domingo' before this table's CHECK constraint can reference it).
--
-- Schema decisions (see design ADR-4, ADR-6):
--   - hora_inicio is NOT stored; opening time is always the system default (08:00).
--   - hora_fin is the only user-editable time boundary.
--   - ubicacion uses a TEXT CHECK instead of zona_enum to avoid referencing the
--     enum literal before it's committed — TEXT + CHECK is equivalent and safe.
--   - UNIQUE(fecha, ubicacion) prevents duplicate same-day same-zone rows.
--   - RLS: authenticated users can read and write; Edge function uses service role.

CREATE TABLE IF NOT EXISTS public.excepciones_horario (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL,
  ubicacion   TEXT NOT NULL CHECK (ubicacion IN ('quito_extendido', 'solo_virtual', 'santo_domingo')),
  hora_fin    TIME NOT NULL,
  motivo      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id),
  UNIQUE (fecha, ubicacion)
);

CREATE INDEX IF NOT EXISTS idx_excepciones_horario_fecha
  ON public.excepciones_horario (fecha);

ALTER TABLE public.excepciones_horario ENABLE ROW LEVEL SECURITY;

-- Authenticated users (Dra. Kelly via CRM) can read all rows.
CREATE POLICY "authenticated read excepciones_horario"
  ON public.excepciones_horario
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert, update, and delete their own rows.
CREATE POLICY "authenticated write excepciones_horario"
  ON public.excepciones_horario
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
