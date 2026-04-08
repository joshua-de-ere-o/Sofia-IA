import { createClient } from "@supabase/supabase-js";

/**
 * lib/pre-filter.js
 * Filtro Pre-LLM de 3 capas.
 * Evita llamadas costosas a llamadas de IA para mensajes que no deben procesarse.
 */

// Utiliza cliente Server Role ya que el Webhook se ejecuta sin un "User" logueado
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function runPreFilter(senderNumber, textMessage) {
  const supabase = getServiceClient();

  // ─── Capa 1: Whitelist ─────────────────────────────────────────
  const { data: config, error } = await supabase
    .from('configuracion')
    .select('whitelist_activa, whitelist_numeros')
    .eq('id', 1)
    .single();

  if (error) {
    console.error("Error consultando configuración (Whitelist):", error);
    // En caso de error, preferimos dejar pasar a bloquear falsamente.
  } else if (config?.whitelist_activa) {
    // Si la whitelist está activa, el número debe estar en el array (ignorando el "+" y espacios)
    const normalizedSender = senderNumber.replace(/\D/g, '');
    const isAllowed = config.whitelist_numeros.some(num => num.replace(/\D/g, '') === normalizedSender);
    
    if (!isAllowed) {
      console.log(`[Filtro L1] Bloqueo por Whitelist: ${senderNumber} detectado.`);
      return { 
        shouldPass: false, 
        reason: 'whitelist',
        quickReply: null // Silencioso
      };
    }
  }

  // Si no hay texto (ej. envió un location, un sticker) lo paramos con mensaje de disculpa.
  if (!textMessage) {
    return {
      shouldPass: false,
      reason: 'formato_no_soportado',
      quickReply: "Lo siento, por el momento solo puedo leer mensajes de texto, audios o fotos de comprobantes. Escríbeme por favor lo que necesitas. 👇"
    };
  }

  // ─── Capa 2: Keywords / Detección Temprana ─────────────────────
  // Normalizar el texto para una coincidencia rápida
  const normalizedText = textMessage.toLowerCase().trim();
  
  // Lista de insultos muy agresivos o spam conocido (podemos dejar respuesta en blanco para silencio)
  const spamList = ['casino', 'inversiones', 'crypto', 'cripto', 'bitcoin', 'gana dinero'];
  if (spamList.some(spam => normalizedText.includes(spam))) {
     console.log(`[Filtro L2] Bloqueo por SPAM: ${normalizedText}`);
     return {
        shouldPass: false,
        reason: 'spam_detectado',
        quickReply: null // Silencioso
     };
  }

  // ─── Capa 3: Fast-routing (Atajos) ──────────────────────────────
  // Casos de atención extremadamente corta y clara donde no hay flujo, ej: un comando interno.
  // Nota: En la Fase 5 priorizamos pasar todo lo nuticional al agente IA para el ciclo natural,
  // pero la estructura queda aquí para casos super-específicos.
  if (normalizedText === '/listo') {
    // Es posible que haya sido enviado por accidente desde WA? 
    // Usualmente '/listo' es de Telegram, pero lo consideramos un comando de reinicio local.
    return {
      shouldPass: false,
      reason: 'comando_reinicio',
      intent: 'reinicio'
    };
  }

  // El filtro autoriza continuar hacia el Loop del Agente AI
  return {
    shouldPass: true,
    reason: 'ok'
  };
}
