/**
 * payment-flow.ts — Payment receipt processing handler for agent-runner.
 *
 * Called when body.context.imagen_recibida === true (image dispatch from webhook).
 * Handles OCR, amount matching, DB state transitions, and Telegram notification.
 *
 * Routing:
 *   - Zona Sur (monto_adelanto = 0) → M6, no OCR, no DB writes
 *   - Already confirmada_provisional → M7, no OCR, no DB writes
 *   - OCR ok + match (monto_ocr >= monto_adelanto) → pagos INSERT + cita transition + Telegram notify + M1
 *   - OCR ok + underpayment → M2 (no DB writes)
 *   - OCR null/fail → conversaciones flag + M3
 *
 * Telegram notify is done directly from Deno (no Node/Next.js round-trip).
 * See design §5: agent-runner calls Telegram Bot API directly.
 */

import { extractAmountFromReceipt } from "./ocr.ts";
import { normalizeAmount, amountMatches } from "./amount.ts";
import { logPaymentEvent } from "./log.ts";
import { notifyPaymentPendingApproval } from "./telegram-notify.ts";

// ─── Copy (copy-final, LOCKED) ────────────────────────────────────────────────

const M1 = (monto: string) =>
  `Recibí tu comprobante de $${monto}, ¡tu cita queda agendada! La Dra. Kelly valida el pago cuando tenga un momento. ¡Te esperamos!`;

const M2 = (montoOcr: string, montoEsperado: string) =>
  `Recibimos un pago de $${montoOcr}, pero la señal de tu cita es $${montoEsperado}. ¿Puedes enviarnos el comprobante por el monto correcto?`;

const M3 =
  "Recibí tu imagen, pero no pude leer el monto del comprobante. ¿Puedes confirmarme cuánto pagaste?";

const M6 =
  "Tu cita en Zona Sur no requiere señal de pago, ¡ya estás agendado/a! Te esperamos el día de tu cita.";

const M7 =
  "Ya recibí tu comprobante anterior, lo estoy revisando con la doctora.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a number to 2 decimal places as a string.
 * Example: 17.5 → "17.50"
 */
function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Send a WhatsApp text message via YCloud.
 */
