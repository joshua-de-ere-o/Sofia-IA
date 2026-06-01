/**
 * app/api/telegram/route.js
 *
 * ACTOR / CHANNEL BOUNDARY: actor=operator, channel=telegram
 * ----------------------------------------------------------
 * All requests handled here originate from Kelly (the operator) via Telegram.
 * This route MUST NOT apply patient-WhatsApp constraints (24h/48h windows,
 * mandatory data requirements, defaults-only-never). Those rules live
 * exclusively in the patient lane (agent-runner / config.ts).
 *
 * Policy reference: lib/actor-policy.js → OPERATOR_TELEGRAM_POLICY
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getModelAdapter } from '@/lib/model-adapter';
import { sendWhatsAppMessage } from '../../../lib/ycloud.js';
import { WAME_DEFAULT_PRESET } from '../../../lib/telegram.js';
import { makePolicy, mergeOperatorOverrides } from '../../../lib/actor-policy.js';
import {
  buildOccupiedRanges,
  rangesOverlap,
  timeToMinutes,
  addMinutesToTime,
} from '../../../lib/availability/slot-generator.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * @typedef {{ kind: 'clarification', message: string }} OperatorClarification
 * @typedef {{ kind: 'preview', actionType: string, previewId: string, summary: string, keyboard: unknown[] }} OperatorPreview
 * @typedef {{ kind: 'result', status: 'applied' | 'cancelled' | 'failed' | 'already', message: string }} OperatorResult
 * @typedef {OperatorClarification | OperatorPreview | OperatorResult} OperatorToolResult
 */

export async function POST(req) {
  try {
    const update = await req.json();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error en webhook de Telegram:', err);
    return NextResponse.json({ ok: true, error: err.message });
  }
}

// ─── Callback queries (botones inline) ────────────────────────────────────────

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;
  if (!data) return;

  if (data.startsWith('attendance_yes_') || data.startsWith('attendance_no_')) {
    const vino = data.startsWith('attendance_yes_');
    const citaId = data.replace(vino ? 'attendance_yes_' : 'attendance_no_', '');
    if (citaId && citaId !== 'none') {
      await resolveAttendance(citaId, vino);
      await answerCallback(callbackQuery, vino ? '✅ Marcada como completada.' : '❌ Marcada como no-show.');
      await replaceButtons(callbackQuery, vino ? '✅ Completada' : '❌ No-show');
    }
    return;
  }

  if (data.startsWith('handoff_done_')) {
    const conversacionId = data.replace('handoff_done_', '');
    if (conversacionId && conversacionId !== 'none') {
      await resolveHandoff(conversacionId);
      await answerCallback(callbackQuery, '✅ Modo IA retomado para este paciente.');
      await replaceButtons(callbackQuery, '✅ Atención Retomada');
    }
    return;
  }

  if (data.startsWith('kelly_confirm_') || data.startsWith('kelly_cancel_')) {
    const confirmar = data.startsWith('kelly_confirm_');
    const pendingId = data.replace(confirmar ? 'kelly_confirm_' : 'kelly_cancel_', '');
    if (pendingId && pendingId !== 'none') {
      /** @type {OperatorResult} */
      const result = await resolveKellyPending(pendingId, confirmar);
      // Map OperatorResult → Telegram toast + button label
      const toast = result.message;
      const label = result.status === 'applied'
        ? '✅ Aplicado'
        : result.status === 'cancelled'
          ? '↩️ Cancelado'
          : result.status === 'already'
            ? 'ℹ️ Ya aplicada'
            : '⚠️ Error';
      await answerCallback(callbackQuery, toast);
      await replaceButtons(callbackQuery, label);
    }
    return;
  }

  if (data.startsWith('payment_confirm_') || data.startsWith('payment_reject_')) {
    // Always answer first so Telegram stops the loading spinner (FR-12 to FR-17)
    const isConfirm = data.startsWith('payment_confirm_');
    const pendingId = isConfirm
      ? data.replace('payment_confirm_', '')
      : data.replace('payment_reject_', '');

    if (isConfirm) {
      await handlePaymentConfirm(pendingId, callbackQuery);
    } else {
      await handlePaymentReject(pendingId, callbackQuery);
    }
  }
}

async function answerCallback(callbackQuery, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackQuery.id) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQuery.id, text }),
  });
}

async function replaceButtons(callbackQuery, label) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackQuery.message?.message_id) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'none' }]] },
    }),
  });
}

// ─── Mensajes entrantes ───────────────────────────────────────────────────────

async function handleMessage(message) {
  const text = (message.text || '').trim();
  const chatId = message.chat?.id;
  const expectedChatId = process.env.TELEGRAM_CHAT_ID;

  if (!chatId || !expectedChatId || String(chatId) !== String(expectedChatId)) return;
  if (!text) return;

  if (text === '/listo') {
    await handleListoCommand();
    return;
  }

  await handleKellyMessage(text);
}

async function handleListoCommand() {
  const { data: convs } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('handoff_activo', true)
    .order('ultima_actividad', { ascending: false })
    .limit(1);

  if (convs && convs.length > 0) {
    await resolveHandoff(convs[0].id);
    await sendToKely('✅ Modo IA retomado para el paciente más reciente en handoff.');
  } else {
    await sendToKely('ℹ️ No hay pacientes en modo handoff activo en este momento.');
  }
}

// ─── Bulk constants ───────────────────────────────────────────────────────────

/** Maximum number of citas allowed in a single bulk reschedule request (REQ-S3-02). */
const MAX_BULK_ITEMS = 12

// ─── Modo-Kelly: dispatcher LLM con tools ─────────────────────────────────────

