/**
 * __tests__/citas-context.test.ts — Unit tests for buildCitasActivasContext.
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --no-check --node-modules-dir=auto __tests__/citas-context.test.ts
 *
 * Contract: the active-appointments block is the ground truth injected every
 * turn so the LLM cannot repeat an out-of-band cancelled/rescheduled cita that
 * still lives in chat history.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCitasActivasContext,
  CITAS_ACTIVAS_STATES,
  todayGuayaquil,
} from "../citas-context.ts";

Deno.test("empty list → authoritative 'no active citas' block", () => {
  const out = buildCitasActivasContext([]);
  assertStringIncludes(out, "FUENTE DE VERDAD");
  assertStringIncludes(out, "NO tiene");
  assertStringIncludes(out, "NO la menciones como vigente");
});

Deno.test("null/undefined behaves like empty", () => {
  assertEquals(buildCitasActivasContext(null), buildCitasActivasContext([]));
  assertEquals(
    buildCitasActivasContext(undefined),
    buildCitasActivasContext([]),
  );
});

Deno.test("lists active citas with date, time, service and state", () => {
  const out = buildCitasActivasContext([
    {
      fecha: "2026-06-10",
      hora: "15:00:00",
      servicio: "Consulta Nutricional",
      modalidad: "presencial",
      zona: "norte",
      estado: "confirmada",
    },
  ]);
  assertStringIncludes(out, "FUENTE DE VERDAD");
  assertStringIncludes(out, "2026-06-10 15:00");
  assertStringIncludes(out, "Consulta Nutricional");
  assertStringIncludes(out, "(presencial, norte)");
  assertStringIncludes(out, "[confirmada]");
  // Must warn that anything not in the list is no longer valid.
  assertStringIncludes(out, "NO la trates como vigente");
});

Deno.test("renders multiple citas, one per line", () => {
  const out = buildCitasActivasContext([
    { fecha: "2026-06-10", hora: "15:00:00", servicio: "A", modalidad: "presencial", zona: "norte", estado: "confirmada" },
    { fecha: "2026-06-12", hora: "09:30:00", servicio: "B", modalidad: "virtual", zona: null, estado: "pendiente_pago" },
  ]);
  assertStringIncludes(out, "2026-06-10 15:00");
  assertStringIncludes(out, "2026-06-12 09:30");
  assertStringIncludes(out, "[pendiente_pago]");
  // virtual cita has no zona → no trailing ", null"
  assertStringIncludes(out, "(virtual)");
});

Deno.test("active states are the three live appointment states", () => {
  assertEquals([...CITAS_ACTIVAS_STATES], [
    "confirmada",
    "pendiente_pago",
    "confirmada_provisional",
  ]);
});

Deno.test("todayGuayaquil — daytime in Ecuador returns same UTC day", () => {
  // 2026-06-04 15:00 UTC === 2026-06-04 10:00 in Guayaquil
  assertEquals(todayGuayaquil(new Date("2026-06-04T15:00:00Z")), "2026-06-04");
});

Deno.test("todayGuayaquil — late night in Ecuador still returns today", () => {
  // 2026-06-05 02:00 UTC === 2026-06-04 21:00 in Guayaquil (toISOString would say 06-05)
  assertEquals(todayGuayaquil(new Date("2026-06-05T02:00:00Z")), "2026-06-04");
});

Deno.test("todayGuayaquil — rolls over only when Guayaquil crosses midnight", () => {
  // 2026-06-05 05:00 UTC === 2026-06-05 00:00 in Guayaquil
  assertEquals(todayGuayaquil(new Date("2026-06-05T05:00:00Z")), "2026-06-05");
});
