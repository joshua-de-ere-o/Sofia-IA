/**
 * __tests__/payment-flow.test.ts — Unit tests for payment-flow.ts (Deno test runner)
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net __tests__/payment-flow.test.ts
 *
 * Mocks: Supabase client + Telegram fetch + OCR (via globalThis.fetch override).
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseDb } from "../payment-flow.ts";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type SupabaseMockState = {
  cita: Record<string, unknown> | null;
  pagosInserted: Record<string, unknown>[];
  citasUpdated: Record<string, unknown>[];
  pendingInserted: Record<string, unknown>[];
  convUpdated: Record<string, unknown>[];
  waMessages: string[];
  tgCalls: Array<{ method: string; body: Record<string, unknown> }>;
};

function makeMockSupabase(state: SupabaseMockState) {
  // A chainable Supabase query builder mock
  const chain = (result: unknown) => {
    const obj = {
      select: (_cols?: string) => obj,
      eq: (_col: string, _val: unknown) => obj,
      single: () => Promise.resolve({ data: result, error: null }),
      maybeSingle: () => Promise.resolve({ data: result, error: null }),
      insert: (rows: unknown) => {
        const data = Array.isArray(rows) ? rows[0] : rows;
        if ((data as Record<string, unknown>).action_type === "aprobar_pago") {
          state.pendingInserted.push(data as Record<string, unknown>);
        } else if ((data as Record<string, unknown>).monto !== undefined || (data as Record<string, unknown>).referencia !== undefined) {
          state.pagosInserted.push(data as Record<string, unknown>);
        }
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: { id: "pago-uuid-1", ...(data as Record<string, unknown>) },
              error: null,
            }),
          }),
        };
      },
      update: (vals: unknown) => {
        if ((vals as Record<string, unknown>).estado) {
          state.citasUpdated.push(vals as Record<string, unknown>);
        } else {
          state.convUpdated.push(vals as Record<string, unknown>);
        }
        return obj;
      },
    };
    return obj;
  };

  return {
    from: (table: string) => {
      if (table === "citas") {
        return chain(state.cita);
      }
      if (table === "conversaciones") {
        return chain({ id: "conv-1", last_message_at: new Date(Date.now() - 3600_000).toISOString() });
      }
      if (table === "pagos") {
        return chain(null); // no duplicate by default
      }
      if (table === "pending_kelly_actions") {
        return chain(null);
      }
      return chain(null);
    },
  };
}

// ─── OCR mock helpers ─────────────────────────────────────────────────────────

function mockOcrResponse(monto: number | null, esComprobante = true) {
  return (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof _url === "string" ? _url : _url.toString();
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: JSON.stringify({ monto, es_comprobante: esComprobante }) }],
              },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    // YCloud send message
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  };
}

function mockOcrTimeout() {
  return (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    // Simulate an OCR timeout by waiting longer than the abort signal
    return new Promise((_resolve, reject) => {
      const abort = (_init as RequestInit & { signal?: AbortSignal })?.signal;
      if (abort) {
        abort.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }
    });
  };
}

// Helper: replace globalThis.fetch for the duration of a test
function withMockedFetch(
  mockFn: typeof fetch,
  testFn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mockFn;
  return testFn().finally(() => {
    globalThis.fetch = original;
  });
}

// ─── Import SUT ───────────────────────────────────────────────────────────────

const { handlePaymentFlow } = await import("../payment-flow.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("handlePaymentFlow — Zona Sur (monto_adelanto=0): skips OCR, returns M6", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");
  Deno.env.set("TELEGRAM_BOT_TOKEN", "test-tg");

  const state: SupabaseMockState = {
    cita: { id: "cita-1", monto_adelanto: 0, estado: "pendiente_pago", servicio_id: "virtual", fecha_hora: "2026-06-01T10:00:00", paciente_id: "pac-1" },
    pagosInserted: [], citasUpdated: [], pendingInserted: [], convUpdated: [], waMessages: [], tgCalls: [],
  };
  const supabase = makeMockSupabase(state);

  const body = {
    senderNumber: "+593999000001",
    context: { imagen_recibida: true as const, image_url: "https://example.com/img.jpg", cita_id: "cita-1", wamid: "wamid-1" },
  };

  let waSent: string | null = null;
  await withMockedFetch(
    (_url, _init) => {
      // Capture WA message but don't simulate OCR (should not be called)
      const url = typeof _url === "string" ? _url : _url.toString();
      if (url.includes("ycloud")) {
        const reqBody = JSON.parse((_init as { body?: string })?.body ?? "{}");
        waSent = reqBody?.text?.body ?? null;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
    async () => {
      const result = await handlePaymentFlow(body, supabase as unknown as SupabaseDb);
      assertEquals(result.status, 200);
      assertEquals(state.pagosInserted.length, 0);
      assertEquals(state.citasUpdated.length, 0);
      // WA message should contain "Zona Sur" or "no requiere señal"
      assertExists(waSent);
    },
  );
});

Deno.test("handlePaymentFlow — OCR ok, monto matches: inserts pagos + transitions cita + calls Telegram", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");
  Deno.env.set("TELEGRAM_BOT_TOKEN", "test-tg");
  Deno.env.set("TELEGRAM_CHAT_ID", "12345");

  const state: SupabaseMockState = {
    cita: {
      id: "cita-2",
      monto_adelanto: 17.50,
      estado: "pendiente_pago",
      servicio_id: "alimentario_mensual",
      fecha_hora: "2026-06-01T10:00:00",
      paciente_id: "pac-2",
    },
    pagosInserted: [], citasUpdated: [], pendingInserted: [], convUpdated: [], waMessages: [], tgCalls: [],
  };

  // Extended mock with pacientes table
  const supabase = {
    from: (table: string) => {
      if (table === "citas") {
        const q = {
          select: (_cols?: string) => q,
          eq: (_c: string, _v: unknown) => q,
          single: () => Promise.resolve({ data: state.cita, error: null }),
          update: (vals: Record<string, unknown>) => {
            state.citasUpdated.push(vals);
            return q;
          },
        };
        return q;
      }
      if (table === "pacientes") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: "pac-2", nombre: "Ana Torres", telefono: "+593987654321", objetivo: "bajar peso" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "servicios") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { nombre: "Plan Alimentario Mensual" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "conversaciones") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { id: "conv-2", last_message_at: new Date(Date.now() - 3600_000).toISOString() },
                  error: null,
                }),
              }),
            }),
          }),
          update: (vals: Record<string, unknown>) => {
            state.convUpdated.push(vals);
            return { eq: () => ({ eq: () => ({}) }) };
          },
        };
      }
      if (table === "pagos") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: (rows: unknown) => {
            const data = Array.isArray(rows) ? rows[0] : rows;
            state.pagosInserted.push(data as Record<string, unknown>);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: "pago-uuid-2", ...(data as Record<string, unknown>) }, error: null }),
              }),
            };
          },
        };
      }
      if (table === "pending_kelly_actions") {
        return {
          insert: (rows: unknown) => {
            const data = Array.isArray(rows) ? rows[0] : rows;
            state.pendingInserted.push(data as Record<string, unknown>);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: "pkg-uuid-1", ...(data as Record<string, unknown>) }, error: null }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  };

  const body = {
    senderNumber: "+593999000002",
    context: {
      imagen_recibida: true as const,
      image_url: "https://example.com/receipt.jpg",
      cita_id: "cita-2",
      wamid: "wamid-2",
    },
  };

  let waSent: string | null = null;
  let tgCalled = false;

  await withMockedFetch(
    (url, init) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"monto": 17.5, "es_comprobante": true}' }] } }] }),
            { status: 200 },
          ),
        );
      }
      if (u.includes("ycloud")) {
        const reqBody = JSON.parse((init as { body?: string })?.body ?? "{}");
        waSent = reqBody?.text?.body ?? null;
      }
      if (u.includes("api.telegram.org")) {
        tgCalled = true;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    },
    async () => {
      const result = await handlePaymentFlow(body, supabase as unknown as SupabaseDb);
      assertEquals(result.status, 200);
      assertEquals(state.pagosInserted.length, 1);
      assertEquals(state.pagosInserted[0]!.monto, 17.5);
      assertEquals(state.pagosInserted[0]!.verificado, false);
      assertEquals(state.citasUpdated.length, 1);
      assertEquals(state.citasUpdated[0]!.estado, "confirmada_provisional");
      assertEquals(state.pendingInserted.length, 1);
      assertEquals(state.pendingInserted[0]!.action_type, "aprobar_pago");
      assertExists(waSent); // M1 sent to patient
      assertEquals(tgCalled, true); // Telegram notified
    },
  );
});

Deno.test("handlePaymentFlow — OCR ok, underpayment: no DB writes, sends M2", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");

  const state: SupabaseMockState = {
    cita: {
      id: "cita-3",
      monto_adelanto: 17.50,
      estado: "pendiente_pago",
      servicio_id: "alimentario_mensual",
      fecha_hora: "2026-06-01T10:00:00",
      paciente_id: "pac-3",
    },
    pagosInserted: [], citasUpdated: [], pendingInserted: [], convUpdated: [], waMessages: [], tgCalls: [],
  };

  const supabase = {
    from: (table: string) => {
      if (table === "citas") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.cita, error: null }) }) }) };
      }
      if (table === "pacientes") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { nombre: "Luis", telefono: "+593999", objetivo: null }, error: null }) }) }) };
      }
      if (table === "servicios") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { nombre: "Plan Mensual" }, error: null }) }) }) };
      }
      if (table === "pagos") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      if (table === "conversaciones") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: "c3", last_message_at: new Date().toISOString() }, error: null }) }) }) }),
          update: () => ({ eq: () => ({ eq: () => ({}) }) }),
        };
      }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  };

  const body = {
    senderNumber: "+593999000003",
    context: { imagen_recibida: true as const, image_url: "https://example.com/r.jpg", cita_id: "cita-3", wamid: "wamid-3" },
  };

  let waSent: string | null = null;

  await withMockedFetch(
    (url, init) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"monto": 5.0, "es_comprobante": true}' }] } }] }),
            { status: 200 },
          ),
        );
      }
      if (u.includes("ycloud")) {
        const reqBody = JSON.parse((init as { body?: string })?.body ?? "{}");
        waSent = reqBody?.text?.body ?? null;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
    async () => {
      const result = await handlePaymentFlow(body, supabase as unknown as SupabaseDb);
      assertEquals(result.status, 200);
      assertEquals(state.pagosInserted.length, 0);
      assertEquals(state.citasUpdated.length, 0);
      assertEquals(state.pendingInserted.length, 0);
      assertExists(waSent); // M2 sent
    },
  );
});

Deno.test("handlePaymentFlow — OCR returns null: no DB writes, sends M3", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");

  const state: SupabaseMockState = {
    cita: {
      id: "cita-4", monto_adelanto: 17.50, estado: "pendiente_pago",
      servicio_id: "alimentario_mensual", fecha_hora: "2026-06-01T10:00:00", paciente_id: "pac-4",
    },
    pagosInserted: [], citasUpdated: [], pendingInserted: [], convUpdated: [], waMessages: [], tgCalls: [],
  };

  const convUpdates: Record<string, unknown>[] = [];

  const supabase = {
    from: (table: string) => {
      if (table === "citas") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.cita, error: null }) }) }) };
      }
      if (table === "pacientes") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { nombre: "X", telefono: "+1", objetivo: null }, error: null }) }) }) };
      }
      if (table === "pagos") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      if (table === "conversaciones") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: "c4", last_message_at: new Date().toISOString() }, error: null }) }) }) }),
          update: (vals: Record<string, unknown>) => {
            convUpdates.push(vals);
            return { eq: () => ({ eq: () => ({}) }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  };

  const body = {
    senderNumber: "+593999000004",
    context: { imagen_recibida: true as const, image_url: "https://example.com/null.jpg", cita_id: "cita-4", wamid: "wamid-4" },
  };

  let waSent: string | null = null;

  await withMockedFetch(
    (url, init) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"monto": null, "es_comprobante": true}' }] } }] }),
            { status: 200 },
          ),
        );
      }
      if (u.includes("ycloud")) {
        const reqBody = JSON.parse((init as { body?: string })?.body ?? "{}");
        waSent = reqBody?.text?.body ?? null;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
    async () => {
      const result = await handlePaymentFlow(body, supabase as unknown as SupabaseDb);
      assertEquals(result.status, 200);
      assertEquals(state.pagosInserted.length, 0);
      assertEquals(state.citasUpdated.length, 0);
      assertExists(waSent); // M3
      // conversaciones should be updated with pending_payment_confirmation_cita_id
      const convUpdate = convUpdates.find((u) => u.pending_payment_confirmation_cita_id !== undefined);
      assertExists(convUpdate);
      assertEquals(convUpdate.pending_payment_confirmation_cita_id, "cita-4");
    },
  );
});

Deno.test("handlePaymentFlow — already confirmada_provisional: skips OCR, sends M7", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");

  const state: SupabaseMockState = {
    cita: {
      id: "cita-5", monto_adelanto: 17.50, estado: "confirmada_provisional",
      servicio_id: "alimentario_mensual", fecha_hora: "2026-06-01T10:00:00", paciente_id: "pac-5",
    },
    pagosInserted: [], citasUpdated: [], pendingInserted: [], convUpdated: [], waMessages: [], tgCalls: [],
  };

  const supabase = {
    from: (table: string) => {
      if (table === "citas") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.cita, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  };

  const body = {
    senderNumber: "+593999000005",
    context: { imagen_recibida: true as const, image_url: "https://example.com/dup.jpg", cita_id: "cita-5", wamid: "wamid-5" },
  };

  let waSent: string | null = null;
  let geminiCalled = false;

  await withMockedFetch(
    (url, init) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("generativelanguage")) geminiCalled = true;
      if (u.includes("ycloud")) {
        const reqBody = JSON.parse((init as { body?: string })?.body ?? "{}");
        waSent = reqBody?.text?.body ?? null;
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
    async () => {
      const result = await handlePaymentFlow(body, supabase as unknown as SupabaseDb);
      assertEquals(result.status, 200);
      assertEquals(geminiCalled, false); // OCR must NOT be called
      assertEquals(state.pagosInserted.length, 0);
      assertExists(waSent); // M7
    },
  );
});
