-- Migration: actualizacion_datos_paciente
-- Proyecto: Sistema IA Dra. Kely
--
-- Purpose: Enable fuzzy patient matching for the phone/data update flow.
--          Patients can text "RECORDATORIOS" (or natural language) to Sofía
--          to register their phone number and receive appointment reminders.
--
-- This migration is purely ADDITIVE. No existing table is modified.
-- Rollback: DROP TABLE pacientes_telefono_historial CASCADE;
--           DROP INDEX pacientes_nombre_trgm_idx;
--           DROP FUNCTION f_unaccent(text);
--           (Extensions pg_trgm / unaccent can stay installed)
--
-- Apply manually via Supabase SQL Editor — DO NOT run via CLI.

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 1: Extensions
-- pg_trgm  → trigram similarity operator % and similarity() function
-- unaccent → strip accents for accent-insensitive matching (é → e, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 2: IMMUTABLE unaccent wrapper
--
-- unaccent() is STABLE, not IMMUTABLE, so it cannot be used directly inside
-- a functional GIN index expression. This wrapper hardcodes the dictionary
-- schema so Postgres can treat it as IMMUTABLE (constant per input).
-- Standard PostgreSQL idiom — see Postgres docs on functional indexes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 3: GIN trigram index on pacientes.nombre (normalized)
--
-- This index enables fast trigram similarity lookups against f_unaccent(nombre).
-- The % operator (pg_trgm) uses this index; the explicit similarity() >= 0.85
-- filter is applied as a post-filter on the small candidate set.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS pacientes_nombre_trgm_idx
  ON public.pacientes
  USING gin (public.f_unaccent(nombre) gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 4: pacientes_telefono_historial
--
-- Audit table for all phone number change requests. Each row represents one
-- update attempt, with its resolution state. Supports:
--   - Auto-approved updates (estado = 'aprobado', aprobado_por = 'sistema')
--   - Pending approval by Dra. Kely (estado = 'pendiente')
--   - Rejected by Dra. Kely (estado = 'rechazado')
--   - Expired requests never acted on (estado = 'expirado')
--
-- expira_at is set to now() + 24h for 'pendiente' rows; NULL for auto-approved.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pacientes_telefono_historial (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id       UUID        NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
  telefono_anterior TEXT,
  telefono_nuevo    TEXT        NOT NULL,
  from_number       TEXT        NOT NULL,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado            TEXT        NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente','aprobado','rechazado','expirado')),
  aprobado_por      TEXT,
  expira_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  motivo            TEXT
);

-- Index: look up all history rows for a specific patient
CREATE INDEX IF NOT EXISTS hist_telefono_paciente_idx
  ON public.pacientes_telefono_historial (paciente_id);

-- Index: find open/pending requests efficiently (partial index — only 'pendiente' rows)
CREATE INDEX IF NOT EXISTS hist_telefono_pendiente_idx
  ON public.pacientes_telefono_historial (estado, expira_at)
  WHERE estado = 'pendiente';

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 5: Row Level Security
--
-- Edge functions run under the service role, which bypasses RLS by default.
-- Telegram callback route (Next.js) also uses service role client.
-- Pattern: deny ALL access to anon and authenticated roles; service role
-- accesses unrestricted (same approach as pending_kelly_actions).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pacientes_telefono_historial ENABLE ROW LEVEL SECURITY;

-- Deny all operations for anon and authenticated (non-service) roles
CREATE POLICY "historial_deny_non_service"
  ON public.pacientes_telefono_historial
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 6: verificar_paciente_match RPC
--
-- Called by the verificar_datos_paciente tool executor in agent-runner.
-- Uses the GIN index via the % operator (pg_trgm) to find candidates, then
-- applies a ±2-day citas window and a 0.85 similarity threshold.
--
-- Returns up to 5 candidates ordered by similarity score descending.
-- The caller (tools.ts) applies the match decision logic:
--   - 1 row  → match:'unique'
--   - 0 rows → match:'none'
--   - 2+ rows → match:'multiple'
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verificar_paciente_match(
  p_nombre     TEXT,
  p_fecha_cita DATE
) RETURNS TABLE (
  id       UUID,
  nombre   TEXT,
  telefono TEXT,
  score    REAL
) LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.nombre,
    p.telefono,
    similarity(public.f_unaccent(p.nombre), public.f_unaccent(p_nombre)) AS score
  FROM public.pacientes p
  WHERE
    -- GIN index scan: trigram candidates (default threshold 0.3)
    public.f_unaccent(p.nombre) % public.f_unaccent(p_nombre)
    -- Appointment window: ±2 days from the provided date
    AND EXISTS (
      SELECT 1
      FROM public.citas c
      WHERE c.paciente_id = p.id
        AND c.fecha BETWEEN (p_fecha_cita - INTERVAL '2 days')::date
                        AND (p_fecha_cita + INTERVAL '2 days')::date
    )
    -- Strict threshold: drop borderline trigram matches
    AND similarity(public.f_unaccent(p.nombre), public.f_unaccent(p_nombre)) >= 0.85
  ORDER BY score DESC
  LIMIT 5;
$$;