const KELLY_SYSTEM_PROMPT = `Eres Sofía, asistente de la Dra. Kely León (nutrióloga, Quito, Ecuador).
Por este canal de Telegram hablas SOLO con Kely — nunca con pacientes.
Tu trabajo: ayudarla a consultar y gestionar su agenda y finanzas con texto libre.

TRATO Y TONO
- Tratamiento: tú (informal, neutral Quito).
- Saludo solo si es el PRIMER mensaje del día. Después, vas directo a la respuesta.
- Sin frases de cortesía repetitivas, sin "¡Hola!" en cada turno, sin "qué bueno verte".
- Respuestas cortas, prácticas, sin emojis decorativos.

REGLAS DURAS
- Cero políticas de paciente: las restricciones 24h/48h NO aplican a Kely. Si te pide reagendar para "en 2 horas", lo haces.
- Las acciones destructivas (reagendar, cancelar, crear bloqueo) NUNCA se ejecutan directo.
  Llamas a la tool correspondiente y el sistema arma un mensaje de confirmación con botones.
- Las consultas (agenda, finanzas) y crear_tarea se ejecutan directo, sin confirmación.

FECHAS RELATIVAS
- En cada turno recibes "[Hoy es {dia} {fecha}, {hora} Quito]". Úsalo para resolver "hoy", "mañana", "el viernes", "en 2 horas".
- Siempre devuelves fechas absolutas a las tools (YYYY-MM-DD y HH:MM 24h).

FORMATO DE RESPUESTA — OBLIGATORIO
Responde SIEMPRE con un objeto JSON, sin markdown, sin texto fuera del JSON:
{ "tool": "<nombre>", "args": { ... } }

Tools disponibles:
- consultar_agenda { "fecha": "YYYY-MM-DD" }
- consultar_finanzas { "periodo": "hoy" | "semana" | "mes" | "mes_anterior" }
- reagendar_cita_kelly { "nombre_paciente": str, "nueva_fecha": "YYYY-MM-DD", "nueva_hora": "HH:MM", "fecha_actual"?: "YYYY-MM-DD" }
- cancelar_cita_kelly { "nombre_paciente": str, "fecha"?: "YYYY-MM-DD" }
- crear_bloqueo_agenda { "fecha": "YYYY-MM-DD", "hora": "HH:MM", "duracion_min": int, "motivo": str }
- agendar_evento_personal { "motivo": str, "fecha": "YYYY-MM-DD", "hora": "HH:MM", "duracion_min"?: int, "recordar_min_antes"?: int }
- buscar_citas_bulk { "fecha_desde": "YYYY-MM-DD", "fecha_hasta": "YYYY-MM-DD", "zona"?: "sur|norte|virtual|valle|domicilio|santo_domingo", "estado"?: [str], "hora_desde"?: "HH:MM", "hora_hasta"?: "HH:MM" }
  // Busca citas activas en un rango de fechas, con zona opcional. Úsala antes de proponer reagendamientos masivos. No crea ni modifica datos. hora_desde y hora_hasta (formato HH:MM 24h) son opcionales pero deben usarse siempre juntos — si solo das uno, se devuelve error.
- reagendar_bulk { "items": [ { "cita_id": str, "paciente_nombre"?: str, "fecha_original": "YYYY-MM-DD", "hora_original": "HH:MM", "nueva_fecha": "YYYY-MM-DD", "nueva_hora": "HH:MM", "duracion_min": int } ] }
  // Reagenda múltiples citas en un solo paso. Máximo ${MAX_BULK_ITEMS} ítems. Incluí "paciente_nombre" (disponible en el resultado de buscar_citas_bulk) para que el resumen muestre el nombre real del paciente. Primero usa buscar_citas_bulk para obtener los IDs, nombres y duraciones. Crea un preview con botón de confirmación — no aplica nada de inmediato.
- crear_tarea { "descripcion": str, "fecha_hora_iso": "YYYY-MM-DDTHH:MM:SS-05:00" }
- responder_texto { "texto": str }  // para aclaraciones, preguntas a Kely, saludo del día

Reglas:
- Si falta info para una destructiva (ej. duracion_min en bloqueo, hora exacta), usa responder_texto con la pregunta.
- Si la intención no encaja, usa crear_tarea y avisa con responder_texto que lo guardas como recordatorio.
- crear_bloqueo_agenda: bloqueo simple de tiempo SIN recordatorio. duracion_min es OBLIGATORIO; si Kely no la dijo, preguntá con responder_texto.
- agendar_evento_personal: para un evento PROPIO de Kely en su agenda (ej. "agendá mi visita al odontólogo a las 15:00", "anotame reunión el viernes 10am"). Bloquea su agenda a esa hora Y le programa un recordatorio. Si NO dice duración, asumí 60 min (no preguntes). Si NO dice con cuánta anticipación avisar, asumí 30 min antes (no preguntes). Si pide "sin recordatorio", pasá recordar_min_antes: 0.`;

function guayaquilParts() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => fmt.find((p) => p.type === t)?.value || '';
  const fecha = `${get('year')}-${get('month')}-${get('day')}`;
  const hora = `${get('hour')}:${get('minute')}`;
  const weekday = get('weekday');
  return { fecha, hora, weekday, legible: `${weekday} ${fecha}, ${hora} Quito` };
}

/**
 * Return a short Spanish day label for a YYYY-MM-DD date string.
 * Uses new Date(year, monthIndex, day) — local constructor — to avoid the UTC
 * midnight shift that new Date('YYYY-MM-DD') would cause in UTC-offset runtimes.
 * @param {string} fecha - 'YYYY-MM-DD'
 * @returns {string} e.g. 'Mar 2 jun'
 */
