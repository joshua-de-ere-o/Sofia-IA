import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
        
        // Editar el mensaje original para indicar que ya se retomó la atención
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
  const text = message.text || '';
  
  if (text.trim() === '/listo') {
    const { data: convs } = await supabase
      .from('conversaciones')
      .select('id')
      .eq('handoff_activo', true)
      .order('ultima_actividad', { ascending: false })
      .limit(1);

    if (convs && convs.length > 0) {
      await resolveHandoff(convs[0].id);
      
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      if (token && chatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '✅ Modo IA retomado para el paciente más reciente en handoff.'
          })
        });
      }
    } else {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: 'ℹ️ No hay pacientes en modo handoff activo en este momento.'
              })
            });
        }
    }
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
