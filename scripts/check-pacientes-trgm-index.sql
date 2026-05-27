-- Smoke script: verify GIN trigram index is used by verificar_paciente_match
--
-- Run this in Supabase SQL Editor AFTER applying migration
-- 20260527020000_actualizacion_datos_paciente.sql
--
-- Expected output: "Index Scan using pacientes_nombre_trgm_idx" should appear
-- in the EXPLAIN ANALYZE output. If you see "Seq Scan on pacientes" instead,
-- the GIN index is NOT being used — check that:
--   1. pg_trgm extension was installed correctly
--   2. f_unaccent() was created as IMMUTABLE
--   3. The index was created on public.pacientes (not a different schema)

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 1: EXPLAIN ANALYZE the RPC
-- ─────────────────────────────────────────────────────────────────────────────

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM public.verificar_paciente_match('Maria Garcia', '2026-06-01'::date);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 2: Confirm extensions are installed
-- ─────────────────────────────────────────────────────────────────────────────

SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_trgm', 'unaccent');
-- Expected: 2 rows

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 3: Confirm f_unaccent is IMMUTABLE
-- ─────────────────────────────────────────────────────────────────────────────

SELECT proname, provolatile
FROM pg_proc
WHERE proname = 'f_unaccent'
  AND pronamespace = 'public'::regnamespace;
-- Expected: provolatile = 'i' (immutable)

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 4: Confirm table and indexes exist
-- ─────────────────────────────────────────────────────────────────────────────

SELECT tablename, indexname
FROM pg_indexes
WHERE tablename IN ('pacientes', 'pacientes_telefono_historial')
  AND schemaname = 'public'
ORDER BY tablename, indexname;
-- Expected: pacientes_nombre_trgm_idx, hist_telefono_paciente_idx, hist_telefono_pendiente_idx

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 5: Basic table smoke check
-- ─────────────────────────────────────────────────────────────────────────────

SELECT * FROM public.pacientes_telefono_historial LIMIT 1;
-- Expected: 0 rows (empty), no error

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 6: RPC executes without error
-- ─────────────────────────────────────────────────────────────────────────────

SELECT * FROM public.verificar_paciente_match('Test Paciente', '2026-06-01'::date);
-- Expected: 0 rows (no matching patient), no error

-- ─────────────────────────────────────────────────────────────────────────────
-- GOOD output (Test 1): look for lines containing:
--   "Index Scan using pacientes_nombre_trgm_idx on pacientes"
--
-- BAD output (Test 1): if you see:
--   "Seq Scan on pacientes"
-- → the index is not being used, escalate to Joshua before deploying PR 2.
-- ─────────────────────────────────────────────────────────────────────────────
