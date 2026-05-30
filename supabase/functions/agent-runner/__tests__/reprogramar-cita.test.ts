/**
 * __tests__/reprogramar-cita.test.ts — Unit tests for executeReprogramarCita in tools.ts (Deno test runner)
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --no-check --node-modules-dir=auto __tests__/reprogramar-cita.test.ts
 *
 * Mocking approach: optional 3rd param DI (supabaseOverride) on executeReprogramarCita,
 * mirroring executeAgendarCita. executeReprogramarCita calls getSupabase() internally;
 * the optional-arg DI is backward-compatible (callers in index.ts are unaffected).
 *
 * NOTE on TDD mode: strict_tdd=true for sofia-ia (Vitest for Next.js). This file uses
 * deno test because it targets a Deno Edge Function; the TDD spirit is applied — cases
 * are written to the spec scenarios and verify observable behavior.
 *
 * Focus: the reschedule slot check must reject INTERVAL OVERLAP by real duration,
 * not only exact start-time matches (same contract as executeAgendarCita).
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeReprogramarCita } from "../tools.ts";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type ReprogramarMockState = {
  cita: Record<string, unknown> | null; // active cita found for the patient
  completadaCount: number; // drives isHabitual / minHours
  slotConflicts: Record<string, unknown>[]; // rows on the target date
  citasUpdated: Record<string, unknown>[]; // captured update payloads
};

/**
 * Chainable Supabase mock shaped after the call sequences in executeReprogramarCita:
 *
 * A) from('citas').select('id, fecha, hora, duracion_min').eq('paciente_id',_)
 *      .in('estado',_).order().order().limit().single()  → { data: cita }
 * B) from('citas').select('id', {count:'exact'}).eq('paciente_id',_)
 *      .eq('estado','completada')                          → { count }
 * C) from('citas').select('id, hora, duracion_min, estado').eq('fecha',_)
 *      .neq('id',_).not('estado','in',_)                   → { data: slotConflicts }
 * D) from('citas').update({...}).eq('id',_)                → { data: null }
 */
function makeMockSupabase(state: ReprogramarMockState) {
  return {
    from: (_table: string) => ({
      select: (_cols?: string, opts?: { count?: string }) => {
        // Path B: count select for isHabitual
        if (opts && opts.count) {
          return {
            eq: (_c1: string, _v1: unknown) => ({
              eq: (_c2: string, _v2: unknown) =>
                Promise.resolve({ count: state.completadaCount, error: null }),
            }),
          };
        }
        // Paths A and C share the first .eq(col, val)
        return {
          eq: (col: string, val: unknown) => ({
            // Path A: .in(...).order().order().limit().single()
            in: (_c: string, _vals: unknown) => ({
              order: () => ({
                order: () => ({
                  limit: () => ({
                    single: () => Promise.resolve({ data: state.cita, error: null }),
                  }),
                }),
              }),
            }),
            // Path C: .neq('id', citaId).not('estado','in',_)
            neq: (ncol: string, nval: unknown) => ({
              not: (_a: string, _op: string, _v: unknown) =>
                Promise.resolve({
                  data: state.slotConflicts.filter(
                    (row) => row[col] === val && row[ncol] !== nval,
                  ),
                  error: null,
                }),
            }),
          }),
        };
      },
      update: (vals: unknown) => {
        state.citasUpdated.push(vals as Record<string, unknown>);
        return {
          eq: (_c: string, _v: unknown) => Promise.resolve({ data: null, error: null }),
        };
      },
    }),
  };
}

// A cita comfortably outside the 24h/48h policy window so we reach the slot check.
const FAR_FUTURE_DATE = "2099-01-10";
const CITA_60MIN = {
  id: "cita-mover-1",
  fecha: FAR_FUTURE_DATE,
  hora: "12:00:00",
  duracion_min: 60,
};

const CONTEXT = { paciente_id: "pac-1" };

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("executeReprogramarCita — rejects overlap when a 60-minute appointment covers the new start", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: ReprogramarMockState = {
    cita: CITA_60MIN,
    completadaCount: 1, // habitual → 24h window
    // Another 60-min cita at 09:00 occupies 09:00–10:00 on the target date.
    slotConflicts: [
      { id: "cita-otra-1", fecha: FAR_FUTURE_DATE, hora: "09:00:00", duracion_min: 60, estado: "confirmada" },
    ],
    citasUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  // Reschedule to 09:30 — exact-start check would pass, but 09:30 falls inside 09:00–10:00.
  const result = JSON.parse(
    await executeReprogramarCita(
      { nueva_fecha: FAR_FUTURE_DATE, nueva_hora: "09:30", motivo: "cambio" },
      CONTEXT,
      supabase as any,
    ),
  );

  assertStringIncludes(result.error, "ocupado", "Must reject interval overlap, not only exact start matches");
  assertEquals(state.citasUpdated.length, 0, "Must not update the cita when the new slot overlaps");
});

Deno.test("executeReprogramarCita — allows reschedule to a non-overlapping slot", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: ReprogramarMockState = {
    cita: CITA_60MIN,
    completadaCount: 1,
    slotConflicts: [
      { id: "cita-otra-1", fecha: FAR_FUTURE_DATE, hora: "09:00:00", duracion_min: 60, estado: "confirmada" },
    ],
    citasUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  // 10:00 starts exactly when the 09:00–10:00 block ends → no overlap.
  const result = JSON.parse(
    await executeReprogramarCita(
      { nueva_fecha: FAR_FUTURE_DATE, nueva_hora: "10:00", motivo: "cambio" },
      CONTEXT,
      supabase as any,
    ),
  );

  assertEquals(result.success, true, "Adjacent (non-overlapping) slot must be allowed");
  assertEquals(state.citasUpdated.length, 1, "Must persist the reschedule");
  assertEquals(state.citasUpdated[0]!.hora, "10:00:00", "Must update to the normalized new hora");
});

Deno.test("executeReprogramarCita — does not treat the cita being moved as a self-conflict", async () => {
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");

  const state: ReprogramarMockState = {
    cita: CITA_60MIN,
    completadaCount: 1,
    // The only row on the target date is the cita itself — must be excluded via neq('id').
    slotConflicts: [
      { id: "cita-mover-1", fecha: FAR_FUTURE_DATE, hora: "09:00:00", duracion_min: 60, estado: "confirmada" },
    ],
    citasUpdated: [],
  };

  const supabase = makeMockSupabase(state);
  // Move it within its own occupied window — must not block against itself.
  const result = JSON.parse(
    await executeReprogramarCita(
      { nueva_fecha: FAR_FUTURE_DATE, nueva_hora: "09:30", motivo: "cambio" },
      CONTEXT,
      supabase as any,
    ),
  );

  assertEquals(result.success, true, "Cita must not conflict with itself");
  assertEquals(state.citasUpdated.length, 1, "Must persist the reschedule");
});
