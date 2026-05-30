/**
 * Deno unit tests for validateCondensationSummary helper.
 * Run with: deno test --no-check supabase/functions/agent-runner/__tests__/condensation-validation.test.ts
 *
 * These tests are DETERMINISTIC — they never call the model.
 */
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { validateCondensationSummary } from "../condensation-validation.ts";

const VALID_SUMMARY = JSON.stringify({
  paciente_nombre: "Ana",
  paciente_es_existente: false,
  modalidad_elegida: "presencial",
  zona_elegida: "norte",
  plan_tentativo: "plan_nutricional",
  motivo_consulta: "bajar de peso",
  fecha_hora_tentativa: null,
  estado_flujo: "explorando",
  ultima_pregunta_pendiente: null,
  notas_relevantes: null,
});

// (a) Valid JSON summary → returned as canonical JSON string
Deno.test("validateCondensationSummary: valid JSON returns canonical summary", () => {
  const result = validateCondensationSummary(VALID_SUMMARY, null);
  // Must not be null
  if (result === null) throw new Error("Expected a string, got null");
  // Must round-trip through JSON.parse without throwing
  const parsed = JSON.parse(result);
  assertEquals(parsed.paciente_nombre, "Ana");
});

// (b) Truncated/malformed JSON + previous valid summary → previous summary retained
Deno.test("validateCondensationSummary: malformed JSON retains previous summary", () => {
  const truncated = '{"paciente_nombre": "Ana", "pac';
  const result = validateCondensationSummary(truncated, VALID_SUMMARY);
  assertStrictEquals(result, VALID_SUMMARY);
});

// (c) Malformed JSON + no previous summary → null (NEVER malformed output)
Deno.test("validateCondensationSummary: malformed JSON with no previous returns null", () => {
  const garbage = "no json at all";
  const result = validateCondensationSummary(garbage, null);
  assertStrictEquals(result, null);
});

// Guard: result is never a non-JSON string (would be invalid for DB / [ESTADO PREVIO])
Deno.test("validateCondensationSummary: result is always null or valid JSON", () => {
  const malformed = "{broken";
  const prev = VALID_SUMMARY;
  const result = validateCondensationSummary(malformed, prev);
  if (result !== null) {
    // If not null it must parse
    JSON.parse(result); // throws if invalid — test fails
  }
});
