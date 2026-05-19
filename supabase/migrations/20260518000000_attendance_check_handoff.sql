-- Migration: handoff de confirmación de asistencia para Kely.
--
-- Antes: cita confirmada + 15min sin acción → el sistema marcaba `no_show`
--        automáticamente y avisaba a Kely por Telegram. Esto convertía en
--        no-show citas a las que el paciente sí llegó pero Kely todavía no
--        había tocado nada en el sistema.
--
-- Ahora: cita confirmada + 15min sin acción → el sistema pregunta a Kely
--        por Telegram con botones inline "[Sí, vino] [No vino]". La cita
--        queda en `confirmada` hasta que Kely responda. Su respuesta la
--        manda a `completada` o `no_show`.
--
-- Columna nueva para no preguntar dos veces. Default FALSE; pero hacemos
-- backfill TRUE para toda cita confirmada con fecha anterior a hoy, para
-- evitar que al deployar se disparen Telegrams retroactivos por citas
-- pasadas que quedaron en `confirmada`.

ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS attendance_check_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill anti-avalancha: citas pasadas confirmadas no deben gatillar pregunta.
UPDATE public.citas
SET attendance_check_sent = TRUE
WHERE estado = 'confirmada'
  AND fecha < (now() AT TIME ZONE 'America/Guayaquil')::date;

-- Índice parcial para que el cron filtre rápido sólo lo pendiente.
CREATE INDEX IF NOT EXISTS idx_citas_attendance_pendiente
  ON public.citas (fecha, hora)
  WHERE estado = 'confirmada' AND attendance_check_sent = FALSE;
