-- Migration: add 'confirmada_provisional' to cita_estado_enum
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction reliably
-- on PostgreSQL (< v12) and must be a standalone statement in PG 12+ when the
-- same transaction also uses the new value. Supabase wraps each migration file
-- in its own transaction, so keeping one ADD VALUE per file is safest.
--
-- Run via: Supabase SQL Editor (do NOT use CLI migrate with --local if you need
-- to apply to production immediately; paste this SQL directly).

ALTER TYPE cita_estado_enum ADD VALUE IF NOT EXISTS 'confirmada_provisional';
