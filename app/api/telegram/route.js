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

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;

  if (data && data.startsWith('handoff_done_')) {
    const conversacionId = data.replace('handoff_done_', '');

    if (conversacionId && conversacionId !== 'none') {
      await resolveHandoff(conversacionId);

      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token && callbackQuery.id) {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: '✅ Modo IA retomado para este paciente.'
          })
        });

        if (callbackQuery.message && callbackQuery.message.message_id) {
            await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: callbackQuery.message.chat.id,
                    message_id: callbackQuery.message.message_id,
                    reply_markup: { inline_keyboard: [[ { text: "✅ Atención Retomada", callback_data: "none" } ]] }
                })
            });
        }
      }
    }
  }
}

async function handleMessage(message) {
  const text = (message.text || '').trim();
  const chatId = message.chat?.id;
  const expectedChatId = process.env.TELEGRAM_CHAT_ID;

  // Guard: sólo procesar mensajes del chat directo de Kely.
  if (!chatId || !expectedChatId || String(chatId) !== String(expectedChatId)) {
    return;
  }

  if (!text) return;

  if (text === '/listo') {
    await handleListoCommand();
    return;
  }

  // Cualquier otro mensaje de Kely se trata como posible tarea.
  await handleTaskMessage(text);
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

// ─── Parseo de tareas ─────────────────────────────────────────────────────────

/** Devuelve la fecha/hora actual en Guayaquil en formato legible para el LLM. */
function guayaquilContext() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return fmt.format(now);
}

const TASK_SYSTEM_PROMPT = `Eres un parser de tareas para la agenda personal de la Dra. Kely en Quito, Ecuador (zona horaria America/Guayaquil, UTC-5).

Extrae una única tarea/recordatorio del mensaje. Responde SOLO con un objeto JSON, sin markdown, sin texto extra.

Formato del JSON:
{
  "descripcion": "texto corto en imperativo, ej 'Llamar a pediatría'",
  "fecha_hora_iso": "cadena ISO 8601 con offset -05:00 (ej '2026-04-20T14:00:00-05:00'), o null",
  "necesita_aclaracion": true|false,
  "pregunta": "si necesita_aclaracion es true, pregunta corta en español; si no, cadena vacía"
}

Reglas:
- Si el mensaje NO contiene fecha Y hora concretas e interpretables, necesita_aclaracion=true y pregunta específica (ej "¿A qué hora el viernes?").
- Resuelve referencias relativas ("hoy", "mañana", "el viernes", "en 2 horas") usando la fecha/hora actual que te doy.
- Usa siempre offset -05:00 en fecha_hora_iso (no conviertas a UTC).
- Si la hora viene en formato 12h ("2pm"), conviértela a 24h ("14:00").`;

function extractJson(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  // Algunos providers (Gemini sobre todo) envuelven en ```json ... ```
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Último intento: extraer el primer objeto JSON visible
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

function formatFechaParaKely(isoString) {
  const d = new Date(isoString);
  const fecha = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    weekday: 'long', day: '2-digit', month: 'long',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return { fecha, hora };
}

async function handleTaskMessage(text) {
  let adapter;
  try {
    adapter = await getModelAdapter();
  } catch (err) {
    console.error('[Telegram/tareas] No se pudo inicializar adapter:', err?.message || err);
    await sendToKely('⚠️ No pude procesar tu mensaje (IA no configurada). Avisa a Joshua.');
    return;
  }

  const userText = `Fecha y hora actual en Quito: ${guayaquilContext()}.\n\nMensaje de Kely:\n"${text}"`;

  let raw;
  try {
    raw = await adapter.chat({
      systemPrompt: TASK_SYSTEM_PROMPT,
      userText,
      maxTokens: 300,
    });
  } catch (err) {
    console.error('[Telegram/tareas] Error al llamar al LLM:', err?.message || err);
    await sendToKely('⚠️ Tuve un problema procesando tu mensaje. Intenta de nuevo en un rato.');
    return;
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    console.error('[Telegram/tareas] Respuesta del LLM no parseable:', raw);
    await sendToKely('⚠️ No entendí el mensaje. ¿Puedes reformularlo con fecha y hora?');
    return;
  }

  if (parsed.necesita_aclaracion || !parsed.fecha_hora_iso) {
    const pregunta = parsed.pregunta || '¿Puedes decirme fecha y hora exactas?';
    await sendToKely(`🤔 ${pregunta}`);
    return;
  }

  const fechaHora = new Date(parsed.fecha_hora_iso);
  if (isNaN(fechaHora.getTime())) {
    await sendToKely('⚠️ No logré entender la fecha. ¿Puedes escribirla de otra manera?');
    return;
  }

  const descripcion = (parsed.descripcion || '').trim() || text;

  const { error: insertError } = await supabase
    .from('tareas')
    .insert({
      descripcion,
      fecha_hora: fechaHora.toISOString(),
    });

  if (insertError) {
    console.error('[Telegram/tareas] Error insertando tarea:', insertError);
    await sendToKely('⚠️ No pude guardar la tarea en la base de datos.');
    return;
  }

  const { fecha, hora } = formatFechaParaKely(parsed.fecha_hora_iso);
  await sendToKely(`✅ Listo, te recuerdo ${descripcion} el ${fecha} a las ${hora}.`);
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

async function resolveHandoff(conversacionId) {
  await supabase
    .from('conversaciones')
    .update({ handoff_activo: false })
    .eq('id', conversacionId);

  await supabase
    .from('handoffs')
    .update({ estado: 'resuelto', resolved_at: new Date().toISOString() })
    .eq('conversacion_id', conversacionId)
    .eq('estado', 'activo');
}
