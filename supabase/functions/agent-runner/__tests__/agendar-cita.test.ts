/**
 * __tests__/agendar-cita.test.ts — Unit tests for executeAgendarCita in tools.ts (Deno test runner)
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --no-check --node-modules-dir=auto __tests__/agendar-cita.test.ts
 *
 * Mocking approach: optional 3rd param DI (supabaseOverride) on executeAgendarCita.
 * Rationale: executeAgendarCita calls getSupabase() internally (same pattern as all
 * other tools in tools.ts). Refactoring to use fetch-stubbing would require intercepting
 * low-level Supabase REST URL patterns, which is brittle. The optional-arg DI approach
 * is backward-compatible (callers in index.ts are unaffected) and keeps tests stable.
 * Design doc Section 2.2 explicitly pre-approved this fallback.
 *
 * NOTE on TDD mode: strict_tdd=true is set for the sofia-ia project (Vitest for Next.js).
 * This test file uses deno test (not Vitest) because it targets a Deno Edge Function.
 * The TDD spirit is applied: test cases are written to the spec scenarios and verify
 * observable behavior, not implementation details.
 *
 * Service ID: alimentario_mensual — verified agendable=true in config.ts catalog.
 */

import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeAgendarCita } from "../tools.ts";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type AgendarMockState = {
  existingPatient: Record<string, unknown> | null;
  patientsInserted: Record<string, unknown>[];
  patientsUpdated: Record<string, unknown>[];
  citasInserted: Record<string, unknown>[];
  convUpdated: Record<string, unknown>[];
};

/**
 * Build a chainable Supabase mock shaped after the actual call sequences in executeAgendarCita:
 *
 * 1. from('citas').select('id').eq('fecha', ...).eq('hora', ...).not(...) → { data: [] }
 * 2. from('pacientes').select('id').eq('telefono', ...).single() → { data: patient | null }
 * 3. from('pacientes').update({...}).eq('id', ...) → { data: null }  [update path]
 * 4. from('pacientes').insert({...}).select().single() → { data: { id } } [insert path]
 * 5. from('citas').insert({...}).select().single() → { data: { id } }
 * 6. from('conversaciones').update({...}).eq('id', ...) → { data: null }
 */
