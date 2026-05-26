-- Migration: 20260527_001_add_santo_domingo_to_zona_enum
-- Adds 'santo_domingo' to the zona_enum type.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PostgreSQL.
-- This migration MUST be applied alone, before migration _002.
-- It is idempotent via IF NOT EXISTS.

ALTER TYPE zona_enum ADD VALUE IF NOT EXISTS 'santo_domingo';
