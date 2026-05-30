-- Switch maestro global de Sofía.
-- Cuando agente_activo = false, el agent-runner persiste el mensaje entrante
-- pero NO responde a ningún paciente (gate en supabase/functions/agent-runner).
-- DEFAULT true preserva el comportamiento actual hasta que alguien lo apague.

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS agente_activo boolean NOT NULL DEFAULT true;
