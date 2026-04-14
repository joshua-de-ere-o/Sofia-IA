/**
 * lib/agent.js
 * System prompt + Tool definitions for Sofía (Claude Haiku 4.5)
 * Spec references: 01-agente.md, 03-agenda.md, 04-pagos.md, 05-handoff.md
 */

// SYSTEM_PROMPT y TOOLS viven en supabase/functions/agent-runner/config.ts.

// ─── Service catalog (shared reference) ───────────────────────────────────────
export const SERVICE_CATALOG = {
  inbody: { name: "Evaluación InBody 270", price: 20 },
  virtual: { name: "Consulta Virtual", price: 20 },
  quincenal: { name: "Plan Quincenal", price: 25 },
  esencial: { name: "Plan Esencial ⭐", price: 35 },
  premium: { name: "Plan Mensual Premium", price: 70 },
  trimestral: { name: "Plan Trimestral", price: 90 },
};

// ─── Model config (agnóstico al proveedor) ────────────────────────────────────
export const MODEL_CONFIG = {
  max_tokens_normal: 300,
  max_tokens_confirmation: 100,
  history_condensation_threshold: 6, // Condensar después de 6 mensajes
};

// ─── Factory deprecado ─────────────────────────────────────────────────────────
// El adaptador real vive en supabase/functions/agent-runner/model-adapter.ts.
export function getModelAdapter() {
  throw new Error(
    "getModelAdapter en lib/agent.js está deprecado. Usa supabase/functions/agent-runner/model-adapter.ts."
  );
}
