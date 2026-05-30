import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { uploadComprobante } from "../../../lib/payments";
import { preFilter } from "../../../lib/pre-filter";
import { sendWhatsAppMessage } from "../../../lib/ycloud";

/**
 * Mask a phone number for logging (inline — log.ts is Deno-only).
 * Keeps first 5 chars + last 4, replaces middle with ***.
 * Example: "+593987654321" → "+5939***4321"
 */
function maskPhone(phone) {
  if (!phone || phone.length <= 9) return phone;
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}

function createCorrelationId() {
  return `txt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTextDebounceMs() {
  const raw = Number(process.env.TEXT_DEBOUNCE_MS ?? 900);
  return Number.isFinite(raw) && raw >= 0 ? raw : 900;
}

function createTextLatencyTracker(correlationId, senderNumber) {
  const entries = [];

  return {
    record(stage, startedAt, extra = {}) {
      const entry = {
        level: 'info',
        scope: '[Webhook]',
        event: 'text_path_stage',
        correlation_id: correlationId,
        phone: maskPhone(senderNumber),
        stage,
        duration_ms: Date.now() - startedAt,
        ...extra,
      };
      entries.push(entry);
      console.log(JSON.stringify(entry));
      return entry;
    },
    finish(outcome) {
      if (entries.length === 0) return;
      const slowest = entries.reduce((current, entry) =>
        entry.duration_ms > current.duration_ms ? entry : current
      );
      console.log(JSON.stringify({
        level: 'info',
        scope: '[Webhook]',
        event: 'text_path_hotspot',
        correlation_id: correlationId,
        phone: maskPhone(senderNumber),
        outcome,
        stage_count: entries.length,
        slowest_stage: slowest.stage,
        slowest_duration_ms: slowest.duration_ms,
        total_duration_ms: entries.reduce((sum, entry) => sum + entry.duration_ms, 0),
      }));
    },
  };
}

/**
 * Returns true if the MIME type string starts with "image/" (case-insensitive).
 * Strips RFC-2045 parameters (e.g. "image/jpeg; charset=binary") before testing.
 * Returns false for null, undefined, empty, or non-image MIME types.
 */
function isImageMime(mt) {
  if (!mt || typeof mt !== 'string') return false
  return /^image\//i.test(mt.split(';')[0].trim())
}

/**
 * Returns the first non-empty string URL candidate from a YCloud media object
 * (works for both `document` and `image` payload shapes).
 * Tries: obj.link → obj.url → obj.mediaUrl → obj.media_url
 * Returns null if none found or obj is falsy.
 */
function pickMediaUrl(obj) {
  if (!obj) return null
  const candidates = [obj.link, obj.url, obj.mediaUrl, obj.media_url]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c
  }
  return null
}

// YCloud envía eventos con shape:
//   { type: "whatsapp.inbound_message.received", whatsappInboundMessage: { from, to, type, text:{body}, ... } }
// Otros eventos (status updates, etc.) usan distintos type y shape.
// Normalizamos al contrato interno { type: "message.created", message: {...} } que espera pre-filter.
function normalizeYCloudPayload(raw) {
  if (raw?.type === "whatsapp.inbound_message.received" && raw?.whatsappInboundMessage) {
    const m = raw.whatsappInboundMessage;

    // Normalize document-with-image-mime to type:'image' so the pre-filter and
    // image branch handle it correctly. YCloud sometimes delivers photos sent via
    // the "attach document" flow with type:'document' instead of type:'image'.
    let normalizedType = m.type;
    let normalizedImage = m.image;

    if (m.type === 'document') {
      // TEMP DIAGNOSTIC (remove after confirming YCloud document shape in production).
      // Logs which keys YCloud puts on the document object plus the mime_type so we can
      // verify the URL fallback chain in `pickMediaUrl` matches reality.
      // URLs and patient data are NOT logged.
      console.log(JSON.stringify({
        level: 'info',
        scope: '[Webhook]',
        event: 'document_payload_shape_diagnostic',
        mime_type: m.document?.mime_type,
        document_keys: m.document ? Object.keys(m.document) : null,
      }));
    }

    if (m.type === 'image') {
      // TEMP DIAGNOSTIC (remove after confirming YCloud image shape in production).
      // Production has shown YCloud delivers images sent via 📎 attachment as
      // `type:'image'` natively, but the URL is NOT under `image.url` — the existing
      // image branch failed with "image sin imageUrl o wamid". This log reveals the
      // actual field names so we can confirm the fallback chain catches them.
      // URLs and patient data are NOT logged.
      console.log(JSON.stringify({
        level: 'info',
        scope: '[Webhook]',
        event: 'image_payload_shape_diagnostic',
        mime_type: m.image?.mime_type,
        image_keys: m.image ? Object.keys(m.image) : null,
      }));

      // Apply URL fallback chain so downstream code can always read `message.image.url`.
      const imageUrl = pickMediaUrl(m.image);
      if (imageUrl) {
        normalizedImage = { ...m.image, url: imageUrl };
      } else if (m.image) {
        console.log(JSON.stringify({
          level: 'warn',
          scope: '[Webhook]',
          event: 'image_no_url',
          mime_type: m.image?.mime_type,
          image_keys: Object.keys(m.image),
          note: 'image payload present but no URL candidate found in known field names',
        }));
      }
    }

    if (m.type === 'document' && isImageMime(m.document?.mime_type)) {
      const url = pickMediaUrl(m.document);
      if (url) {
        normalizedType = 'image';
        normalizedImage = {
          url,
          mime_type: m.document.mime_type,
          filename: m.document.filename,
        };
      } else {
        // Image mime but no URL candidate found — log for observability
        console.log(JSON.stringify({
          level: 'warn',
          scope: '[Webhook]',
          event: 'document_image_no_url',
          mime_type: m.document?.mime_type,
          note: 'document with image mime but no URL candidate found; routing as unsupported',
        }));
      }
    }

    // Normalizar respuestas de botones de templates a tipo "text" para que el
    // agente las procese como texto plano:
    //   - Quick Reply de template:        m.type === 'button',      m.button.text
    //   - Interactive button_reply:        m.type === 'interactive', m.interactive.button_reply.title
    let normalizedText = m.text;
    if (m.type === 'button' && m.button?.text) {
      normalizedType = 'text';
      normalizedText = { body: m.button.text };
    } else if (m.type === 'interactive' && m.interactive?.button_reply?.title) {
      normalizedType = 'text';
      normalizedText = { body: m.interactive.button_reply.title };
    }

    return {
      type: "message.created",
      message: {
        id: m.id,
        wamid: m.wamid,
        from: m.from,
        from_me: false,
        type: normalizedType,
        text: normalizedText,
        image: normalizedImage,
        audio: m.audio,
        video: m.video,
        document: m.document,
        sticker: m.sticker,
        location: m.location,
        contacts: m.contacts,
        reaction: m.reaction,
        customerProfile: m.customerProfile,
      },
    };
  }
  return raw;
}

const TEXT_DEBOUNCE_MS = getTextDebounceMs();

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
  // Comparar como timestamps (Postgres devuelve "YYYY-MM-DD HH:mm:ss.sss+00",
  // JS produce "YYYY-MM-DDTHH:mm:ss.sssZ"); comparación strict de strings nunca cuajaba.
  return new Date(data.last_message_at).getTime() === new Date(stamp).getTime();
}

export async function POST(req) {
  try {
    const rawBody = await req.text();

    // Verificación de firma YCloud — header `ycloud-signature` con formato `t=<timestamp>,s=<hex_hmac>`.
    // El payload firmado es `<timestamp>.<rawBody>` (HMAC-SHA256 con YCLOUD_WEBHOOK_SECRET).
    const signatureHeader = req.headers.get("ycloud-signature");
    const secret = process.env.YCLOUD_WEBHOOK_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === "production") {
        console.error("401 Unauthorized: YCLOUD_WEBHOOK_SECRET no está configurado en producción.");
        return new NextResponse("Unauthorized", { status: 401 });
      }
      console.warn("WARNING: YCLOUD_WEBHOOK_SECRET no está configurado. Se omite validación de firma para desarrollo local.");
    } else if (!signatureHeader) {
      console.error("401 Unauthorized: Falta header ycloud-signature.");
      return new NextResponse("Unauthorized", { status: 401 });
    } else {
      const parts = Object.fromEntries(
        signatureHeader.split(",").map((kv) => {
          const idx = kv.indexOf("=");
          return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
        })
      );
      const timestamp = parts.t;
      const providedSig = parts.s;

      if (!timestamp || !providedSig) {
        console.error("401 Unauthorized: header ycloud-signature mal formado.");
        return new NextResponse("Unauthorized", { status: 401 });
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSig = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
      const sigBuffer = Buffer.from(providedSig);
      const expectedBuffer = Buffer.from(expectedSig);

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        console.error("401 Unauthorized: Firma de YCloud inválida.");
        return new NextResponse("Unauthorized", { status: 401 });
      }
    }

    const payload = normalizeYCloudPayload(JSON.parse(rawBody));

    const message = payload?.message;
    if (!message) return NextResponse.json({ received: true });

    const senderNumber = message.from;
    const messageType = message.type;
    const supabase = getServiceClient();
    const correlationId = messageType === 'text' ? createCorrelationId() : null;
    const textLatency = correlationId ? createTextLatencyTracker(correlationId, senderNumber) : null;

    // Ejecutar pre-filtro (6 capas)
    const preFilterStartedAt = Date.now();
    const result = await preFilter(payload, supabase);
    textLatency?.record('prefilter', preFilterStartedAt, { ok: true, action: result.action });

    if (result.action === "ignore") {
      textLatency?.finish('ignored');
      return NextResponse.json({ received: true, filtered: true, reason: "ignored" });
    }

    if (result.action === "block") {
      console.log(JSON.stringify({ level: 'info', scope: '[Webhook]', event: 'blocked_text_path', phone: maskPhone(senderNumber), reason: result.reason, correlation_id: correlationId }));
      textLatency?.finish('blocked');
      return NextResponse.json({ received: true, filtered: true, reason: result.reason });
    }

    if (result.action === "handoff") {
      console.log(JSON.stringify({ level: 'info', scope: '[Webhook]', event: 'handoff_text_path', phone: maskPhone(senderNumber), correlation_id: correlationId }));
      textLatency?.finish('handoff');
      return NextResponse.json({ received: true, filtered: true, reason: "handoff" });
    }

    if (result.action === "unsupported") {
      console.log(`[Webhook] unsupported phone=${maskPhone(senderNumber)} type=${messageType}`);
      try {
        const sendRes = await sendWhatsAppMessage(senderNumber, result.reply);
        if (!sendRes?.success) {
          console.error(JSON.stringify({
            level: 'error',
            scope: '[Webhook]',
            event: 'unsupported_reply_failed',
            phone: maskPhone(senderNumber),
            messageType,
            error: sendRes?.error ?? 'unknown',
          }));
        }
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          scope: '[Webhook]',
          event: 'unsupported_reply_threw',
          phone: maskPhone(senderNumber),
          messageType,
          error: err?.message ?? String(err),
        }));
      }
      textLatency?.finish('unsupported');
      return NextResponse.json({ received: true, filtered: true, reason: "unsupported" });
    }

    // action === 'pass'
    // Procesamiento específico por tipo de mensaje
    if (messageType === "image") {
      const imageUrl = message.image?.url;
      // Use wamid for deterministic filename + idempotency (design §1)
      const wamid = message.wamid || message.id;

      if (!imageUrl || !wamid) {
        console.warn(`[Webhook] image sin imageUrl o wamid de ${maskPhone(senderNumber)}, ignorando`);
        return NextResponse.json({ received: true });
      }

      console.log(`[Webhook] image wamid=${wamid} phone=${maskPhone(senderNumber)}`);

      // 1. Update last_message_at — BUG FIX: was missing for images, gap in 24h window tracking
      await markLastMessage(supabase, senderNumber);

      // 2. Upload to Storage + lookup patient + cita
      const uploadRes = await uploadComprobante(senderNumber, wamid, imageUrl);
      if (!uploadRes.success) {
        console.error(`[Webhook] Fallo al subir comprobante phone=${maskPhone(senderNumber)}:`, uploadRes.error);
        return NextResponse.json({ received: true });
      }

      // 3. Idempotency check — if we already have a pagos row with this referencia,
      //    skip dispatch (same wamid = duplicate YCloud delivery, design §1).
      const { data: existing } = await supabase
        .from("pagos")
        .select("id")
        .eq("referencia", uploadRes.image_path)
        .maybeSingle();

      if (existing) {
        console.log(`[Webhook] image duplicate wamid=${wamid} — ya procesado, skip`);
        return NextResponse.json({ received: true, duplicate: true });
      }

      // 4. Dispatch to agent-runner with imagen_recibida context.
      //    agent-runner will: run OCR, validate amount, persist pagos row, transition
      //    cita to confirmada_provisional, notify Kelly via Telegram.
      //
      //    The fetch IS awaited. The previous fire-and-forget pattern died on Vercel:
      //    after the function returned 200 to YCloud, the runtime froze before the
      //    TCP/TLS handshake to Supabase completed, so agent-runner never received
      //    the dispatch (observed in production 2026-05-26 — webhook logged
      //    "image dispatched" but Supabase had zero agent-runner invocations).
      //    agent-runner returns quickly after kicking off its own background work;
      //    the extra wait is small and YCloud accepts long webhook responses.
      const agentUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-runner`;
      try {
        const agentRes = await fetch(agentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            senderNumber,
            text: "[imagen]",
            context: {
              imagen_recibida: true,
              image_url: uploadRes.publicUrl,
              image_path: uploadRes.image_path,
              cita_id: uploadRes.citaId,
              wamid,
            },
          }),
        });

        if (!agentRes.ok) {
          const errorBody = await agentRes.text().catch(() => "");
          console.error(`[Webhook] agent-runner returned ${agentRes.status} phone=${maskPhone(senderNumber)}:`, errorBody);
        }
      } catch (e) {
        console.error(`[Webhook] agent-runner dispatch failed phone=${maskPhone(senderNumber)}:`, e.message);
      }

      console.log(`[Webhook] image dispatched to agent-runner phone=${maskPhone(senderNumber)} wamid=${wamid}`);
      return NextResponse.json({ received: true });
    }

    if (messageType === "text") {
      const textBody = message.text?.body;

      // Debounce conservador configurable — si llega otro mensaje más reciente, abortar este
      const debounceStartedAt = Date.now();
      const stamp = await markLastMessage(supabase, senderNumber);
      await new Promise((r) => setTimeout(r, TEXT_DEBOUNCE_MS));
      const latest = await isStillLatest(supabase, senderNumber, stamp);
      textLatency?.record('debounce', debounceStartedAt, { ok: latest, debounce_ms: TEXT_DEBOUNCE_MS });
      if (!latest) {
        console.log(JSON.stringify({ level: 'info', scope: '[Webhook]', event: 'text_debounced', phone: maskPhone(senderNumber), correlation_id: correlationId }));
        textLatency?.finish('debounced');
        return NextResponse.json({ received: true, debounced: true });
      }

      const agentUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-runner`;
      const body = { senderNumber, text: textBody, correlationId };
      if (result.context) body.context = result.context;

      const dispatchStartedAt = Date.now();
      console.log(JSON.stringify({ level: 'info', scope: '[Webhook]', event: 'agent_runner_dispatch_start', phone: maskPhone(senderNumber), correlation_id: correlationId }));
      const agentRes = await fetch(agentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify(body),
      });
      textLatency?.record('agent_runner_dispatch', dispatchStartedAt, { ok: agentRes.ok, status: agentRes.status });

      if (!agentRes.ok) {
        const errorBody = await agentRes.text().catch(() => "");
        console.error(`[Webhook] agent-runner falló (${agentRes.status}) para ${senderNumber}:`, errorBody);
      }

      textLatency?.finish(agentRes.ok ? 'agent_dispatched' : 'agent_dispatch_failed');
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
