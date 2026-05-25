/**
 * telegram-notify.ts — Telegram notification for payment approval flow.
 *
 * Calls the Telegram Bot API directly from Deno (no Node/Next.js round-trip).
 *
 * Design §5 decision: agent-runner calls Telegram directly via this module.
 * `lib/telegram.js` is NOT used for the payment approval notification.
 * Rationale: avoids a cross-runtime fetch into Next.js just to send a Telegram
 * message; the bot token is already a secret available to edge functions.
 *
 * The pending_id is the full UUID from pending_kelly_actions.id.
 * Callback data: `payment_confirm_{uuid}` and `payment_reject_{uuid}`.
 * Total bytes: prefix (16) + UUID (36) = 52, well under the 64-byte Telegram limit.
 *
 * wa.me prefilled text (locked in copy-final): Kelly → patient deep-link.
 */

import { amountMatches } from "./amount.ts";
import { logPaymentEvent } from "./log.ts";

const WAME_PRESET_TEXT =
  "Hola {{nombre}}, te escribo personalmente. Vi que agendaste una cita conmigo pero no llegué a recibir el adelanto. ¿Pasó algo con el pago? Si quieres cuéntame y vemos cómo seguimos.";

export interface TelegramNotifyParams {
  pendingId: string;
  receiptUrl: string;
  nombre: string;
  telefono: string;
  fechaHora: string;
  servicio: string;
  objetivo: string | null;
  montoOcr: number;
  montoEsperado: number;
  lastMessageAt: string;
}

/**
 * Format the 24h WA window remaining from last_message_at.
 * Returns "Xh Ym" or "vencida" if expired.
 *
 * NOTE: This is a snapshot at send time. The callback handler MUST recompute
 * from conversaciones.last_message_at — never trust this snapshot for decisions.
 */
export function formatWindowRemaining(lastMessageAt: string): string {
  const ms = new Date(lastMessageAt).getTime() + 24 * 3_600_000 - Date.now();
  if (ms <= 0) return "vencida";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/**
 * Build the Telegram inline keyboard for payment approval.
 * Exported for testing.
 */
export function buildPaymentKeyboard(params: {
  pendingId: string;
  nombre: string;
  telefono: string;
}) {
  const phoneE164 = params.telefono.replace(/^\+/, "");
  const waMeText = encodeURIComponent(
    WAME_PRESET_TEXT.replace("{{nombre}}", params.nombre),
  );

  return {
    inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: `payment_confirm_${params.pendingId}` },
      { text: "❌ Rechazar", callback_data: `payment_reject_${params.pendingId}` },
      {
        text: `💬 Escribir a ${params.nombre}`,
        url: `https://wa.me/${phoneE164}?text=${waMeText}`,
      },
    ]],
  };
}

/**
 * Build the Telegram message caption for a pending payment.
 * Exported for testing.
 */
export function buildPaymentCaption(params: {
  nombre: string;
  fechaHora: string;
  servicio: string;
  objetivo: string | null;
  montoOcr: number;
  montoEsperado: number;
  lastMessageAt: string;
}): string {
  const countdown = formatWindowRemaining(params.lastMessageAt);
  const matchEmoji = amountMatches(params.montoOcr, params.montoEsperado) ? "✅" : "⚠️";
  const objetivoLine = params.objetivo ? `\nObjetivo: ${params.objetivo}` : "";

  return [
    `💳 *Comprobante pendiente de revisión*`,
    `Paciente: ${params.nombre}`,
    `Cita: ${params.fechaHora} — ${params.servicio}`,
    objetivoLine.trim(),
    `Monto recibido: $${params.montoOcr.toFixed(2)} (señal esperada: $${params.montoEsperado.toFixed(2)}) ${matchEmoji}`,
    `⏱ Ventana WA: ~${countdown} restantes`,
  ].filter(Boolean).join("\n");
}

/**
 * Notify Kelly via Telegram about a pending payment approval.
 *
 * Sends a photo message with the receipt image (sendPhoto).
 * Falls back to sendMessage (text + image URL) if sendPhoto fails.
 *
 * Required env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
 * Missing vars → logs error and returns (does NOT throw).
 */
export async function notifyPaymentPendingApproval(
  params: TelegramNotifyParams,
): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    console.error("[Telegram-Notify] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }

  const caption = buildPaymentCaption(params);
  const replyMarkup = buildPaymentKeyboard({
    pendingId: params.pendingId,
    nombre: params.nombre,
    telefono: params.telefono,
  });

  const tgBase = `https://api.telegram.org/bot${botToken}`;

  // Attempt sendPhoto first (receipt image embedded in message)
  try {
    const photoRes = await fetch(`${tgBase}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: params.receiptUrl,
        caption,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      }),
    });

    const photoJson = await photoRes.json() as { ok: boolean; description?: string };
    if (photoJson.ok) {
      logPaymentEvent("tg_notify_ok", { pendingId: params.pendingId });
      return;
    }

    console.warn(
      `[Telegram-Notify] sendPhoto failed (${photoJson.description}), falling back to sendMessage`,
    );
  } catch (e) {
    console.warn("[Telegram-Notify] sendPhoto error, falling back to sendMessage:", e);
  }

  // Fallback: sendMessage with caption + image URL appended as text
  try {
    const msgRes = await fetch(`${tgBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${caption}\n\nComprobante: ${params.receiptUrl}`,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      }),
    });

    const msgJson = await msgRes.json() as { ok: boolean; description?: string };
    if (msgJson.ok) {
      logPaymentEvent("tg_notify_fallback_ok", { pendingId: params.pendingId });
    } else {
      logPaymentEvent("tg_notify_failed", {
        pendingId: params.pendingId,
        reason: msgJson.description ?? "unknown",
      });
    }
  } catch (e) {
    logPaymentEvent("tg_notify_failed", { pendingId: params.pendingId, reason: String(e) });
  }
}
