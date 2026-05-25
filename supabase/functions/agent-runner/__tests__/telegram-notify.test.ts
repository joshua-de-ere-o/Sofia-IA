/**
 * __tests__/telegram-notify.test.ts — Unit tests for telegram-notify.ts
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net __tests__/telegram-notify.test.ts
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPaymentCaption,
  buildPaymentKeyboard,
  formatWindowRemaining,
  notifyPaymentPendingApproval,
} from "../telegram-notify.ts";

// ─── formatWindowRemaining ────────────────────────────────────────────────────

Deno.test("formatWindowRemaining — returns Xh Ym for future time", () => {
  // 22h 30m from now
  const lastMessageAt = new Date(Date.now() - 1.5 * 3_600_000).toISOString();
  const result = formatWindowRemaining(lastMessageAt);
  assertStringIncludes(result, "h ");
  assertStringIncludes(result, "m");
  // 24h - 1.5h = 22.5h remaining → should contain "22h"
  assertStringIncludes(result, "22h");
});

Deno.test("formatWindowRemaining — returns 'vencida' when window expired", () => {
  // 25h ago
  const lastMessageAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
  const result = formatWindowRemaining(lastMessageAt);
  assertEquals(result, "vencida");
});

Deno.test("formatWindowRemaining — returns Xh Ym for exactly 24h ago (0ms remaining)", () => {
  const lastMessageAt = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const result = formatWindowRemaining(lastMessageAt);
  assertEquals(result, "vencida");
});

// ─── buildPaymentKeyboard ─────────────────────────────────────────────────────

Deno.test("buildPaymentKeyboard — has 3 buttons in one row", () => {
  const kb = buildPaymentKeyboard({
    pendingId: "abc-123",
    nombre: "Ana",
    telefono: "+593987654321",
  });
  assertEquals(kb.inline_keyboard.length, 1);
  assertEquals(kb.inline_keyboard[0]!.length, 3);
});

Deno.test("buildPaymentKeyboard — confirm button has correct callback_data", () => {
  const kb = buildPaymentKeyboard({ pendingId: "my-uuid", nombre: "X", telefono: "+1" });
  const confirmBtn = kb.inline_keyboard[0]![0]!;
  assertEquals(confirmBtn.callback_data, "payment_confirm_my-uuid");
  assertStringIncludes(confirmBtn.text, "Confirmar");
});

Deno.test("buildPaymentKeyboard — reject button has correct callback_data", () => {
  const kb = buildPaymentKeyboard({ pendingId: "my-uuid", nombre: "X", telefono: "+1" });
  const rejectBtn = kb.inline_keyboard[0]![1]!;
  assertEquals(rejectBtn.callback_data, "payment_reject_my-uuid");
  assertStringIncludes(rejectBtn.text, "Rechazar");
});

Deno.test("buildPaymentKeyboard — wa.me button strips leading + from phone", () => {
  const kb = buildPaymentKeyboard({ pendingId: "p1", nombre: "Ana", telefono: "+593987654321" });
  const wameBtn = kb.inline_keyboard[0]![2]! as { url: string; text: string };
  assertStringIncludes(wameBtn.url, "wa.me/593987654321");
});

Deno.test("buildPaymentKeyboard — callback_data stays under 64 bytes (Telegram limit)", () => {
  const longUuid = "550e8400-e29b-41d4-a716-446655440000"; // 36 chars
  const kb = buildPaymentKeyboard({ pendingId: longUuid, nombre: "X", telefono: "+1" });
  const cb = kb.inline_keyboard[0]![0]!.callback_data!;
  // "payment_confirm_" = 16 bytes + 36 bytes = 52 bytes
  assertEquals(cb.length <= 64, true);
});

// ─── buildPaymentCaption ──────────────────────────────────────────────────────

Deno.test("buildPaymentCaption — includes patient name and service", () => {
  const caption = buildPaymentCaption({
    nombre: "Maria López",
    fechaHora: "01/06/2026 10:00",
    servicio: "Plan Mensual",
    objetivo: null,
    montoOcr: 17.5,
    montoEsperado: 17.5,
    lastMessageAt: new Date(Date.now() - 1_800_000).toISOString(), // 30 min ago
  });
  assertStringIncludes(caption, "Maria López");
  assertStringIncludes(caption, "Plan Mensual");
  assertStringIncludes(caption, "17.50");
});

Deno.test("buildPaymentCaption — omits objetivo line when null", () => {
  const caption = buildPaymentCaption({
    nombre: "X",
    fechaHora: "01/06/2026 10:00",
    servicio: "Plan",
    objetivo: null,
    montoOcr: 10,
    montoEsperado: 10,
    lastMessageAt: new Date().toISOString(),
  });
  assertEquals(caption.includes("Objetivo:"), false);
});

Deno.test("buildPaymentCaption — includes objetivo when present", () => {
  const caption = buildPaymentCaption({
    nombre: "X",
    fechaHora: "01/06/2026 10:00",
    servicio: "Plan",
    objetivo: "bajar de peso",
    montoOcr: 10,
    montoEsperado: 10,
    lastMessageAt: new Date().toISOString(),
  });
  assertStringIncludes(caption, "Objetivo: bajar de peso");
});

Deno.test("buildPaymentCaption — match shows ✅ emoji", () => {
  const caption = buildPaymentCaption({
    nombre: "X", fechaHora: "01/06/2026 10:00", servicio: "Plan",
    objetivo: null, montoOcr: 20, montoEsperado: 17.5,
    lastMessageAt: new Date().toISOString(),
  });
  assertStringIncludes(caption, "✅");
});

Deno.test("buildPaymentCaption — underpayment shows ⚠️ emoji", () => {
  const caption = buildPaymentCaption({
    nombre: "X", fechaHora: "01/06/2026 10:00", servicio: "Plan",
    objetivo: null, montoOcr: 5, montoEsperado: 17.5,
    lastMessageAt: new Date().toISOString(),
  });
  assertStringIncludes(caption, "⚠️");
});

// ─── notifyPaymentPendingApproval ─────────────────────────────────────────────

Deno.test("notifyPaymentPendingApproval — calls sendPhoto with correct params", async () => {
  Deno.env.set("TELEGRAM_BOT_TOKEN", "test-bot-token");
  Deno.env.set("TELEGRAM_CHAT_ID", "12345");

  let capturedBody: Record<string, unknown> | null = null;
  let calledEndpoint = "";

  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = typeof url === "string" ? url : url.toString();
    calledEndpoint = u;
    capturedBody = JSON.parse((init?.body ?? "{}") as string);
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
    );
  };

  try {
    await notifyPaymentPendingApproval({
      pendingId: "pending-uuid-1",
      receiptUrl: "https://example.com/receipt.jpg",
      nombre: "Ana Torres",
      telefono: "+593987654321",
      fechaHora: "01/06/2026 10:00",
      servicio: "Plan Mensual",
      objetivo: "bajar de peso",
      montoOcr: 17.5,
      montoEsperado: 17.5,
      lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    assertStringIncludes(calledEndpoint, "sendPhoto");
    assertEquals(capturedBody?.chat_id, "12345");
    assertEquals(capturedBody?.photo, "https://example.com/receipt.jpg");
    assertStringIncludes(capturedBody?.caption as string, "Ana Torres");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("notifyPaymentPendingApproval — falls back to sendMessage if sendPhoto fails", async () => {
  Deno.env.set("TELEGRAM_BOT_TOKEN", "test-bot-token");
  Deno.env.set("TELEGRAM_CHAT_ID", "12345");

  const endpoints: string[] = [];

  const original = globalThis.fetch;
  globalThis.fetch = (url, _init) => {
    const u = typeof url === "string" ? url : url.toString();
    endpoints.push(u.includes("sendPhoto") ? "sendPhoto" : u.includes("sendMessage") ? "sendMessage" : u);
    if (u.includes("sendPhoto")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, description: "Bad URL" }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  };

  try {
    await notifyPaymentPendingApproval({
      pendingId: "p2",
      receiptUrl: "https://bad-url.com/r.jpg",
      nombre: "Luis",
      telefono: "+593",
      fechaHora: "01/06/2026 10:00",
      servicio: "Plan",
      objetivo: null,
      montoOcr: 10,
      montoEsperado: 10,
      lastMessageAt: new Date().toISOString(),
    });

    assertEquals(endpoints.includes("sendPhoto"), true);
    assertEquals(endpoints.includes("sendMessage"), true);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("notifyPaymentPendingApproval — returns without error if env vars missing", async () => {
  Deno.env.delete("TELEGRAM_BOT_TOKEN");
  Deno.env.delete("TELEGRAM_CHAT_ID");

  // Should NOT throw
  await notifyPaymentPendingApproval({
    pendingId: "p3",
    receiptUrl: "https://x.com/r.jpg",
    nombre: "X",
    telefono: "+1",
    fechaHora: "01/06/2026 10:00",
    servicio: "Plan",
    objetivo: null,
    montoOcr: 10,
    montoEsperado: 10,
    lastMessageAt: new Date().toISOString(),
  });
  // If we get here without throwing, test passes
  assertEquals(true, true);
});