async function sendWA(to: string, text: string): Promise<void> {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");
  if (!apiKey || !from) {
    console.error("[Payment-Flow] Missing YCloud credentials");
    return;
  }
  try {
    await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, type: "text", text: { body: text } }),
    });
  } catch (e) {
    console.error("[Payment-Flow] YCloud send error:", e);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface PaymentFlowBody {
  senderNumber: string;
  context: {
    imagen_recibida: true;
    image_url: string;
    image_path?: string;
    cita_id?: string;
    wamid?: string;
  };
}

/**
 * Handle an image-context request from the webhook.
 *
 * @param body   - Parsed request body with context.imagen_recibida = true.
 * @param supabase - Supabase client (service-role).
 * @returns Response to return to the caller (always 200 — errors are internal).
 */
export async function handlePaymentFlow(
  body: PaymentFlowBody,
  supabase: SupabaseDb,
): Promise<Response> {
  const db = supabase;
  const { senderNumber, context } = body;
  const { image_url, cita_id, wamid } = context;

  logPaymentEvent("image_entry", { telefono: senderNumber, imagePath: image_url });

  if (!cita_id) {
    console.error("[Payment-Flow] Missing cita_id in context");
    return new Response(JSON.stringify({ status: "error", reason: "missing_cita_id" }), { status: 200 });
  }

  // 1. Fetch cita
  //
  // Schema note: the `citas` table uses `servicio` (text, free label like
  // "alimentario_mensual") and separate `fecha` (date) + `hora` (time)
  // columns. Earlier code assumed `servicio_id` FK + `fecha_hora` timestamp;
  // both are wrong against the actual production schema (confirmed
  // 2026-05-26 — first end-to-end smoke test after PRs #6, #7, #8).
  const { data: cita, error: citaErr } = (await db.from("citas")
    .select("id, monto_adelanto, estado, servicio, fecha, hora, paciente_id")
    .eq("id", cita_id)
    .single()) as { data: CitaRow | null; error: unknown };

  if (citaErr || !cita) {
    console.error("[Payment-Flow] Could not load cita:", citaErr);
    return new Response(JSON.stringify({ status: "error", reason: "cita_not_found" }), { status: 200 });
  }

  // 2. Zona Sur edge case: monto_adelanto = 0 → no OCR needed
  if (cita.monto_adelanto === 0) {
    logPaymentEvent("zona_sur_skip", { citaId: cita.id });
    await sendWA(senderNumber, M6);
    return new Response(JSON.stringify({ status: "zona_sur" }), { status: 200 });
  }

  // 3. Race guard: already in confirmada_provisional
  if (cita.estado === "confirmada_provisional") {
    logPaymentEvent("duplicate_image_skip", { citaId: cita.id });
    await sendWA(senderNumber, M7);
    return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
  }

  // 4. Fetch paciente + conversacion for Telegram message.
  //    Note: there is no `servicios` table — `cita.servicio` is already the
  //    text label (e.g. "alimentario_mensual").
  const [pacResult, convResult] = (await Promise.all([
    db.from("pacientes")
      .select("nombre, telefono, objetivo")
      .eq("id", cita.paciente_id)
      .single(),
    db.from("conversaciones")
      .select("id, last_message_at")
      .eq("telefono_contacto", senderNumber)
      .eq("estado", "activa")
      .single(),
  ])) as [
    { data: PacienteRow | null; error: unknown },
    { data: ConvRow | null; error: unknown },
  ];

  const paciente = pacResult.data;
  const conv = convResult.data;

  // 5. Run OCR
  logPaymentEvent("ocr_start", { citaId: cita.id, imagePath: image_url });
  const ocrResult = await extractAmountFromReceipt(image_url);
  logPaymentEvent("ocr_result", {
    citaId: cita.id,
    monto: ocrResult.monto,
    reason: ocrResult.es_comprobante ? undefined : "not_a_receipt",
  });

  const montoNorm = ocrResult.monto !== null ? normalizeAmount(ocrResult.monto) : null;

  // 6. Branch on OCR result

  // Branch A: OCR ok + amount matches
  if (montoNorm !== null && amountMatches(montoNorm, cita.monto_adelanto)) {
    // INSERT into pagos
    //
    // Schema notes (real production columns, confirmed 2026-05-26 after
    // PGRST204 error in smoke test):
    //   - column is `comprobante_url` (NOT `url_comprobante`)
    //   - `metodo` is NOT NULL with no default. Enum: transfer|cash|payphone.
    //     WhatsApp comprobante = bank transfer → always 'transfer'.
    const { data: pagoData, error: pagoErr } = (await db.from("pagos")
      .insert({
        cita_id: cita.id,
        monto: montoNorm,
        metodo: "transfer",
        referencia: wamid ?? image_url,
        verificado: false,
        comprobante_url: image_url,
      })
      .select()
      .single()) as { data: { id: string } | null; error: unknown };

    if (pagoErr || !pagoData) {
      console.error("[Payment-Flow] Error inserting pago:", pagoErr);
      await sendWA(senderNumber, M3);
      return new Response(JSON.stringify({ status: "db_error" }), { status: 200 });
    }

    // UPDATE cita estado
    await db.from("citas")
      .update({ estado: "confirmada_provisional" })
      .eq("id", cita.id);

    // INSERT pending_kelly_actions (TTL 24h — set explicitly per design §4)
    const expiraAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const { data: pendingData, error: pendingErr } = (await db.from("pending_kelly_actions")
      .insert({
        action_type: "aprobar_pago",
        expira_at: expiraAt,
        args: { cita_id: cita.id, pago_id: pagoData.id },
      })
      .select()
      .single()) as { data: { id: string } | null; error: unknown };

    if (pendingErr || !pendingData) {
      console.error("[Payment-Flow] Error inserting pending_kelly_actions:", pendingErr);
    }

    logPaymentEvent("cita_provisional", {
      citaId: cita.id,
      monto: montoNorm,
      montEsperado: cita.monto_adelanto,
    });

    // Telegram notification (best-effort — don't block patient reply on failure)
    if (pendingData && paciente && conv) {
      const fechaHoraFormatted = new Date(`${cita.fecha}T${cita.hora}`).toLocaleString("es-EC", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZone: "America/Guayaquil",
      });
      notifyPaymentPendingApproval({
        pendingId: pendingData.id,
        receiptUrl: image_url,
        nombre: paciente.nombre ?? senderNumber,
        telefono: paciente.telefono ?? senderNumber,
        fechaHora: fechaHoraFormatted,
        servicio: cita.servicio,
        objetivo: paciente.objetivo ?? null,
        montoOcr: montoNorm,
        montoEsperado: cita.monto_adelanto,
        lastMessageAt: conv.last_message_at,
      }).catch((e) => console.error("[Payment-Flow] Telegram notify error:", e));
    }

    // Update conversation last activity
    if (conv) {
      await db.from("conversaciones")
        .update({ ultima_actividad: new Date().toISOString() })
        .eq("id", conv.id)
        .eq("estado", "activa");
    }

    await sendWA(senderNumber, M1(fmt(montoNorm)));
    return new Response(JSON.stringify({ status: "confirmed_provisional", monto: montoNorm }), { status: 200 });
  }

  // Branch B: OCR ok but underpayment
  if (montoNorm !== null && !amountMatches(montoNorm, cita.monto_adelanto)) {
    logPaymentEvent("underpayment", { citaId: cita.id, monto: montoNorm, montEsperado: cita.monto_adelanto });
    await sendWA(senderNumber, M2(fmt(montoNorm), fmt(cita.monto_adelanto)));
    return new Response(JSON.stringify({ status: "underpayment", monto_ocr: montoNorm }), { status: 200 });
  }

  // Branch C: OCR failed (monto is null)
  logPaymentEvent("ocr_fail", { citaId: cita.id });

  // Set pending_payment_confirmation_cita_id on conversacion for text fallback (FR-11)
  if (conv) {
    await db.from("conversaciones")
      .update({ pending_payment_confirmation_cita_id: cita.id })
      .eq("id", conv.id)
      .eq("estado", "activa");
  }

  await sendWA(senderNumber, M3);
  return new Response(JSON.stringify({ status: "ocr_failed" }), { status: 200 });
}

// ─── Internal type helpers (keep private to this module) ──────────────────────

/**
 * Minimal interface describing the Supabase JS client API surface used by this
 * module. Avoids importing jsr:@supabase/supabase-js directly (which pulls in
 * npm:@supabase/realtime-js and breaks local deno check when node_modules is
 * managed by npm for the Next.js app rather than Deno).
 *
 * The real createClient() return value satisfies this interface at runtime.
 * Test mocks that do not fully implement QueryBuilder should cast via
 * `mockObj as unknown as SupabaseDb` at the call site.
 */
export interface SupabaseDb {
  from(table: string): QueryBuilder;
}

interface QueryBuilder {
  select(cols?: string): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  insert(rows: Record<string, unknown>): QueryBuilder;
  update(vals: Record<string, unknown>): QueryBuilder;
}

interface CitaRow {
  id: string;
  monto_adelanto: number;
  estado: string;
  servicio: string;
  fecha: string;
  hora: string;
  paciente_id: string;
}

interface PacienteRow {
  nombre: string | null;
  telefono: string | null;
  objetivo: string | null;
}

interface ConvRow {
  id: string;
  last_message_at: string;
}
