-- Migration: tabla pending_kelly_actions para acciones destructivas del modo-Kelly por Telegram.
--
-- Contexto:
--   Cuando Kelly pide reagendar/cancelar/bloquear via Telegram, el bot manda un
--   mensaje con botones inline [Si, confirmar] / [No, cancelar]. El callback_data
--   de Telegram tiene 64 bytes max -- no entran los args completos
--   (paciente_id UUID + fecha + hora + duracion + motivo). Solucion: persistimos
--   los args aca y referenciamos con un id corto en el callback_data.
--
-- Flujo:
--   1. LLM decide tool (reagendar_cita_kelly, etc.).
--   2. Resolvemos paciente, validamos fecha, INSERT en pending_kelly_actions.
--   3. Botones: callback_data = "kelly_confirm_<id>" / "kelly_cancel_<id>".
--   4. Al recibir callback: SELECT args, ejecutamos, UPDATE ejecutada=true.
--
-- Limpieza: expira_at default +1h. Una purga periodica (manual o cron futuro)
-- puede borrar filas vencidas y no ejecutadas.

CREATE TABLE IF NOT EXISTS public.pending_kelly_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type  TEXT NOT NULL,
  args         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  ejecutada    BOOLEAN NOT NULL DEFAULT FALSE,
  ejecutada_at TIMESTAMPTZ,
  CONSTRAINT pending_kelly_actions_tipo_valido
    CHECK (action_type IN ('reagendar', 'cancelar', 'bloqueo'))
);

CREATE INDEX IF NOT EXISTS pending_kelly_actions_expira_idx
  ON public.pending_kelly_actions (expira_at)
  WHERE ejecutada = FALSE;
