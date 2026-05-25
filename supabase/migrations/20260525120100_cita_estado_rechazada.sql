-- Migration: add 'rechazada' to cita_estado_enum
--
-- IMPORTANT: One ADD VALUE per file — see comment in 20260525120000 for rationale.
-- Run this AFTER 20260525120000_cita_estado_provisional.sql.

ALTER TYPE cita_estado_enum ADD VALUE IF NOT EXISTS 'rechazada';