function formatDiaCorto(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  // Local constructor: no timezone shift — same weekday regardless of TZ offset
  const dt = new Date(y, m - 1, d)
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`
}

async function esPrimerMensajeDelDia(fechaQuito) {
  const desde = `${fechaQuito}T00:00:00-05:00`;
  const hasta = `${fechaQuito}T23:59:59-05:00`;
  const [{ count: countTareas }, { count: countPending }] = await Promise.all([
    supabase.from('tareas').select('id', { count: 'exact', head: true })
      .gte('created_at', desde).lte('created_at', hasta),
    supabase.from('pending_kelly_actions').select('id', { count: 'exact', head: true })
      .gte('created_at', desde).lte('created_at', hasta),
  ]);
  return (countTareas || 0) === 0 && (countPending || 0) === 0;
}

function extractJson(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try { return JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { return null; } }
    return null;
  }
}

async function handleKellyMessage(text) {
  // Construct operator policy once — making the actor/channel boundary explicit.
  // makePolicy throws on unknown combinations; that error is caught below and
  // surfaces as a clean Kely-facing message instead of an unhandled crash.
  let operatorPolicy;
  try {
    operatorPolicy = makePolicy('operator', 'telegram');
  } catch (err) {
    console.error('[Telegram/kelly] No se pudo construir política de operador:', err?.message || err);
    await sendToKely('⚠️ Error interno de configuración. Avisa a Joshua.');
    return;
  }

  let adapter;
  try {
    adapter = await getModelAdapter();
  } catch (err) {
    console.error('[Telegram/kelly] No se pudo inicializar adapter:', err?.message || err);
    await sendToKely('⚠️ No pude procesar tu mensaje (IA no configurada). Avisa a Joshua.');
    return;
  }

  const ctx = guayaquilParts();
  const primerMensaje = await esPrimerMensajeDelDia(ctx.fecha);

  let userText = `[Hoy es ${ctx.legible}]\n[Primer mensaje del día: ${primerMensaje ? 'sí' : 'no'}]\n\nMensaje de Kely:\n"${text}"`;

  // PR2b (D3): inject last-search context into userText (NOT systemPrompt) so the
  // LLM can emit reagendar_bulk with real cita_ids without re-searching.
  // Injected only when context is fresh (<30 min); no-op otherwise.
  const kellyCtx = await readKellyContext();
  if (kellyCtx) {
    const { criteria, citas } = kellyCtx;
    const zonaStr  = criteria.zona       ? `zona ${criteria.zona}, ` : '';
    const fechaStr = criteria.fecha_desde === criteria.fecha_hasta
      ? criteria.fecha_desde
      : `${criteria.fecha_desde}–${criteria.fecha_hasta}`;
    const horaStr  = (criteria.hora_desde && criteria.hora_hasta)
      ? ` ${criteria.hora_desde}-${criteria.hora_hasta}`
      : '';
    const citaLines = citas
      .map((c) => `  - ${c.cita_id} ${c.paciente_nombre} ${c.fecha} ${c.hora} ${c.duracion_min}min`)
      .join('\n');
    userText +=
      `\n[Contexto: última búsqueda (${zonaStr}${fechaStr}${horaStr}) — ${citas.length} citas:\n` +
      citaLines +
      `\n]\nSolo si Kely se refiere explícitamente a ESAS citas (dice "esas", "todas", "las de la búsqueda"), emite reagendar_bulk con estos cita_id y duracion_min. Si pide otra cosa, ignorá esta lista.`;
  }
  // PR2b (D4): raise maxTokens conditionally — a reagendar_bulk JSON with up to 12
  // items can exceed 500 output tokens; keep 500 for normal turns to control cost.
  const maxTokens = kellyCtx ? 900 : 500;

  let raw;
  try {
    raw = await adapter.chat({ systemPrompt: KELLY_SYSTEM_PROMPT, userText, maxTokens });
  } catch (err) {
    console.error('[Telegram/kelly] Error LLM:', err?.message || err);
    await sendToKely('⚠️ Tuve un problema procesando tu mensaje. Intenta de nuevo en un rato.');
    return;
  }

  const parsed = extractJson(raw);
  if (!parsed || !parsed.tool) {
    console.error('[Telegram/kelly] Respuesta no parseable:', raw);
    await sendToKely('⚠️ No entendí. ¿Puedes reformular?');
    return;
  }

  const args = parsed.args || {};
  try {
    /** @type {import('../../../lib/actor-policy.js').OperatorToolResult | undefined} */
    let toolResult;
    switch (parsed.tool) {
      case 'consultar_agenda':        await toolConsultarAgenda(args); break;
      case 'consultar_finanzas':      await toolConsultarFinanzas(args); break;
      case 'buscar_citas_bulk': {
        // Capture result and persist context (write side). Read/inject side happens
        // above (readKellyContext before adapter.chat) so it applies on the NEXT turn.
        const bulkResult = await toolBuscarCitasBulk(args);
        if (bulkResult) await writeKellyContext(bulkResult.criteria, bulkResult.citas);
        break;
      }
      case 'reagendar_bulk':          toolResult = await toolReagendarBulkPreview(args); break;
      case 'reagendar_cita_kelly':    toolResult = await toolReagendarCita(args); break;
      case 'cancelar_cita_kelly':     toolResult = await toolCancelarCita(args); break;
      case 'crear_bloqueo_agenda':    toolResult = await toolCrearBloqueo(args); break;
      case 'agendar_evento_personal': toolResult = await toolAgendarEventoPersonal(args, operatorPolicy); break;
      case 'crear_tarea':             await toolCrearTarea(args); break;
      case 'responder_texto':         await sendToKely(args.texto || '…'); break;
      default:
        console.error('[Telegram/kelly] Tool desconocida:', parsed.tool);
        await sendToKely('⚠️ No supe qué hacer con eso. ¿Puedes reformular?');
    }
    // Dispatcher: consume preview return and drive the Telegram send from one place.
    if (toolResult?.kind === 'preview') {
      await sendToKelyWithButtons(toolResult.summary, toolResult.keyboard);
    }
    // Fix 3 (topic-change clear): if context was injected this turn but the LLM
    // chose an unrelated tool, clear the stale search now so it does not carry
    // over and bias future turns.
    // - buscar_citas_bulk: already overwrites context via writeKellyContext → skip clear.
    // - reagendar_bulk: context is kept alive for the upcoming confirm step → skip clear.
    // - everything else: the user changed topic → clear.
    if (kellyCtx && parsed.tool !== 'buscar_citas_bulk' && parsed.tool !== 'reagendar_bulk') {
      await clearKellyContext();
    }
  } catch (err) {
    console.error(`[Telegram/kelly] Error en tool ${parsed.tool}:`, err?.message || err);
    await sendToKely(`⚠️ Falló la operación (${parsed.tool}). Intenta de nuevo.`);
  }
}

// ─── Tools ────────────────────────────────────────────────────────────────────

async function toolConsultarAgenda({ fecha }) {
  if (!fecha) return sendToKely('⚠️ Necesito una fecha (YYYY-MM-DD).');
  const { data, error } = await supabase.rpc('obtener_agenda_del_dia', { p_fecha: fecha });
  if (error) throw error;
  await sendToKely(formatAgenda(fecha, data || []));
}

function formatAgenda(fecha, filas) {
  if (filas.length === 0) return `📅 ${fecha}: sin citas ni bloqueos.`;
  const citas = filas.filter((f) => !f.es_bloqueo);
  const bloqueos = filas.filter((f) => f.es_bloqueo);
  const lines = [`📅 Agenda para ${fecha}:`, ''];
  if (citas.length > 0) {
    for (const c of citas) {
      const hora = (c.hora || '').slice(0, 5);
      const modalidad = c.modalidad ? ` (${c.modalidad})` : '';
      lines.push(`• ${hora} — ${c.paciente_nombre} — ${c.servicio}${modalidad} [${c.estado}]`);
    }
  }
  if (bloqueos.length > 0) {
    lines.push('', '📌 Bloqueos / reuniones:');
    for (const b of bloqueos) {
      const hora = (b.hora || '').slice(0, 5);
      lines.push(`• ${hora} — ${b.motivo_bloqueo || 'Bloqueo de agenda'}`);
    }
  }
  return lines.join('\n');
}

async function toolConsultarFinanzas({ periodo }) {
  const rango = rangoPeriodo(periodo);
  if (!rango) return sendToKely('⚠️ Período inválido. Usa: hoy, semana, mes, mes_anterior.');
  const { data, error } = await supabase.rpc('obtener_resumen_financiero', {
    p_desde: rango.desde, p_hasta: rango.hasta,
  });
  if (error) throw error;
  const r = (data && data[0]) || {};
  const lines = [
    `💰 Finanzas — ${rango.label} (${rango.desde} a ${rango.hasta}):`,
    '',
    `✅ Cobrado: $${fmtMonto(r.cobrado_total)} (${r.cobrado_count || 0})`,
    `🟡 Por verificar: $${fmtMonto(r.por_verificar_total)} (${r.por_verificar_count || 0})`,
    `⏳ Pendiente: $${fmtMonto(r.pendiente_total)} (${r.pendiente_count || 0})`,
  ];
  await sendToKely(lines.join('\n'));
}

function fmtMonto(n) {
  const num = Number(n || 0);
  return num.toFixed(2);
}

function rangoPeriodo(periodo) {
  const { fecha } = guayaquilParts();
  const hoy = new Date(`${fecha}T12:00:00-05:00`);
  const ymd = (d) => {
    const fmt = new Intl.DateTimeFormat('es-EC', {
      timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const g = (t) => fmt.find((p) => p.type === t)?.value || '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  };
  if (periodo === 'hoy') return { desde: fecha, hasta: fecha, label: 'hoy' };
  if (periodo === 'semana') {
    const dow = hoy.getUTCDay() || 7; // lunes=1 ... domingo=7
    const lunes = new Date(hoy); lunes.setUTCDate(hoy.getUTCDate() - (dow - 1));
    const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: ymd(lunes), hasta: ymd(domingo), label: 'esta semana' };
  }
  if (periodo === 'mes') {
    const [y, m] = fecha.split('-');
    const first = `${y}-${m}-01`;
    const last = ymd(new Date(Date.UTC(Number(y), Number(m), 0)));
    return { desde: first, hasta: last, label: 'este mes' };
  }
  if (periodo === 'mes_anterior') {
    const [y, m] = fecha.split('-').map(Number);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const mm = String(prevM).padStart(2, '0');
    const first = `${prevY}-${mm}-01`;
    const last = ymd(new Date(Date.UTC(prevY, prevM, 0)));
    return { desde: first, hasta: last, label: 'mes anterior' };
  }
  return null;
}

async function buscarPacientes(nombre) {
  const termino = (nombre || '').trim();
  if (!termino) return [];
  const pattern = `%${termino.split(/\s+/).join('%')}%`;
  const { data, error } = await supabase
    .from('pacientes')
    .select('id, nombre')
    .ilike('nombre', pattern)
    .limit(10);
  if (error) throw error;
  return data || [];
}

async function buscarCitasDePaciente(pacienteId, fechaActual) {
  const hoy = guayaquilParts().fecha;
  let query = supabase
    .from('citas')
    .select('id, fecha, hora, servicio, modalidad, estado')
    .eq('paciente_id', pacienteId)
    .in('estado', ['pendiente_pago', 'confirmada'])
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });
  if (fechaActual) {
    query = query.eq('fecha', fechaActual);
  } else {
    query = query.gte('fecha', hoy);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Active states: exclude terminal/inactive states per REQ-S2-01
const BULK_EXCLUDED_STATES = ['cancelada', 'no_show', 'rechazada']

// ─── Context cache helpers (PR2a) ────────────────────────────────────────────
//
// Single-operator design: cache key = process.env.TELEGRAM_CHAT_ID.
// No chatId param threading required (decision #494 — single operator env).
// All three helpers swallow errors so a missing/failed table never breaks the
// search flow (design D8 / REQ-2.5).

const KELLY_CONTEXT_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Persist the last bulk-search result to telegram_kelly_context.
 * Upserts keyed by TELEGRAM_CHAT_ID. Swallows all errors.
 *
 * @param {{ zona?: string, fecha_desde: string, fecha_hasta: string, hora_desde?: string, hora_hasta?: string }} criteria
 * @param {Array<{ cita_id: string, paciente_nombre: string, fecha: string, hora: string, duracion_min: number }>} citas
 */
export async function writeKellyContext(criteria, citas) {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const { error } = await supabase.from('telegram_kelly_context').upsert({
      chat_id: chatId,
      last_search: { criteria, citas },
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[telegram/context] writeKellyContext error (swallowed):', error.message);
    }
  } catch (err) {
    console.warn('[telegram/context] writeKellyContext threw (swallowed):', err?.message || err);
  }
}

/**
 * Read the last bulk-search context for the operator.
 * Returns null if the row is missing, stale (>30 min), or a table error occurs.
 *
 * @returns {Promise<{ criteria: object, citas: Array } | null>}
 */
export async function readKellyContext() {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const { data, error } = await supabase
      .from('telegram_kelly_context')
      .select('last_search, updated_at')
      .eq('chat_id', chatId)
      .single();
    if (error || !data) return null;
    const ageMs = Date.now() - new Date(data.updated_at).getTime();
    if (ageMs > KELLY_CONTEXT_TTL_MS) return null;
    return data.last_search ?? null;
  } catch (err) {
    console.warn('[telegram/context] readKellyContext threw (swallowed):', err?.message || err);
    return null;
  }
}

/**
 * Delete the operator's context row. Swallows all errors.
 */
export async function clearKellyContext() {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const { error } = await supabase
      .from('telegram_kelly_context')
      .delete()
      .eq('chat_id', chatId);
    if (error) {
      console.warn('[telegram/context] clearKellyContext error (swallowed):', error.message);
    }
  } catch (err) {
    console.warn('[telegram/context] clearKellyContext threw (swallowed):', err?.message || err);
  }
}

/**
 * Query active citas in a date range, optionally filtered by zona.
 * Returns a formatted candidate list or a clarification if no results.
 *
 * This tool is operator-only (Telegram lane). It is unreachable from the
 * patient/WhatsApp lane because handleKellyMessage is exclusively triggered
 * by the Telegram webhook, gated by TELEGRAM_CHAT_ID.
 *
 * REQ-S2-01, REQ-S2-02, REQ-S2-03
 *
 * @param {{ zona?: string, fecha_desde: string, fecha_hasta: string, estado?: string[], hora_desde?: string, hora_hasta?: string }} args
 *
 * WARNING: passing an explicit `estado[]` override REPLACES the default
 * BULK_EXCLUDED_STATES exclusion entirely. The rebuilt query uses `.in('estado', estado)`
 * instead of `.not(...)`, so a caller CAN include terminal states (cancelada, no_show,
 * rechazada) if they pass them explicitly. Omit `estado` to get the safe default.
 *
 * hora_desde / hora_hasta (HH:MM, 24h zero-padded) filter citas by time window.
 * Both-or-neither: if exactly one is provided, the tool returns a validation error
 * without querying the DB (REQ-1.1). Comparison is lexicographic on HH:MM strings
 * which is correct for zero-padded 24h time (REQ-1.2).
 */
async function toolBuscarCitasBulk({ zona, fecha_desde, fecha_hasta, estado, hora_desde, hora_hasta }) {
  if (!fecha_desde || !fecha_hasta) {
    return sendToKely('⚠️ Necesito fecha_desde y fecha_hasta (YYYY-MM-DD) para buscar citas.')
  }

  // REQ-1.1: both-or-neither — if exactly one hora param is provided, reject immediately
  const horaDesdePresent = hora_desde != null && hora_desde !== ''
  const horaHastaPresent = hora_hasta != null && hora_hasta !== ''
  if (horaDesdePresent !== horaHastaPresent) {
    return sendToKely(
      '⚠️ hora_desde y hora_hasta deben usarse siempre juntos (ambos o ninguno). ' +
      `Falta: ${!horaDesdePresent ? 'hora_desde' : 'hora_hasta'}`
    )
  }
  const horaFilter = horaDesdePresent && horaHastaPresent

  // Build query — RLS-safe via service role; no patient PII in logs
  // Use a LEFT embed for pacientes so citas without a linked patient are not dropped.
  // patient_name_normalized is included as a fallback for imported rows.
  const SELECT_COLS = 'id, fecha, hora, zona, estado, duracion_min, patient_name_normalized, pacientes(nombre)'

  let query = supabase
    .from('citas')
    .select(SELECT_COLS)
    .gte('fecha', fecha_desde)
    .lte('fecha', fecha_hasta)
    .not('estado', 'in', `(${BULK_EXCLUDED_STATES.join(',')})`)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (zona) {
    query = query.eq('zona', zona)
  }

  // REQ-1.2: apply hora filter (inclusive bounds) when both params present
  if (horaFilter) {
    query = query.gte('hora', hora_desde).lte('hora', hora_hasta)
  }

  // Caller may override the excluded states (e.g. include 'cancelada' for review)
  if (Array.isArray(estado) && estado.length > 0) {
    query = supabase
      .from('citas')
      .select(SELECT_COLS)
      .gte('fecha', fecha_desde)
      .lte('fecha', fecha_hasta)
      .in('estado', estado)
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })

    if (zona) {
      query = query.eq('zona', zona)
    }

    // REQ-1.2 / REQ-1.3: hora filter must also be applied to the explicit-estado branch
    if (horaFilter) {
      query = query.gte('hora', hora_desde).lte('hora', hora_hasta)
    }
  }

  const { data: citas, error } = await query
  if (error) throw error

  if (!citas || citas.length === 0) {
    // REQ-S2-02: empty result → clarification, no side effects
    const zonaStr = zona ? ` en zona ${zona}` : ''
    return sendToKely(
      `🔍 No encontré citas activas${zonaStr} entre ${fecha_desde} y ${fecha_hasta}. ` +
      `Podés ampliar el rango de fechas o cambiar la zona.`
    )
  }

  // Format candidate list for Kely — grouped by day, no raw UUIDs
  const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const zonaLabel = zona
    ? zona.charAt(0).toUpperCase() + zona.slice(1)
    : 'Todas las zonas'

  // Build a readable date range for the header
  const [dy, dm, dd] = fecha_desde.split('-').map(Number)
  const [hy, hm, hd] = fecha_hasta.split('-').map(Number)
  const rangeLabel = (fecha_desde === fecha_hasta)
    ? `${dd} ${MESES_CORTO[dm - 1]}`
    : `${dd} al ${hd} ${MESES_CORTO[hm - 1]}`

  const citaWord = citas.length === 1 ? 'cita' : 'citas'
  const lines = [
    `📋 ${zonaLabel} · ${rangeLabel} · ${citas.length} ${citaWord}`,
  ]

  // Group citas by fecha and emit a day-header per group
  let lastFecha = null
  for (const c of citas) {
    if (c.fecha !== lastFecha) {
      if (lastFecha !== null) lines.push('') // blank line between day groups
      lines.push(`🗓 ${formatDiaCorto(c.fecha)}`)
      lastFecha = c.fecha
    }
    const hora = (c.hora || '').slice(0, 5)
    const duracion = c.duracion_min ? ` · ${c.duracion_min} min` : ''
    const nombre = c.pacientes?.nombre || c.patient_name_normalized || '(sin nombre)'
    const estadoMarker = (c.estado && c.estado !== 'confirmada') ? ` · ⏳ ${c.estado}` : ''
    lines.push(`   • ${hora} — ${nombre}${duracion}${estadoMarker}`)
  }

  await sendToKely(lines.join('\n'))

  // PR2a: return structured result so the dispatcher can persist context (D5 root-cause fix).
  // Map DB rows to the last_search cita shape: cita_id, paciente_nombre, fecha, hora, duracion_min.
  const mappedCitas = citas.map((c) => ({
    cita_id: c.id,
    paciente_nombre: c.pacientes?.nombre || c.patient_name_normalized || '(sin nombre)',
    fecha: c.fecha,
    hora: (c.hora || '').slice(0, 5),
    duracion_min: c.duracion_min ?? 30,
  }))

  return {
    citas: mappedCitas,
    criteria: { zona, fecha_desde, fecha_hasta, hora_desde, hora_hasta },
  }
}

// ─── Bulk reschedule preview tool ────────────────────────────────────────────

/**
 * Create a single pending_kelly_actions row for a bulk reschedule request.
 *
 * Validates:
 *   - items.length > 0 and items.length <= MAX_BULK_ITEMS (REQ-S3-02)
 *   - No target slot overlaps an existing cita via slot-generator (REQ-S3-01)
 *
 * On success: INSERTs one pending row (action_type='reagendar_bulk') and returns
 * an OperatorPreview so the dispatcher sends a single Telegram message with buttons.
 *
 * REQ-S3-01, REQ-S3-02 / AC-03, AC-04
 *
 * @param {{ items: Array<{cita_id:string,fecha_original:string,hora_original:string,nueva_fecha:string,nueva_hora:string,duracion_min:number}> }} args
 * @returns {Promise<OperatorToolResult>}
 */
async function toolReagendarBulkPreview({ items }) {
  // ── Validation: empty or over-cap ───────────────────────────────────────────
  if (!Array.isArray(items) || items.length === 0) {
    return sendToKely('⚠️ La lista de citas está vacía. Indicá las citas a reagendar.')
  }
  if (items.length > MAX_BULK_ITEMS) {
    return sendToKely(
      `⚠️ Demasiadas citas (${items.length}). El máximo es ${MAX_BULK_ITEMS} por reagendamiento masivo. ` +
      `Dividí la solicitud en bloques más pequeños.`
    )
  }

  // ── Validation: overlap check at preview time ────────────────────────────────
  // Fetch all citas on the target dates to build occupied ranges.
  // We also need the ids so we can exclude the batch's own citas (their current
  // slots are being vacated — treating them as occupied would cause a false
  // self-collision when moving a cita to a different time on the same day).
  const targetDates = [...new Set(items.map((i) => i.nueva_fecha))]
  const { data: existingCitas, error: fetchError } = await supabase
    .from('citas')
    .select('id, fecha, hora, duracion_min, estado')
    .in('fecha', targetDates)
  if (fetchError) throw fetchError

  // Build the set of cita ids being moved so we can skip their current rows.
  const batchCitaIds = new Set(items.map((i) => i.cita_id))

  // Build occupied ranges (excludes terminal states AND the batch's own citas).
  // Known limitation: inter-sibling target collisions (two items in the same
  // batch targeting overlapping slots) are NOT checked here — the DB unique
  // constraint or a follow-up validation would be needed to catch those.
  const occupied = buildOccupiedRanges(
    (existingCitas || []).filter((c) => !batchCitaIds.has(c.id))
  )

  for (const item of items) {
    const { nueva_fecha, nueva_hora, duracion_min, cita_id } = item
    const startMin = timeToMinutes(nueva_hora)
    const endTime = addMinutesToTime(nueva_hora, Number(duracion_min) > 0 ? Number(duracion_min) : 30)
    const endMin = timeToMinutes(endTime)

    const conflict = occupied.some((range) => {
      if (range.fecha !== nueva_fecha) return false
      return rangesOverlap(startMin, endMin, timeToMinutes(range.start), timeToMinutes(range.end))
    })

    if (conflict) {
      return sendToKely(
        `⚠️ Conflicto de horario: la cita ${cita_id} quiere moverse a ${nueva_fecha} ${nueva_hora} ` +
        `pero ese horario está ocupado. Revisá la disponibilidad antes de reagendar.`
      )
    }
  }

  // ── INSERT one pending row ───────────────────────────────────────────────────
  const paciente_nombres = items.map((i) => i.paciente_nombre || i.cita_id)
  const { data: pending, error: insertError } = await supabase
    .from('pending_kelly_actions')
    .insert({
      action_type: 'reagendar_bulk',
      args: { items, paciente_nombres },
    })
    .select('id')
    .single()
  if (insertError) throw insertError

  // ── Build summary (truncate at 4096 chars with (+N más)) ────────────────────
  const previewId = pending?.id || 'unknown'
  const headerLines = [
    `📋 Reagendamiento masivo — ${items.length} cita${items.length !== 1 ? 's' : ''}:`,
    '',
  ]
  const itemLines = items.map((item, idx) =>
    `${idx + 1}. Cita ${item.cita_id} — ${item.fecha_original} ${item.hora_original} → ${item.nueva_fecha} ${item.nueva_hora}` +
    (item.paciente_nombre ? ` (${item.paciente_nombre})` : '')
  )
  const footer = '\n¿Confirmás el reagendamiento de todas las citas?'

  const MAX_CHARS = 4096
  const header = headerLines.join('\n')
  let body = itemLines.join('\n')
  const fullText = `${header}\n${body}${footer}`

  let summaryText = fullText
  if (fullText.length > MAX_CHARS) {
    // Trim item lines until it fits, then append (+N más)
    let shown = 0
    let bodyAccum = ''
    for (const line of itemLines) {
      const candidate = `${header}\n${bodyAccum}${bodyAccum ? '\n' : ''}${line}`
      const remaining = items.length - shown - 1
      const truncMarker = remaining > 0 ? `\n(+${remaining} más)` : ''
      if ((candidate + truncMarker + footer).length > MAX_CHARS) break
      bodyAccum = bodyAccum ? `${bodyAccum}\n${line}` : line
      shown++
    }
    const remaining = items.length - shown
    const truncMarker = remaining > 0 ? `\n(+${remaining} más)` : ''
    summaryText = `${header}\n${bodyAccum}${truncMarker}${footer}`
  }

  /** @type {OperatorPreview} */
  return {
    kind: 'preview',
    actionType: 'reagendar_bulk',
    previewId,
    summary: summaryText,
    keyboard: [
      [
        { text: '✅ Confirmar reagendamiento', callback_data: `kelly_confirm_${previewId}` },
        { text: '❌ Cancelar', callback_data: `kelly_cancel_${previewId}` },
      ],
    ],
  }
}

async function toolReagendarCita({ nombre_paciente, nueva_fecha, nueva_hora, fecha_actual }) {
  if (!nombre_paciente || !nueva_fecha || !nueva_hora) {
    return sendToKely('⚠️ Necesito paciente, nueva fecha y nueva hora.');
  }
  const pacientes = await buscarPacientes(nombre_paciente);
  if (pacientes.length === 0) {
    return sendToKely(`🔍 No encontré pacientes con "${nombre_paciente}". ¿Quieres que lo guarde como recordatorio?`);
  }
  if (pacientes.length > 1) {
    return sendToKely(listarPacientes(pacientes, `reagendar a ${nueva_fecha} ${nueva_hora}`));
  }
  const paciente = pacientes[0];
  const citas = await buscarCitasDePaciente(paciente.id, fecha_actual);
  if (citas.length === 0) {
    return sendToKely(`🔍 ${paciente.nombre} no tiene citas próximas${fecha_actual ? ` el ${fecha_actual}` : ''}.`);
  }
  if (citas.length > 1) {
    return sendToKely(listarCitasParaElegir(paciente.nombre, citas, 'reagendar'));
  }
  const cita = citas[0];
  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .insert({
      action_type: 'reagendar',
      args: {
        cita_id: cita.id,
        paciente_nombre: paciente.nombre,
        fecha_original: cita.fecha,
        hora_original: cita.hora,
        nueva_fecha, nueva_hora,
      },
    })
    .select('id')
    .single();
  if (error) throw error;
  const summary = [
    `🔄 Reagendar:`,
    `Paciente: ${paciente.nombre}`,
    `De: ${cita.fecha} ${(cita.hora || '').slice(0, 5)}`,
    `A: ${nueva_fecha} ${nueva_hora}`,
  ].join('\n');
  /** @type {OperatorPreview} */
  return {
    kind: 'preview',
    actionType: 'reagendar',
    previewId: pending.id,
    summary,
    keyboard: [
      [
        { text: '✅ Sí, reagendar', callback_data: `kelly_confirm_${pending.id}` },
        { text: '❌ No', callback_data: `kelly_cancel_${pending.id}` },
      ],
    ],
  };
}

async function toolCancelarCita({ nombre_paciente, fecha }) {
  if (!nombre_paciente) return sendToKely('⚠️ Necesito el nombre del paciente.');
  const pacientes = await buscarPacientes(nombre_paciente);
  if (pacientes.length === 0) {
    return sendToKely(`🔍 No encontré pacientes con "${nombre_paciente}".`);
  }
  if (pacientes.length > 1) {
    return sendToKely(listarPacientes(pacientes, fecha ? `cancelar del ${fecha}` : 'cancelar'));
  }
  const paciente = pacientes[0];
  const citas = await buscarCitasDePaciente(paciente.id, fecha);
  if (citas.length === 0) {
    return sendToKely(`🔍 ${paciente.nombre} no tiene citas próximas${fecha ? ` el ${fecha}` : ''}.`);
  }
  if (citas.length > 1) {
    return sendToKely(listarCitasParaElegir(paciente.nombre, citas, 'cancelar'));
  }
  const cita = citas[0];
  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .insert({
      action_type: 'cancelar',
      args: {
        cita_id: cita.id,
        paciente_nombre: paciente.nombre,
        fecha: cita.fecha, hora: cita.hora,
      },
    })
    .select('id')
    .single();
  if (error) throw error;
  const summary = [
    `❌ Cancelar cita:`,
    `Paciente: ${paciente.nombre}`,
    `${cita.fecha} ${(cita.hora || '').slice(0, 5)} — ${cita.servicio || ''}`,
  ].join('\n');
  /** @type {OperatorPreview} */
  return {
    kind: 'preview',
    actionType: 'cancelar',
    previewId: pending.id,
    summary,
    keyboard: [
      [
        { text: '✅ Sí, cancelar', callback_data: `kelly_confirm_${pending.id}` },
        { text: '↩️ No', callback_data: `kelly_cancel_${pending.id}` },
      ],
    ],
  };
}

async function toolCrearBloqueo({ fecha, hora, duracion_min, motivo }) {
  if (!fecha || !hora || !duracion_min || !motivo) {
    return sendToKely('⚠️ Necesito fecha, hora, duración en minutos y motivo.');
  }
  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .insert({
      action_type: 'bloqueo',
      args: { fecha, hora, duracion_min, motivo },
    })
    .select('id')
    .single();
  if (error) throw error;
  const summary = [
    `🛑 Bloquear agenda:`,
    `${fecha} ${hora} — ${duracion_min} min`,
    `Motivo: ${motivo}`,
  ].join('\n');
  /** @type {OperatorPreview} */
  return {
    kind: 'preview',
    actionType: 'bloqueo',
    previewId: pending.id,
    summary,
    keyboard: [
      [
        { text: '✅ Sí, bloquear', callback_data: `kelly_confirm_${pending.id}` },
        { text: '❌ No', callback_data: `kelly_cancel_${pending.id}` },
      ],
    ],
  };
}

// Fila de bloqueo de agenda. servicio y modalidad son NOT NULL en `citas`, así que
// se rellenan con valores fijos para bloqueos (no son citas de paciente reales).
function buildBloqueoRow({ fecha, hora, duracion_min, motivo }) {
  return {
    paciente_id: null,
    fecha,
    hora,
    duracion_min,
    servicio: 'bloqueo_personal',
    modalidad: 'presencial',
    motivo_bloqueo: motivo,
    estado: 'agenda_bloqueada',
  };
}

// Hora de disparo del recordatorio = evento (hora Guayaquil, UTC-5) menos los
// minutos de anticipación. Devuelve ISO en UTC para guardar en tareas.fecha_hora.
function computeRecordatorioIso(fecha, hora, minAntes) {
  const evento = new Date(`${fecha}T${hora.slice(0, 5)}:00-05:00`);
  return new Date(evento.getTime() - minAntes * 60 * 1000).toISOString();
}

async function toolAgendarEventoPersonal(rawArgs, policy) {
  const { motivo, fecha, hora } = rawArgs;
  if (!motivo || !fecha || !hora) {
    await sendToKely('⚠️ Necesito qué es el evento, la fecha y la hora.');
    return;
  }

  // Merge operator defaults through the audited policy path.
  // The policy guard in mergeOperatorOverrides ensures misconfigured callers fail loudly.
  const merged = mergeOperatorOverrides(policy, rawArgs, {
    duracion_min: 60,
    recordar_min_antes: 30,
  });

  // Coerce and validate after merge: duracion_min must be a positive number.
  const duracion = Number(merged.duracion_min) > 0 ? Number(merged.duracion_min) : 60;
  // recordar_min_antes=0 is valid (no reminder); negative values are clamped to 0.
  const recordar = Math.max(0, Number(merged.recordar_min_antes) || 0);

  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .insert({
      action_type: 'evento_personal',
      args: { fecha, hora, duracion_min: duracion, motivo, recordar_min_antes: recordar },
    })
    .select('id')
    .single();
  if (error) throw error;

  const summary = [
    `🗓️ Evento personal:`,
    motivo,
    `${fecha} ${hora} — ${duracion} min`,
    recordar > 0 ? `Recordatorio: ${recordar} min antes` : 'Sin recordatorio',
  ].join('\n');
  /** @type {OperatorPreview} */
  return {
    kind: 'preview',
    actionType: 'evento_personal',
    previewId: pending.id,
    summary,
    keyboard: [
      [
        { text: '✅ Sí, agendar', callback_data: `kelly_confirm_${pending.id}` },
        { text: '❌ No', callback_data: `kelly_cancel_${pending.id}` },
      ],
    ],
  };
}

async function toolCrearTarea({ descripcion, fecha_hora_iso }) {
  if (!descripcion || !fecha_hora_iso) {
    return sendToKely('⚠️ Necesito descripción y fecha/hora.');
  }
  const fechaHora = new Date(fecha_hora_iso);
  if (isNaN(fechaHora.getTime())) {
    return sendToKely('⚠️ No logré entender la fecha de la tarea.');
  }
  const { error } = await supabase
    .from('tareas')
    .insert({ descripcion: descripcion.trim(), fecha_hora: fechaHora.toISOString() });
  if (error) throw error;
  const { fecha, hora } = formatFechaParaKely(fecha_hora_iso);
  await sendToKely(`✅ Listo, te recuerdo ${descripcion} el ${fecha} a las ${hora}.`);
}

function listarPacientes(pacientes, contextoAccion) {
  const lines = [`Encontré varios pacientes para "${contextoAccion}". Decime cuál:`, ''];
  pacientes.forEach((p, i) => lines.push(`${i + 1}. ${p.nombre}`));
  return lines.join('\n');
}

function listarCitasParaElegir(nombrePaciente, citas, accion) {
  const lines = [`${nombrePaciente} tiene varias citas próximas. ¿Cuál querés ${accion}?`, ''];
  citas.forEach((c, i) => lines.push(`${i + 1}. ${c.fecha} ${(c.hora || '').slice(0, 5)} — ${c.servicio || ''} [${c.estado}]`));
  return lines.join('\n');
}

function formatFechaParaKely(isoString) {
  const d = new Date(isoString);
  const fecha = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', weekday: 'long', day: '2-digit', month: 'long',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return { fecha, hora };
}

// ─── Payment approval callbacks (T8b + T8c) ───────────────────────────────────

/**
 * Edit a photo message caption in Telegram, optionally replacing the inline keyboard.
 * Used to stamp ✅ or ❌ on Kelly's payment notification message after she acts.
 */
async function editPaymentMessageCaption(callbackQuery, prefixLine, replyMarkup) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const msg = callbackQuery.message;
  if (!token || !msg?.message_id) return;

  const originalCaption = msg.caption || '';
  const newCaption = `${prefixLine}\n\n${originalCaption}`;

  const body = {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    caption: newCaption,
    parse_mode: 'Markdown',
  };
  if (replyMarkup !== undefined) {
    body.reply_markup = replyMarkup;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[Telegram] editPaymentMessageCaption failed:', err?.message);
  }
}

/**
 * Handles Kelly tapping ✅ (payment_confirm_<pendingId>).
 *
 * Flow (FR-12, FR-16, FR-17):
 *   1. Fetch pending_kelly_actions row.
 *   2. If not found → answer "Esta acción ya no existe".
 *   3. If expira_at < NOW() → answer "Esta acción expiró".
 *   4. Fetch cita. If estado ∈ {confirmada, rechazada} → idempotency answer.
 *   5. Status-guarded UPDATE citas SET estado='confirmada' WHERE estado='confirmada_provisional'.
 *   6. UPDATE pagos SET verificado=true.
 *   7. DELETE FROM pending_kelly_actions.
 *   8. Edit Telegram caption: prepend "✅ APROBADO POR KELLY", remove all buttons.
 *   9. Answer callback.
 *   No WhatsApp message to patient (FR-12).
 */
async function handlePaymentConfirm(pendingId, callbackQuery) {
  // 1. Fetch pending action
  const { data: pending } = await supabase
    .from('pending_kelly_actions')
    .select('id, expira_at, args')
    .eq('id', pendingId)
    .single();

  if (!pending) {
    console.log(`[Telegram] payment_confirm pending not found pending_id=${pendingId}`);
    await answerCallback(callbackQuery, 'Esta acción ya no existe');
    return;
  }

  // 2. Check expiry (FR-17)
  if (new Date(pending.expira_at) < new Date()) {
    console.log(`[Telegram] payment_confirm pending_id=${pendingId} expira_at expired`);
    await answerCallback(callbackQuery, 'Esta acción expiró');
    return;
  }

  const { cita_id, pago_id } = pending.args || {};

  // 3. Fetch cita
  const { data: cita } = await supabase
    .from('citas')
    .select('id, estado')
    .eq('id', cita_id)
    .single();

  // 4. Idempotency (FR-16)
  if (cita?.estado === 'confirmada' || cita?.estado === 'rechazada') {
    console.log(`[Telegram] payment_confirm already_processed cita_id=${cita_id} estado=${cita.estado}`);
    await answerCallback(callbackQuery, 'Esta cita ya fue procesada');
    return;
  }

  // 5. Status-guarded UPDATE citas → confirmada
  await supabase
    .from('citas')
    .update({ estado: 'confirmada' })
    .eq('id', cita_id)
    .eq('estado', 'confirmada_provisional');

  // 6. UPDATE pagos → verificado=true
  await supabase
    .from('pagos')
    .update({ verificado: true })
    .eq('id', pago_id);

  // 7. DELETE pending_kelly_actions row
  await supabase
    .from('pending_kelly_actions')
    .delete()
    .eq('id', pendingId);

  console.log(`[Telegram] payment_confirm cita_id=${cita_id} pending_id=${pendingId}`);

  // 8. Edit Telegram message — prepend ✅, remove all buttons
  await editPaymentMessageCaption(
    callbackQuery,
    '✅ APROBADO POR KELLY',
    { inline_keyboard: [] }
  );

  // 9. Answer callback
  await answerCallback(callbackQuery, 'Aprobada ✅');
}

/**
 * Handles Kelly tapping ❌ (payment_reject_<pendingId>).
 *
 * Flow (FR-13, FR-14, FR-15, FR-16, FR-17):
 *   1-3. Same pre-checks as handlePaymentConfirm.
 *   4. Status-guarded UPDATE citas SET estado='rechazada'.
 *   5. DELETE FROM pending_kelly_actions.
 *   6. Recompute 24h window from conversaciones.last_message_at (FR-15).
 *   7a. Within 24h → send WA M5 to patient, edit caption with "mensaje enviado", remove buttons.
 *   7b. Outside 24h → no WA, edit caption with "fuera de ventana 24h", keep 💬 wa.me button.
 *   8. Answer callback.
 *   Slot is freed automatically: setting estado='rechazada' excludes the row from
 *   consultar_disponibilidad via the `.not('estado','in','(cancelada,no_show,rechazada)')` filter.
 */
async function handlePaymentReject(pendingId, callbackQuery) {
  // 1. Fetch pending action
  const { data: pending } = await supabase
    .from('pending_kelly_actions')
    .select('id, expira_at, args')
    .eq('id', pendingId)
    .single();

  if (!pending) {
    console.log(`[Telegram] payment_reject pending not found pending_id=${pendingId}`);
    await answerCallback(callbackQuery, 'Esta acción ya no existe');
    return;
  }

  // 2. Check expiry (FR-17)
  if (new Date(pending.expira_at) < new Date()) {
    console.log(`[Telegram] payment_reject pending_id=${pendingId} expired`);
    await answerCallback(callbackQuery, 'Esta acción expiró');
    return;
  }

  const { cita_id, pago_id } = pending.args || {};

  // 3. Fetch cita (need paciente_id for WA window + phone lookup)
  const { data: cita } = await supabase
    .from('citas')
    .select('id, estado, paciente_id')
    .eq('id', cita_id)
    .single();

  // 4. Idempotency (FR-16)
  if (cita?.estado === 'confirmada' || cita?.estado === 'rechazada') {
    console.log(`[Telegram] payment_reject already_processed cita_id=${cita_id} estado=${cita?.estado}`);
    await answerCallback(callbackQuery, 'Esta cita ya fue procesada');
    return;
  }

  // 5. Status-guarded UPDATE citas → rechazada (frees the slot — rechazada is excluded from
  //    consultar_disponibilidad once tools.ts is updated to include rechazada in exclusion list)
  await supabase
    .from('citas')
    .update({ estado: 'rechazada' })
    .eq('id', cita_id)
    .eq('estado', 'confirmada_provisional');

  // 6. DELETE pending_kelly_actions
  await supabase
    .from('pending_kelly_actions')
    .delete()
    .eq('id', pendingId);

  // 7. Recompute 24h window AT CLICK TIME (FR-15 — never trust the Telegram snapshot)
  const pacienteId = cita?.paciente_id;
  let windowRemainingMs = 0;
  let patientPhone = null;
  let patientName = null;

  if (pacienteId) {
    const [{ data: conv }, { data: paciente }] = await Promise.all([
      supabase
        .from('conversaciones')
        .select('last_message_at')
        .eq('paciente_id', pacienteId)
        .order('ultima_actividad', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('pacientes')
        .select('nombre, telefono')
        .eq('id', pacienteId)
        .single(),
    ]);

    if (conv?.last_message_at) {
      windowRemainingMs = new Date(conv.last_message_at).getTime() + 24 * 3600 * 1000 - Date.now();
    }
    patientPhone = paciente?.telefono ?? null;
    patientName = (paciente?.nombre ?? '').split(' ')[0] || paciente?.nombre || '';
  }

  const inWindow = windowRemainingMs > 0;

  if (inWindow) {
    // Within 24h: send WA rejection message (M5 copy from copy-final, interpolating {{nombre}})
    if (patientPhone) {
      const m5 = `Hola ${patientName}, no pude confirmar tu cita porque no recibimos el adelanto correspondiente. Te recordamos que el adelanto es parte de la política de la consulta para reservar el turno. Si quieres reagendar o tuviste algún inconveniente con el pago, cuéntame por acá y lo resolvemos. ¡Quedo atenta!`;
      await sendWhatsAppMessage(patientPhone, m5);
      console.log(`[Telegram] payment_reject in_window=true ms_left=${windowRemainingMs}`);
    }
    await editPaymentMessageCaption(
      callbackQuery,
      '❌ RECHAZADO POR KELLY (mensaje enviado al paciente)',
      { inline_keyboard: [] }
    );
  } else {
    // Outside 24h: no WA, keep 💬 wa.me button
    console.log(`[Telegram] payment_reject in_window=false`);

    // Reconstruct wa.me deep-link button (same as telegram-notify.ts built it)
    const phoneE164 = patientPhone ? patientPhone.replace(/^\+/, '') : '';
    const waText = WAME_DEFAULT_PRESET.replace('{{nombre}}', patientName);
    const waUrl = `https://wa.me/${phoneE164}?text=${encodeURIComponent(waText)}`;
    const waButton = { text: `💬 Escribir a ${patientName}`, url: waUrl };

    await editPaymentMessageCaption(
      callbackQuery,
      '❌ RECHAZADO POR KELLY (fuera de ventana 24h)',
      { inline_keyboard: [[waButton]] }
    );
  }

  // 8. Answer callback
  await answerCallback(callbackQuery, 'Rechazada ❌');
}

