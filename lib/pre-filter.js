import { createClient } from "@supabase/supabase-js";

/**
 * lib/pre-filter.js — Pre-filtro de 6 capas (Spec 09)
 *
 * Retorna uno de:
 *   { action: 'pass',         context?: string }
 *   { action: 'block',        reason: string  }
 *   { action: 'canned',       texto: string   }
 *   { action: 'audio_reply',  texto: string   }
 *   { action: 'ignore' }   → YCloud ACK silencioso (L0)
 */

const AUDIO_REPLY =
  "Hola 👋 Por el momento solo puedo ayudarte por texto. ¿Me cuentas qué necesitas?";

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
 * Detecta si el texto contiene una keyword de intención.
 * Usa match por palabra en minúsculas + normalización mínima.
 */
function containsAny(text, keywords) {
  if (!text || !Array.isArray(keywords)) return false;
  const norm = text.toLowerCase();
  return keywords.some((kw) => kw && norm.includes(String(kw).toLowerCase()));
}

/**
 * Extrae opción del menú (1/2/3) si el mensaje responde al canned.
 * Acepta "1", "opción 1", "1.", o texto textual del botón.
 */
function detectMenuChoice(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (/^1[\.\)]?$/.test(t) || t.includes("agendar") || t.includes("cita")) return 1;
  if (/^2[\.\)]?$/.test(t) || t.includes("servicio") || t.includes("precio")) return 2;
  if (/^3[\.\)]?$/.test(t) || t.includes("consulta") || t.includes("duda")) return 3;
  return null;
}

const MENU_CONTEXT = {
  1: "El paciente seleccionó la opción del menú: quiere agendar una cita.",
  2: "El paciente seleccionó la opción del menú: quiere conocer servicios y precios.",
  3: "El paciente seleccionó la opción del menú: tiene una consulta o duda — puede incluir preguntas médicas, verificar triggers de handoff.",
};