function makeMockSupabase(state: AgendarMockState) {
  return {
    from: (table: string) => {
      // ── citas table ──────────────────────────────────────────────────────
      if (table === "citas") {
        // Supports two patterns:
        // A) slot check: .select().eq().eq().not() → Promise<{data, error}>
        // B) insert: .insert().select().single() → Promise<{data, error}>
        const citasObj = {
          select: (_cols?: string) => ({
            eq: (_c1: string, _v1: unknown) => ({
              eq: (_c2: string, _v2: unknown) => ({
                not: (_c3: string, _op: string, _v3: unknown) =>
                  Promise.resolve({ data: [], error: null }), // slot is always free
              }),
            }),
          }),
          insert: (rows: unknown) => {
            const data = Array.isArray(rows) ? rows[0] : rows;
            state.citasInserted.push(data as Record<string, unknown>);
            return {
              select: () => ({
                single: () => Promise.resolve({
                  data: { id: "cita-new-1", ...(data as Record<string, unknown>) },
                  error: null,
                }),
              }),
            };
          },
        };
        return citasObj;
      }

      // ── pacientes table ──────────────────────────────────────────────────
      if (table === "pacientes") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: state.existingPatient, error: null }),
            }),
          }),
          update: (vals: unknown) => {
            state.patientsUpdated.push(vals as Record<string, unknown>);
            return {
              eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: null }),
            };
          },
          insert: (rows: unknown) => {
            const data = Array.isArray(rows) ? rows[0] : rows;
            state.patientsInserted.push(data as Record<string, unknown>);
            return {
              select: () => ({
                single: () => Promise.resolve({
                  data: { id: "pac-new-1", ...(data as Record<string, unknown>) },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      // ── conversaciones table ─────────────────────────────────────────────
      if (table === "conversaciones") {
        return {
          update: (vals: unknown) => {
            state.convUpdated.push(vals as Record<string, unknown>);
            return {
              eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: null }),
            };
          },
        };
      }

      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  };
}

// Minimal valid args for agendar_cita (no paciente_telefono).
// Use alimentario_mensual — verified agendable=true in config.ts catalog.
const VALID_ARGS = {
  paciente_nombre: "Ana Torres",
  paciente_fecha_nacimiento: "1990-03-15",
  paciente_email: null,
  servicio_id: "alimentario_mensual",
  fecha: "2026-06-10",
  hora: "10:00",
  modalidad: "presencial",
  zona: "norte",
  motivo: "Bajar de peso",
  monto_adelanto: 17.50,
  precio_total: 35.00,
};

const VALID_CONTEXT = {
  senderNumber: "+593987654321",
  conversacion_id: "conv-1",
  paciente_id: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("executeAgendarCita — Scenario 1: new patient insert uses senderNumber, not args", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: AgendarMockState = {
    existingPatient: null, // no existing patient
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
    convUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  const result = JSON.parse(
    await executeAgendarCita(VALID_ARGS, VALID_CONTEXT, supabase as any),
  );

  assertEquals(result.success, true, "Expected success: true");
  assertExists(result.cita_id, "Expected cita_id in result");

  // Core assertion: telefono in insert must equal senderNumber
  assertEquals(state.patientsInserted.length, 1, "Expected exactly 1 pacientes insert");
  assertEquals(
    state.patientsInserted[0]!.telefono,
    "+593987654321",
    "telefono must equal context.senderNumber",
  );

  assertEquals(
    state.patientsInserted[0]!.nombre,
    "Ana Torres",
    "nombre must come from args",
  );
});

Deno.test("executeAgendarCita — Scenario 2: existing patient lookup uses senderNumber", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: AgendarMockState = {
    existingPatient: { id: "pac-existing-1", nombre: "Ana Torres", telefono: "+593987654321" },
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
    convUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  const result = JSON.parse(
    await executeAgendarCita(VALID_ARGS, VALID_CONTEXT, supabase as any),
  );

  assertEquals(result.success, true, "Expected success: true");

  // No new patient row should be created
  assertEquals(state.patientsInserted.length, 0, "Must NOT insert a new patient when patient exists");

  // Existing patient should be updated but NOT telefono
  assertEquals(state.patientsUpdated.length, 1, "Expected 1 patient update");
  assertEquals(
    (state.patientsUpdated[0] as Record<string, unknown>).telefono,
    undefined,
    "update payload must NOT include telefono (phone is never overwritten)",
  );
});

Deno.test("executeAgendarCita — Scenario 3: hallucinated paciente_telefono is ignored, console.warn fires", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: AgendarMockState = {
    existingPatient: null,
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
    convUpdated: [],
  };

  // Capture console.warn
  const warnCalls: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnCalls.push(args); };

  try {
    const argsWithPhone = {
      ...VALID_ARGS,
      paciente_telefono: "+999000000000", // hallucinated value, different from senderNumber
    };

    const supabase = makeMockSupabase(state);
    const result = JSON.parse(
      await executeAgendarCita(argsWithPhone, VALID_CONTEXT, supabase as any),
    );

    assertEquals(result.success, true, "Expected success: true even with hallucinated paciente_telefono");

    // Core: DB must use senderNumber, never the hallucinated value
    assertEquals(state.patientsInserted.length, 1, "Expected 1 insert");
    assertEquals(
      state.patientsInserted[0]!.telefono,
      "+593987654321",
      "telefono must equal senderNumber, not paciente_telefono from args",
    );

    // Observability: warn must have fired
    assertEquals(warnCalls.length >= 1, true, "Expected console.warn to fire for paciente_telefono mismatch");
    const warnMsg = String(warnCalls[0]![0]);
    assertStringIncludes(warnMsg, "[agendar_cita]", "warn message must include [agendar_cita] prefix");
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("executeAgendarCita — Defensive: empty senderNumber returns error, no DB writes", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: AgendarMockState = {
    existingPatient: null,
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
    convUpdated: [],
  };

  const supabase = makeMockSupabase(state);

  // Test with empty string
  const contextEmpty = { ...VALID_CONTEXT, senderNumber: "" };
  const resultEmpty = JSON.parse(
    await executeAgendarCita(VALID_ARGS, contextEmpty, supabase as any),
  );
  assertStringIncludes(
    resultEmpty.error,
    "Identidad del paciente",
    "Must return identity error for empty senderNumber",
  );
  assertEquals(state.patientsInserted.length, 0, "No DB writes on empty senderNumber");
  assertEquals(state.citasInserted.length, 0, "No cita insert on empty senderNumber");

  // Test with undefined senderNumber (context without the field)
  const contextUndef = { conversacion_id: "conv-1", paciente_id: null };
  const resultUndef = JSON.parse(
    await executeAgendarCita(VALID_ARGS, contextUndef, supabase as any),
  );
  assertStringIncludes(
    resultUndef.error,
    "Identidad del paciente",
    "Must return identity error for undefined senderNumber",
  );
});

Deno.test("executeAgendarCita — Schema-compat: args without paciente_telefono do not hit required-args guard", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: AgendarMockState = {
    existingPatient: null,
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
    convUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  const result = JSON.parse(
    await executeAgendarCita(VALID_ARGS, VALID_CONTEXT, supabase as any),
  );

  // Must NOT return the required-params error
  assertEquals(
    result.error,
    undefined,
    "Must NOT return 'Faltan parámetros requeridos' when paciente_telefono is absent from args",
  );
  assertEquals(result.success, true, "Must succeed without paciente_telefono in args");
});
