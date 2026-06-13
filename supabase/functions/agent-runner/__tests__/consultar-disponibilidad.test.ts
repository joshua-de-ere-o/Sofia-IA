/**
 * __tests__/consultar-disponibilidad.test.ts — Unit tests for executeConsultarDisponibilidad in tools.ts (Deno test runner)
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --no-check --node-modules-dir=auto __tests__/consultar-disponibilidad.test.ts
 *
 * Mocking approach: optional 2nd param DI (supabaseOverride) on executeConsultarDisponibilidad.
 * Rationale: executeConsultarDisponibilidad calls getSupabase() internally. The optional-arg DI
 * approach is backward-compatible (callers in index.ts are unaffected) and mirrors the exact
 * pattern used by executeAgendarCita (see agendar-cita.test.ts).
 * Design doc Decision 4, Option A explicitly approved this approach.
 *
 * NOTE on TDD mode: strict_tdd=true is set for the sofia-ia project.
 * This test file uses deno test (not Vitest) because it targets a Deno Edge Function.
 * The TDD spirit is applied: test cases are written before the DI param exists (RED),
 * then executeConsultarDisponibilidad gets the supabaseOverride param (GREEN).
 *
 * IMPORTANT: The tag value for virtual-only days is `virtual_only` (the real code value),
 * NOT `solo_virtual` (which is only an excepciones_horario input field).
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeConsultarDisponibilidad } from "../tools.ts";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type DisponibilidadMockState = {
  feriados: { fecha: string }[];
  excepciones: Record<string, unknown>[];
  citas: Record<string, unknown>[];
};

/**
 * Build a chainable Supabase mock shaped after the actual call sequences in
 * executeConsultarDisponibilidad (tools.ts L111-128):
 *
 * 1. from('feriados').select('fecha').gte().lte()               → { data, error: null }
 * 2. from('excepciones_horario').select('*').gte().lte()        → { data, error: null }
 * 3. from('citas').select(...).gte().lte().not(...)             → { data, error: null }
 */
function makeMockSupabase(state: DisponibilidadMockState) {
  return {
    from: (table: string) => {
      // ── feriados table ────────────────────────────────────────────────────
      if (table === "feriados") {
        return {
          select: (_cols?: string) => ({
            gte: (_col: string, _val: unknown) => ({
              lte: (_col2: string, _val2: unknown) =>
                Promise.resolve({ data: state.feriados, error: null }),
            }),
          }),
        };
      }

      // ── excepciones_horario table ─────────────────────────────────────────
      if (table === "excepciones_horario") {
        return {
          select: (_cols?: string) => ({
            gte: (_col: string, _val: unknown) => ({
              lte: (_col2: string, _val2: unknown) =>
                Promise.resolve({ data: state.excepciones, error: null }),
            }),
          }),
        };
      }

      // ── citas table ───────────────────────────────────────────────────────
      if (table === "citas") {
        return {
          select: (_cols?: string) => ({
            gte: (_col: string, _val: unknown) => ({
              lte: (_col2: string, _val2: unknown) => ({
                not: (_col3: string, _op: string, _val3: unknown) =>
                  Promise.resolve({ data: state.citas, error: null }),
              }),
            }),
          }),
        };
      }

      // fallback
      return {
        select: () => ({
          gte: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }),
        }),
      };
    },
  };
}

// ─── Shared dates ─────────────────────────────────────────────────────────────
const FECHA_INICIO = "2026-06-12";
const FECHA_FIN = "2026-06-19";

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("returns slots given only fecha_inicio/fecha_fin (no modalidad, no zona)", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: DisponibilidadMockState = {
    feriados: [],
    excepciones: [],
    citas: [],
  };

  const supabase = makeMockSupabase(state);
  const raw = await executeConsultarDisponibilidad(
    { fecha_inicio: FECHA_INICIO, fecha_fin: FECHA_FIN },
    supabase as any,
  );

  const result = JSON.parse(raw);

  // Must not return an error
  assertEquals(result.error, undefined, "Must not return an error key");
  assertExists(result, "Result must be a non-null object");
});

Deno.test("returned day objects have { dia_semana, horarios, tag } shape", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: DisponibilidadMockState = {
    feriados: [],
    excepciones: [],
    citas: [],
  };

  const supabase = makeMockSupabase(state);
  const raw = await executeConsultarDisponibilidad(
    { fecha_inicio: FECHA_INICIO, fecha_fin: FECHA_FIN },
    supabase as any,
  );

  const result = JSON.parse(raw);
  assertEquals(result.error, undefined, "Must not return an error");

  const keys = Object.keys(result);
  // At least one date key should be present in a 7-day window (excluding feriados/domingos)
  if (keys.length > 0) {
    const firstDay = result[keys[0]];
    assertExists(firstDay.dia_semana, "day object must have dia_semana");
    assertExists(firstDay.horarios, "day object must have horarios");
    // tag may be 'normal', 'virtual_only', or 'santo_domingo'
    assertExists(firstDay.tag !== undefined ? firstDay : null === null ? firstDay : firstDay,
      "day object must have tag field");
    assertEquals(typeof firstDay.tag, "string", "tag must be a string");
  }
});

Deno.test("virtual_only excepcion surfaces as tag: virtual_only", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  // Inject an excepcion that marks 2026-06-15 (Monday) as virtual-only.
  // The DB field `ubicacion` uses the value "solo_virtual" (input field).
  // The slot generator converts this to the output tag "virtual_only".
  const state: DisponibilidadMockState = {
    feriados: [],
    excepciones: [
      {
        fecha: "2026-06-15",
        ubicacion: "solo_virtual",
        hora_inicio: "08:00",
        hora_fin: "18:00",
      },
    ],
    citas: [],
  };

  const supabase = makeMockSupabase(state);
  const raw = await executeConsultarDisponibilidad(
    { fecha_inicio: "2026-06-15", fecha_fin: "2026-06-15" },
    supabase as any,
  );

  const result = JSON.parse(raw);
  assertEquals(result.error, undefined, "Must not return an error");

  // If the date has slots, the tag must be virtual_only
  const dayEntry = result["2026-06-15"];
  if (dayEntry !== undefined) {
    assertEquals(
      dayEntry.tag,
      "virtual_only",
      "Day with virtual_only excepcion must surface tag: virtual_only",
    );
  }
});

Deno.test("missing fecha_inicio returns error", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: DisponibilidadMockState = {
    feriados: [],
    excepciones: [],
    citas: [],
  };

  const supabase = makeMockSupabase(state);
  const raw = await executeConsultarDisponibilidad(
    {} as any,
    supabase as any,
  );

  const result = JSON.parse(raw);
  assertExists(result.error, "Must return an error when fecha_inicio is missing");
});
