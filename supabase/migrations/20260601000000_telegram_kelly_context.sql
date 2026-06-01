-- Additive table for ephemeral per-chat search context (conversational bulk reschedule).
-- Deployment-safety: pure CREATE, no existing object touched.
-- Safe to apply before or after PR 2a code deploys (code tolerates absence via REQ-2.5).
CREATE TABLE IF NOT EXISTS public.telegram_kelly_context (
  chat_id     text PRIMARY KEY,
  last_search jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- last_search shape:
--   { "criteria": { "zona": "norte", "fecha_desde": "2026-06-02", "fecha_hasta": "2026-06-02",
--                   "hora_desde": "07:00", "hora_hasta": "09:00" },
--     "citas": [ { "cita_id": "uuid", "paciente_nombre": "…", "fecha": "YYYY-MM-DD",
--                  "hora": "HH:MM", "duracion_min": 30 } ] }
-- TTL handled in app: rows older than 30 min are ignored on read.
COMMENT ON TABLE public.telegram_kelly_context
  IS 'Ephemeral last-bulk-search per Telegram chat; 30-min app-enforced TTL.';
