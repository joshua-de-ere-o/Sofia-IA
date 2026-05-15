import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { processPaymentImage } from "../../../lib/payments";
import { preFilter } from "../../../lib/pre-filter";
import { sendWhatsAppMessage } from "../../../lib/ycloud";

const DEBOUNCE_MS = 2500;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function markLastMessage(supabase, phone) {
  const stamp = new Date().toISOString();
  await supabase
    .from("conversaciones")
    .update({ last_message_at: stamp })
    .eq("telefono_contacto", phone)
    .eq("estado", "activa");
  return stamp;
}

async function isStillLatest(supabase, phone, stamp) {
  const { data } = await supabase
    .from("conversaciones")
    .select("last_message_at")
    .eq("telefono_contacto", phone)
    .eq("estado", "activa")
    .maybeSingle();
  if (!data?.last_message_at) return true;
  return data.last_message_at === stamp;
}

async function markCannedSent(supabase, phone) {
  await supabase
    .from("conversaciones")
    .update({ canned_sent_at: new Date().toISOString() })
    .eq("telefono_contacto", phone)
    .eq("estado", "activa");
}

export async function POST(req) {
  try {
    const rawBody = await req.text();

    // ============================================================
    // DEBUG TEMPORAL: log de todos los headers para identificar
    // cómo envía YCloud la firma. Restaurar verificación HMAC
    // una vez confirmado el nombre del header y formato.
    // ============================================================
    const allHeaders = {};
    req.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });
    console.log("[Webhook DEBUG] Headers recibidos:", JSON.stringify(allHeaders, null, 2));
    console.log("[Webhook DEBUG] Raw body (primeros 500 chars):", rawBody.slice(0, 500));
    // Verificación HMAC desactivada temporalmente — NO mergear a main sin restaurar.
    // const signature = req.headers.get("ycloud-webhook-signature");
    // const secret = process.env.YCLOUD_WEBHOOK_SECRET;
    // if (!secret) { ... }
    // else if (!signature) { ... }
    // else { crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"); ... }

    const payload = JSON.parse(rawBody);
    const message = payload?.message;
    if (!message) return NextResponse.json({ received: true });

    const senderNumber = message.from;
    const messageType = message.type;
    const supabase = getServiceClient();

    // Ejecutar pre-filtro (6 capas)
    const result = await preFilter(payload, supabase);

    if (result.action === "ignore") {
      return NextResponse.json({ received: true, filtered: true, reason: "ignored" });
    }

    if (result.action === "block") {
      console.log(`[Webhook] Bloqueo silencioso ${senderNumber}: ${result.reason}`);
      return NextResponse.json({ received: true, filtered: true, reason: result.reason });
    }

    if (result.action === "audio_reply") {
      sendWhatsAppMessage(senderNumber, result.texto).catch((err) => console.error(err));
      return NextResponse.json({ received: true, filtered: true, reason: "audio_reply" });
    }

    if (result.action === "canned") {
      console.log(`[Webhook] Canned → ${senderNumber}`);
      sendWhatsAppMessage(senderNumber, result.texto)
        .then(() => markCannedSent(supabase, senderNumber))
        .catch((err) => console.error(err));
      return NextResponse.json({ received: true, filtered: true, reason: "canned" });
    }

    // action === 'pass'
    // Procesamiento específico por tipo de mensaje
    if (messageType === "image") {
      const imageUrl = message.image?.url;
      if (imageUrl) {
        console.log(`Procesando comprobante de pago de: ${senderNumber}`);
        const res = await processPaymentImage(senderNumber, imageUrl);
        if (!res.success) console.error("Error en proceso de pago:", res.error);
      }
      return NextResponse.json({ received: true });
    }

    if (messageType === "text") {
      const textBody = message.text?.body;

      // Debounce 2.5s — si llega otro mensaje más reciente, abortar este
      const stamp = await markLastMessage(supabase, senderNumber);
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      const latest = await isStillLatest(supabase, senderNumber, stamp);
      if (!latest) {
        console.log(`[Webhook] Debounce descartó mensaje de ${senderNumber}: llegó otro más reciente`);
        return NextResponse.json({ received: true, debounced: true });
      }

      const agentUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-runner`;
      const body = { senderNumber, text: textBody };
      if (result.context) body.context = result.context;

      console.log(`[Webhook] → agent-runner (${senderNumber})`);
      fetch(agentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify(body),
      }).catch((err) => console.error("Error invocando a agent-runner:", err));
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error crítico en el webhook de YCloud:", error);
    return NextResponse.json({ received: true, internal_error: error.message });
  }
}

export async function GET() {
  return new NextResponse("Webhook YCloud OK", { status: 200 });
}
