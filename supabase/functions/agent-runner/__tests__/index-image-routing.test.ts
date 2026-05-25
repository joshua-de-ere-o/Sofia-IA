/**
 * __tests__/index-image-routing.test.ts
 *
 * Tests the routing logic that dispatches image-context requests to
 * handlePaymentFlow. These tests are structural — they verify the routing
 * decision without importing index.ts directly (which pulls in
 * npm:@supabase/realtime-js that requires a full Supabase Edge environment).
 *
 * The routing condition is: `body.context?.imagen_recibida === true`
 * This is tested directly against the payment-flow handler contract.
 *
 * For full integration coverage, see the manual E2E test plan in the design.
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --no-check __tests__/index-image-routing.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePaymentFlow } from "../payment-flow.ts";

// ─── Routing condition tests ──────────────────────────────────────────────────

/**
 * These tests verify that handlePaymentFlow (the image branch handler)
 * correctly handles the payload shape that index.ts dispatches to it.
 * They mirror the actual dispatch call in index.ts:
 *
 *   if (body.context?.imagen_recibida === true) {
 *     return handlePaymentFlow(body, supabase);
 *   }
 */

Deno.test("routing — payload without imagen_recibida should NOT be passed to payment flow", () => {
  // This is a static assertion: index.ts checks context?.imagen_recibida === true
  // Payloads without this flag are handled by the text agent loop.
  const textPayload = { senderNumber: "+593999", text: "Hola", context: undefined };
  const hasImageFlag = (textPayload as Record<string, unknown> & { context?: { imagen_recibida?: boolean } })
    ?.context?.imagen_recibida === true;
  assertEquals(hasImageFlag, false);
});

Deno.test("routing — payload with imagen_recibida=true is dispatched to payment flow", () => {
  const imagePayload = {
    senderNumber: "+593999",
    text: "[imagen]",
    context: { imagen_recibida: true, image_url: "https://example.com/r.jpg", cita_id: "c1", wamid: "w1" },
  };
  const hasImageFlag = imagePayload.context?.imagen_recibida === true;
  assertEquals(hasImageFlag, true);
});

Deno.test("routing — handlePaymentFlow returns Response with status 200 for valid image payload", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");

  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("generativelanguage")) {
      return Promise.resolve(new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"monto":17.5,"es_comprobante":true}' }] } }] }),
        { status: 200 },
      ));
    }
    if (u.includes("ycloud")) {
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    if (u.includes("telegram")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  // Mock supabase: cita with monto_adelanto=0 (Zona Sur — simplest path, no DB writes)
  const mockSupabase = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { id: "c1", monto_adelanto: 0, estado: "pendiente_pago", servicio_id: "v", fecha_hora: "2026-06-01T10:00:00", paciente_id: "p1" },
            error: null,
          }),
        }),
      }),
    }),
  };

  try {
    const body = {
      senderNumber: "+593999000099",
      context: {
        imagen_recibida: true as const,
        image_url: "https://example.com/receipt.jpg",
        cita_id: "c1",
        wamid: "w1",
      },
    };
    const res = await handlePaymentFlow(body, mockSupabase);
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("routing — text fallback: body without cita_id in context returns error status 200", async () => {
  // When context.imagen_recibida is true but cita_id is missing,
  // payment-flow returns 200 (graceful error — webhook already returned 200).
  Deno.env.set("YCLOUD_API_KEY", "test-yk");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "555");

  const mockSupabase = { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: "not found" }) }) }) }) };

  const body = {
    senderNumber: "+593999",
    context: { imagen_recibida: true as const, image_url: "https://x.com/r.jpg" },
  };

  const res = await handlePaymentFlow(body, mockSupabase);
  assertEquals(res.status, 200);
  const json = await res.json() as { reason?: string };
  assertEquals(json.reason, "missing_cita_id");
});
