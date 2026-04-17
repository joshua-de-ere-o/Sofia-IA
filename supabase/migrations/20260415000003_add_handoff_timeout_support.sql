-- Migration: Soporte para auto-resolución de handoffs por timeout.
--
-- Problema: si Kelly no presiona "Terminé" tras un handoff, la conversación
-- queda bloqueada (handoff_activo=true) para siempre y Sofía deja de responder.
--
-- Solución: columna recordatorio_enviado + cron cada 5 min que invoca la
-- Edge Function resolver-handoffs. La función envía un recordatorio a Kelly
-- a los 10 min y auto-resuelve a los 30 min.

-- 1. Nueva columna
ALTER TABLE public.handoffs
  ADD COLUMN IF NOT EXISTS recordatorio_enviado BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Cron job cada 5 minutos (mismo patrón que enviar-recordatorios)
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'resolver-handoffs-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://azrftqhescniopmleolm.supabase.co/functions/v1/resolver-handoffs',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'kelly-cron-secret-2026'
    )::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
