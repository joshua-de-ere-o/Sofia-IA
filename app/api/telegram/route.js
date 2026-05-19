import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getModelAdapter } from '@/lib/model-adapter';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      const result = await resolveKellyPending(pendingId, confirmar);
      await answerCallback(callbackQuery, result.toast);
      await replaceButtons(callbackQuery, result.label);
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

// ─── Modo-Kelly: dispatcher LLM con tools ─────────────────────────────────────

const KELLY_SYSTEM_PROMPT = `Eres Sofía, asistente de la Dra. Kelly Mariño (psicóloga, Quito, Ecuador).
Por este canal de Telegram hablas SOLO con Kelly — nunca con pacientes.
Tu trabajo: ayudarla a consultar y gestionar su agenda y finanzas con texto libre.

TRATO Y TONO
- Tratamiento: tú (informal, neutral Quito).
- Saludo solo si es el PRIMER mensaje del día. Después, vas directo a la respuesta.
- Sin frases de cortesía repetitivas, sin "¡Hola!" en cada turno, sin "qué bueno verte".
- Respuestas cortas, prácticas, sin emojis decorativos.

REGLAS DURAS
- Cero políticas de paciente: las restricciones 24h/48h NO aplican a Kelly. Si te pide reagendar para "en 2 horas", lo haces.
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
- crear_tarea { "descripcion": str, "fecha_hora_iso": "YYYY-MM-DDTHH:MM:SS-05:00" }
- responder_texto { "texto": str }  // para aclaraciones, preguntas a Kelly, saludo del día

Reglas:
- Si falta info para una destructiva (ej. duracion_min en bloqueo, hora exacta), usa responder_texto con la pregunta.
- Si la intención no encaja, usa crear_tarea y avisa con responder_texto que lo guardas como recordatorio.
- crear_bloqueo_agenda: duracion_min es OBLIGATORIO. Si Kelly no la dijo, preguntá con responder_texto.`;

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

  const userText = `[Hoy es ${ctx.legible}]\n[Primer mensaje del día: ${primerMensaje ? 'sí' : 'no'}]\n\nMensaje de Kelly:\n"${text}"`;

  let raw;
  try {
    raw = await adapter.chat({ systemPrompt: KELLY_SYSTEM_PROMPT, userText, maxTokens: 500 });
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
    switch (parsed.tool) {
      case 'consultar_agenda':     return await toolConsultarAgenda(args);
      case 'consultar_finanzas':   return await toolConsultarFinanzas(args);
      case 'reagendar_cita_kelly': return await toolReagendarCita(args);
      case 'cancelar_cita_kelly':  return await toolCancelarCita(args);
      case 'crear_bloqueo_agenda': return await toolCrearBloqueo(args);
      case 'crear_tarea':          return await toolCrearTarea(args);
      case 'responder_texto':      return await sendToKely(args.texto || '…');
      default:
        console.error('[Telegram/kelly] Tool desconocida:', parsed.tool);
        await sendToKely('⚠️ No supe qué hacer con eso. ¿Puedes reformular?');
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
  const cuerpo = [
    `🔄 Reagendar:`,
    `Paciente: ${paciente.nombre}`,
    `De: ${cita.fecha} ${(cita.hora || '').slice(0, 5)}`,
    `A: ${nueva_fecha} ${nueva_hora}`,
  ].join('\n');
  await sendToKelyWithButtons(cuerpo, [
    [
      { text: '✅ Sí, reagendar', callback_data: `kelly_confirm_${pending.id}` },
      { text: '❌ No', callback_data: `kelly_cancel_${pending.id}` },
    ],
  ]);
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
  const cuerpo = [
    `❌ Cancelar cita:`,
    `Paciente: ${paciente.nombre}`,
    `${cita.fecha} ${(cita.hora || '').slice(0, 5)} — ${cita.servicio || ''}`,
  ].join('\n');
  await sendToKelyWithButtons(cuerpo, [
    [
      { text: '✅ Sí, cancelar', callback_data: `kelly_confirm_${pending.id}` },
      { text: '↩️ No', callback_data: `kelly_cancel_${pending.id}` },
    ],
  ]);
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
  const cuerpo = [
    `🛑 Bloquear agenda:`,
    `${fecha} ${hora} — ${duracion_min} min`,
    `Motivo: ${motivo}`,
  ].join('\n');
  await sendToKelyWithButtons(cuerpo, [
    [
      { text: '✅ Sí, bloquear', callback_data: `kelly_confirm_${pending.id}` },
      { text: '❌ No', callback_data: `kelly_cancel_${pending.id}` },
    ],
  ]);
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

// ─── Resolución de acciones confirmadas ───────────────────────────────────────

async function resolveKellyPending(pendingId, confirmar) {
  const { data: pending, error } = await supabase
    .from('pending_kelly_actions')
    .select('id, action_type, args, ejecutada, expira_at')
    .eq('id', pendingId)
    .single();

  if (error || !pending) {
    return { toast: '⚠️ Acción no encontrada.', label: '⚠️ No encontrada' };
  }
  if (pending.ejecutada) {
    return { toast: 'ℹ️ Ya estaba aplicada.', label: 'ℹ️ Ya aplicada' };
  }
  if (new Date(pending.expira_at) < new Date()) {
    return { toast: '⌛ La acción expiró.', label: '⌛ Expirada' };
  }

  if (!confirmar) {
    await supabase.from('pending_kelly_actions')
      .update({ ejecutada: true, ejecutada_at: new Date().toISOString() })
      .eq('id', pendingId);
    return { toast: '↩️ Cancelado.', label: '↩️ Cancelado' };
  }

  try {
    if (pending.action_type === 'reagendar') {
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
        .insert({
          paciente_id: null,
          fecha, hora,
          duracion_min,
          motivo_bloqueo: motivo,
          estado: 'agenda_bloqueada',
        });
      if (e) throw e;
    } else {
      return { toast: '⚠️ Tipo desconocido.', label: '⚠️ Tipo desconocido' };
    }

    await supabase.from('pending_kelly_actions')
      .update({ ejecutada: true, ejecutada_at: new Date().toISOString() })
      .eq('id', pendingId);
    return { toast: '✅ Aplicado.', label: '✅ Aplicado' };
  } catch (err) {
    console.error('[Telegram/kelly] Error ejecutando acción:', err?.message || err);
    return { toast: '⚠️ Falló al aplicar.', label: '⚠️ Falló' };
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
