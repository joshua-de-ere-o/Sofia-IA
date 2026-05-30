import { createClient } from "@supabase/supabase-js";

/**
 * lib/pre-filter.js — Pre-filtro mínimo.
 *
 * El agente vive en un número de WhatsApp Business propio (sin coexistencia).
 * Por eso este filtro solo descarta lo que NO debe llegar al agente:
 * eventos no-entrantes, números bloqueados, conversaciones en handoff activo
 * y tipos de mensaje no soportados. Todo lo demás pasa al agente.
 *
 * Retorna uno de:
 *   { action: 'ignore' }                      → evento no procesable, ACK silencioso
 *   { action: 'block',       reason: string } → número en blocklist, ACK silencioso
 *   { action: 'handoff' }                     → conversación con handoff activo, ACK silencioso
 *   { action: 'unsupported', reply: string }  → tipo no soportado, responder al paciente
 *   { action: 'pass' }                        → entregar al agente
 */

const UNSUPPORTED_REPLY =
  "Solo puedo leer mensajes de texto e imágenes 😊 ¿En qué puedo ayudarte?";

// Tipos de mensaje que el agente sabe procesar.
const SUPPORTED_TYPES = ["text", "image"];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function normalizePhone(n) {
  if (!n) return "";
  return String(n).replace(/\D/g, "");
}

function phoneMatches(target, list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const t = normalizePhone(target);
  return list.some((n) => normalizePhone(n) === t);
}

/**
 * Pre-filtro principal.
 *
 * @param {object} payload    — payload normalizado del webhook
 *                              { type: 'message.created', message: { from, from_me, type, text, ... } }
 * @param {object} [supabase] — cliente opcional (default: service role)
 */
export async function preFilter(payload, supabase) {
  const client = supabase || getServiceClient();

  // ── Ignorar eventos no-entrantes ──────────────────────────────
  // YCloud emite delivery/read receipts y status updates que no son
  // mensajes del paciente: type distinto de message.created o from_me.
  if (!payload) return { action: "ignore" };
  if (payload.type && payload.type !== "message.created") {
    return { action: "ignore" };
  }

  const msg = payload.message;
  if (!msg || msg.from_me === true) return { action: "ignore" };

  const phone = msg.from;
  if (!phone) return { action: "ignore" };

  const messageType = msg.type || "text";

  const [blocklistRes, configRes, handoffRes] = await Promise.all([
    client
      .from("blocklist")
      .select("phone")
      .eq("phone", phone)
      .maybeSingle(),
    client
      .from("configuracion")
      .select("blocklist_numeros")
      .eq("id", 1)
      .maybeSingle(),
    client
      .from("conversaciones")
      .select("handoff_activo")
      .eq("telefono_contacto", phone)
      .eq("estado", "activa")
      .maybeSingle(),
  ]);

  if (blocklistRes.data) return { action: "block", reason: "blocklist_table" };

  // Blocklist redundante en configuracion.blocklist_numeros (gestionada desde el CRM).
  if (phoneMatches(phone, configRes.data?.blocklist_numeros)) {
    return { action: "block", reason: "blocklist_config" };
  }

  // ── Handoff activo ────────────────────────────────────────────
  // Si la conversación fue derivada a la Dra. Kely, la IA no responde
  // hasta que ella la resuelva. Cortamos acá para no invocar al agente
  // en vano (el agent-runner también lo ignora, pero esto evita el viaje).
  if (handoffRes.data?.handoff_activo) return { action: "handoff" };

  // ── Tipo de mensaje no soportado ──────────────────────────────
  // El agente solo procesa texto (conversación) e imágenes (comprobantes).
  if (!SUPPORTED_TYPES.includes(messageType)) {
    return { action: "unsupported", reply: UNSUPPORTED_REPLY };
  }

  // ── Todo lo demás pasa al agente ──────────────────────────────
  return { action: "pass" };
}
