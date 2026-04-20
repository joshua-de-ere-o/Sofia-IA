-- Migration: sistema de tareas personales para Dra. Kely + cambio de cron a cada 10 min.
--
-- Parte 1: tabla `tareas` donde se guardan recordatorios personales parseados
--          desde mensajes de Telegram. fecha_hora en timestamptz (UTC), el
--          parseo desde Telegram convierte hora Guayaquil -> UTC.
--
-- Parte 2: columna `last_summary_date` en configuracion para dedup del resumen
--          matutino (evita doble envío si el cron de 07:30 Quito dispara dos
--          veces por cualquier razón).
--
-- Parte 3: el cron `enviar-recordatorios-hourly` ('0 * * * *') pasa a
--          `enviar-recordatorios-10min` ('*/10 * * * *'). La Edge Function
--          discrimina internamente qué corre en cada tick.

-- 1. Tabla tareas
CREATE TABLE IF NOT EXISTS public.tareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descripcion TEXT NOT NULL,
  fecha_hora TIMESTAMP WITH TIME ZONE NOT NULL,
  enviado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tareas_pendientes
  ON public.tareas (fecha_hora)
  WHERE enviado = FALSE;

ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
-- Sin políticas públicas: sólo service_role (que bypassa RLS) escribe/lee.

-- 2. Dedup de resumen matutino
ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS last_summary_date DATE;

-- 3. Reemplazar cron horario por cada 10 min
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('enviar-recordatorios-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('enviar-recordatorios-10min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'enviar-recordatorios-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://azrftqhescniopmleolm.supabase.co/functions/v1/enviar-recordatorios',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'kelly-cron-secret-2026'
    )::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