// ──────────────────────────────────────────────────────────────
// L0 — Descartar eventos no-entrantes
// ──────────────────────────────────────────────────────────────
function layer0(payload) {
  if (!payload) return { action: "ignore" };
  if (payload.type && payload.type !== "message.created") {
    return { action: "ignore" };
  }
  if (payload.message?.from_me === true) {
    return { action: "ignore" };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// L1 — Blocklist / Whitelist
// ──────────────────────────────────────────────────────────────
async function layer1(supabase, phone, config) {
  // 1.a Blocklist desde tabla independiente
  const { data: bl } = await supabase
    .from("blocklist")
    .select("phone")
    .eq("phone", phone)
    .maybeSingle();

  if (bl) return { action: "block", reason: "blocklist_table" };

  // 1.b Blocklist redundante dentro de configuracion.blocklist_numeros
  if (phoneMatches(phone, config?.blocklist_numeros)) {
    return { action: "block", reason: "blocklist_config" };
  }

  // 1.c Whitelist opcional
  if (config?.whitelist_activa) {
    if (!phoneMatches(phone, config?.whitelist_numeros)) {
      return { action: "block", reason: "whitelist" };
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────
// L2 — Handoff / modo manual / personal
// ──────────────────────────────────────────────────────────────
async function layer2(supabase, phone) {
  const { data: conv } = await supabase
    .from("conversaciones")
    .select("id, mode, manual_until, handoff_activo")
    .eq("telefono_contacto", phone)
    .eq("estado", "activa")
    .maybeSingle();

  if (!conv) return { conv: null, decision: null };

  if (conv.handoff_activo) {
    return { conv, decision: { action: "block", reason: "handoff_activo" } };
  }

  if (conv.mode === "personal") {
    return { conv, decision: { action: "block", reason: "mode_personal" } };
  }

  if (conv.mode === "manual") {
    if (conv.manual_until && new Date(conv.manual_until) > new Date()) {
      return { conv, decision: { action: "block", reason: "mode_manual" } };
    }
    // Timeout expirado → revertir a auto
    await supabase
      .from("conversaciones")
      .update({ mode: "auto", manual_until: null })
      .eq("id", conv.id);
    conv.mode = "auto";
  }

  return { conv, decision: null };
}

// ──────────────────────────────────────────────────────────────
// L3 — Tipo de mensaje (non-text)
// ──────────────────────────────────────────────────────────────
function layer3(messageType) {
  const blockedTypes = ["sticker", "location", "contacts", "reaction", "unsupported"];
  if (blockedTypes.includes(messageType)) {
    return { action: "block", reason: `tipo_no_soportado:${messageType}` };
  }
  if (messageType === "audio") {
    return { action: "audio_reply", texto: AUDIO_REPLY };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// L4 — Canned con debounce + cooldown
// ──────────────────────────────────────────────────────────────
async function layer4(supabase, phone, text, conv, config) {
  // Si ya hay historial en conversación, pasa al agente directamente.
  const tieneHistorial =
    conv && Array.isArray(conv.mensajes_raw) && conv.mensajes_raw.length > 0;

  // Si responde con una opción de menú → pasar al agente con contexto
  const choice = detectMenuChoice(text);
  if (choice && conv?.canned_sent_at) {
    return { action: "pass", context: MENU_CONTEXT[choice] };
  }

  if (tieneHistorial) {
    return { action: "pass" };
  }

  const tieneIntencion = containsAny(text, config?.keywords_intencion);
  if (tieneIntencion) {
    return { action: "pass" };
  }

  // Cooldown: no reenviar canned si ya se mandó hace < N horas
  const cooldownHoras = Number(config?.canned_cooldown_horas || 12);
  if (conv?.canned_sent_at) {
    const sentAt = new Date(conv.canned_sent_at).getTime();
    if (Date.now() - sentAt < cooldownHoras * 3600 * 1000) {
      return { action: "block", reason: "canned_cooldown" };
    }
  }

  const texto =
    config?.canned_texto ||
    "Hola 👋 Soy Sofía, asistente de la Dra. Kely. ¿En qué puedo ayudarte hoy?\n\n1. Quiero agendar una cita\n2. Servicios y precios\n3. Tengo una consulta o duda";

  return { action: "canned", texto };
}

// ──────────────────────────────────────────────────────────────
// L5 — Keywords spam
// ──────────────────────────────────────────────────────────────
function layer5(text, config) {
  if (!text) return null;
  if (containsAny(text, config?.keywords_spam)) {
    return { action: "block", reason: "spam_keywords" };
  }
  return null;
}

/**
 * Pre-filtro principal (nuevo contrato).
 *
 * @param {object} payload  — payload del webhook YCloud { type, message: { from, from_me, type, text: { body }, ... } }
 * @param {object} [supabase] — cliente opcional (default: service role)
 */
export async function preFilter(payload, supabase) {
  const client = supabase || getServiceClient();

  // L0
  const l0 = layer0(payload);
  if (l0) return l0;

  const msg = payload?.message;
  if (!msg) return { action: "ignore" };

  const phone = msg.from;
  if (!phone) return { action: "ignore" };

  const messageType = msg.type || "text";
  const text = msg.text?.body || "";

  // Cargar configuración una sola vez
  const { data: config } = await client
    .from("configuracion")
    .select(
      "whitelist_activa, whitelist_numeros, blocklist_numeros, keywords_intencion, keywords_spam, canned_texto, canned_cooldown_horas"
    )
    .eq("id", 1)
    .maybeSingle();

  // L1
  const l1 = await layer1(client, phone, config);
  if (l1) return l1;

  // L2
  const { conv, decision: l2 } = await layer2(client, phone);
  if (l2) return l2;

  // L3
  const l3 = layer3(messageType);
  if (l3) return l3;

  // Si no es texto pero sí permitido (image, document) → pasar directo sin L4/L5
  if (messageType !== "text") {
    return { action: "pass" };
  }

  // Necesitamos mensajes_raw para L4 — re-cargar si viene de L2
  let convFull = conv;
  if (conv) {
    const { data } = await client
      .from("conversaciones")
      .select("mensajes_raw, canned_sent_at")
      .eq("id", conv.id)
      .maybeSingle();
    if (data) convFull = { ...conv, ...data };
  }

  // L5 (spam) — se evalúa antes que L4 para no mandar canned a spammers
  const l5 = layer5(text, config);
  if (l5) return l5;

  // L4 — canned / pass
  const l4 = await layer4(client, phone, text, convFull, config);
  return l4;
}

/**
 * Compatibilidad con el wrapper anterior usado por route.js.
 * Mantiene la firma legacy hasta que el webhook se actualice.
 */
export async function runPreFilter(senderNumber, textMessage) {
  const fakePayload = {
    type: "message.created",
    message: {
      from: senderNumber,
      from_me: false,
      type: textMessage ? "text" : "unsupported",
      text: { body: textMessage || "" },
    },
  };
  const res = await preFilter(fakePayload);

  switch (res.action) {
    case "pass":
      return { shouldPass: true, reason: "ok", context: res.context };
    case "block":
      return { shouldPass: false, reason: res.reason, quickReply: null };
    case "canned":
      return { shouldPass: false, reason: "canned", quickReply: res.texto };
    case "audio_reply":
      return { shouldPass: false, reason: "audio", quickReply: res.texto };
    case "ignore":
    default:
      return { shouldPass: false, reason: "ignored", quickReply: null };
  }
}
