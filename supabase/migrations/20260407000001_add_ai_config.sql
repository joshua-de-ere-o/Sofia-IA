-- Migration: Añadir columnas para IA y uso de API a la tabla configuracion

ALTER TABLE public.configuracion
ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'anthropic',
ADD COLUMN IF NOT EXISTS ai_api_key TEXT,
ADD COLUMN IF NOT EXISTS ycloud_daily_messages INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS ycloud_last_reset DATE DEFAULT CURRENT_DATE;