// ─── Resolución de acciones confirmadas ───────────────────────────────────────

/**
 * Resolve a pending Kelly action (confirm or cancel).
 *
 * @param {string} pendingId
 * @param {boolean} confirmar
 * @returns {Promise<OperatorResult>}
 */
async function resolveKellyPending(pendingId, confirmar) {
  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .select('id, action_type, args, ejecutada, expira_at')
    .eq('id', pendingId)
    .single();

  if (error || !pending) {
    return { kind: 'result', status: 'failed', message: '⚠️ Acción no encontrada.' };
  }
  if (pending.ejecutada) {
    return { kind: 'result', status: 'already', message: 'ℹ️ Ya estaba aplicada.' };
  }
  if (new Date(pending.expira_at) < new Date()) {
    return { kind: 'result', status: 'failed', message: '⌛ La acción expiró.' };
  }

  // ── Optimistic lock (CAS): flip ejecutada=true BEFORE any side-effect.
  // This closes the concurrent race: two taps both pass the early-exit checks
  // above, but only one wins the UPDATE WHERE ejecutada=false.
  // The winning tap gets count:1 and proceeds; the loser gets count:0 and stops.
  const casAction = confirmar ? 'confirm' : 'cancel';
  const { count: casCount, error: casError } = await supabase
    .from('pending_kelly_actions')
    .update({ ejecutada: true, ejecutada_at: new Date().toISOString() })
    .eq('id', pendingId)
    .eq('ejecutada', false)
    .select();

  if (casError) {
    console.error(`[Telegram/kelly] CAS error (${casAction}):`, casError?.message || casError);
    return { kind: 'result', status: 'failed', message: '⚠️ Falló al aplicar.' };
  }
  // count===0: another tap already won the lock (or already applied from JS guard above)
  if (!casCount || casCount === 0) {
    return { kind: 'result', status: 'already', message: 'ℹ️ Ya fue aplicada.' };
  }

  // We won the lock. For cancel of a reagendar_bulk action: clear context so the
  // stale search does not linger and bias the next turn (Fix 1 — clear on cancel).
  if (!confirmar) {
    if (pending.action_type === 'reagendar_bulk') {
      await clearKellyContext();
    }
    return { kind: 'result', status: 'cancelled', message: '↩️ Cancelado.' };
  }

  // We won the lock for confirm: execute the side-effect exactly once.
  try {
    if (pending.action_type === 'reagendar_bulk') {
      // ── Best-effort bulk apply: iterate items, collect per-item results ──────
      // CAS lock already won above. Each cita.update() is independent — no
      // Postgres transaction wraps the loop (Supabase REST calls). Continue on
      // individual failure (REQ-S3-04 best-effort + per-item report).
      const { items = [] } = pending.args;
      const results = [];
      for (const item of items) {
        const { cita_id, nueva_fecha, nueva_hora } = item;
        const { error: e } = await supabase
          .from('citas')
          .update({ fecha: nueva_fecha, hora: nueva_hora })
          .eq('id', cita_id);
        results.push({ cita_id, ok: !e, error: e?.message });
      }
      const applied = results.filter((r) => r.ok).length;
      const failed  = results.filter((r) => !r.ok).length;
      const failList = results
        .filter((r) => !r.ok)
        .map((r) => `• ${r.cita_id}: ${r.error || 'error desconocido'}`)
        .join('\n');
      // Fix 2: clear context on ALL outcomes of a bulk confirm (success, partial,
      // or total failure). The search is consumed the moment the user acted on it;
      // leaving it would bias the next unrelated turn.
      await clearKellyContext();
      if (applied === 0) {
        return {
          kind: 'result',
          status: 'failed',
          message: `⚠️ No se pudo reagendar ninguna cita (${failed} fallaron):\n${failList}`,
        };
      }
      if (failed === 0) {
        return { kind: 'result', status: 'applied', message: `✅ ${applied} cita${applied !== 1 ? 's' : ''} reagendada${applied !== 1 ? 's' : ''}.` };
      }
      return {
        kind: 'result',
        status: 'applied',
        message: `✅ ${applied} reagendada${applied !== 1 ? 's' : ''} / ⚠️ ${failed} fallaron:\n${failList}`,
      };
    } else if (pending.action_type === 'reagendar') {
      const { cita_id, nueva_fecha, nueva_hora } = pending.args;
      const { error: e } = await supabase
        .from('citas')
        .update({ fecha: nueva_fecha, hora: nueva_hora })
        .eq('id', cita_id);
      if (e) throw e;
    } else if (pending.action_type === 'cancelar') {
      const { cita_id } = pending.args;
      const { error: e } = await supabase
        .from('citas')
        .update({ estado: 'cancelada' })
        .eq('id', cita_id);
      if (e) throw e;
    } else if (pending.action_type === 'bloqueo') {
      const { fecha, hora, duracion_min, motivo } = pending.args;
      const { error: e } = await supabase
        .from('citas')
        .insert(buildBloqueoRow({ fecha, hora, duracion_min, motivo }));
      if (e) throw e;
    } else if (pending.action_type === 'evento_personal') {
      const { fecha, hora, duracion_min, motivo, recordar_min_antes } = pending.args;
      // 1. Block the schedule slot
      const { error: eBloqueo } = await supabase
        .from('citas')
        .insert(buildBloqueoRow({ fecha, hora, duracion_min, motivo }));
      if (eBloqueo) throw eBloqueo;
      // 2. Schedule reminder (0 = no reminder)
      if (recordar_min_antes > 0) {
        const recordatorioIso = computeRecordatorioIso(fecha, hora, recordar_min_antes);
        const { error: eTarea } = await supabase
          .from('tareas')
          .insert({ descripcion: `${motivo} (${hora})`, fecha_hora: recordatorioIso });
        if (eTarea) throw eTarea;
      }
    } else {
      return { kind: 'result', status: 'failed', message: '⚠️ Tipo desconocido.' };
    }

    return { kind: 'result', status: 'applied', message: '✅ Aplicado.' };
  } catch (err) {
    console.error('[Telegram/kelly] Error ejecutando acción:', err?.message || err);
    // Best-effort: the CAS lock was already flipped. The action failed but won't
    // be retried (ejecutada=true). Log is sufficient for ops investigation.
    return { kind: 'result', status: 'failed', message: '⚠️ Falló al aplicar.' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendToKely(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('[Telegram] Error enviando mensaje:', err?.message || err);
  }
}

async function sendToKelyWithButtons(text, inlineKeyboard) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  } catch (err) {
    console.error('[Telegram] Error enviando mensaje con botones:', err?.message || err);
  }
}

async function resolveAttendance(citaId, vino) {
  const nuevoEstado = vino ? 'completada' : 'no_show';
  const { error } = await supabase
    .from('citas')
    .update({ estado: nuevoEstado })
    .eq('id', citaId);
  if (error) console.error('[Telegram/attendance] Error actualizando cita:', error);
}

async function resolveHandoff(conversacionId) {
  await supabase.from('conversaciones').update({ handoff_activo: false }).eq('id', conversacionId);
  await supabase.from('handoffs')
    .update({ estado: 'resuelto', resolved_at: new Date().toISOString() })
    .eq('conversacion_id', conversacionId)
    .eq('estado', 'activo');
}
