import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";

// Imports locales (dentro del mismo directorio — Deno los resuelve correctamente)
import { SYSTEM_PROMPT, TOOLS, MODEL_CONFIG } from "./config.ts";
import { getModelAdapter } from "./model-adapter.ts";
import { 
  executeConsultarDisponibilidad, 
  executeCalcularPrecio, 
  executeAgendarCita, 
  executeDerivarAKelly,
  executeCancelarCita,
  executeReprogramarCita
} from "./tools.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Diccionario de ejecutores
const toolExecutors: Record<string, (args: any, ctx: any) => Promise<string>> = {
  consultar_disponibilidad: executeConsultarDisponibilidad,
  calcular_precio: (args: any, _ctx: any) => executeCalcularPrecio(args),
  agendar_cita: executeAgendarCita,
  derivar_a_kelly: executeDerivarAKelly,
  cancelar_cita: executeCancelarCita,
  reprogramar_cita: executeReprogramarCita,
};

async function sendWhatsAppResponse(to: string, text: string) {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");
  
  if (!apiKey || !from) {
    console.error("Faltan credenciales de YCloud en el entorno");
    return;
  }

  try {
    await fetch("https://api.ycloud.com/v2/whatsapp/messages/send", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: from,
        to: to,
        type: "text",
        text: { body: text }
      })
    });
  } catch (err) {
    console.error("Error enviando mensaje por YCloud:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { senderNumber, text } = body;
    
    if (!senderNumber || !text) {
      return new Response("Bad Request: missing senderNumber or text", { status: 400 });
    }

    console.log(`[Agent-Runner] Iniciando procesamiento para ${senderNumber}`);

    // 1. Obtener/Crear conversación activa
    let { data: conv } = await supabase
      .from('conversaciones')
      .select('*')
      .eq('telefono_contacto', senderNumber)
      .eq('estado', 'activa')
      .single();

    if (!conv) {
      const { data: newConv, error } = await supabase
        .from('conversaciones')
        .insert({
          telefono_contacto: senderNumber,
          canal: 'whatsapp',
          estado: 'activa',
          mensajes_raw: []
        })
        .select()
        .single();
      
      if (error) throw error;
      conv = newConv;
    }

    // Si la conversación está en modo handoff, la IA no debe responder.
    if (conv.handoff_activo) {
      console.log(`[Agent-Runner] Handoff activo para ${senderNumber}. Ignorando.`);
      return new Response(JSON.stringify({ status: "ignored_handoff" }), { status: 200, headers: corsHeaders });
    }

    // 2. Cargar historial y armar el nuevo mensaje del usuario
    let history: any[] = Array.isArray(conv.mensajes_raw) ? conv.mensajes_raw : [];
    
    // Inyectamos contexto temporal y de memoria condensada (si existe) para el modelo
    const nowGuayaquil = new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" });
    const memoryContext = conv.historial_resumido ? `\n\n[MEMORIA ANTIGUA DEL PACIENTE RESUMIDA]:\n${conv.historial_resumido}` : "";
    
    const userMessage = { 
      role: 'user', 
      content: `[CONTEXTO SISTEMA: Hora actual: ${nowGuayaquil}]${memoryContext}\n\n[MENSAJE DEL USUARIO]:\n${text}` 
    };
    
    history.push(userMessage);

    // 3. Preparar el Adaptador de Modelo (lee directamente de Deno.env)
    const adapter = await getModelAdapter();

    // 4. Iniciar el Loop Agéntico (máximo 5 iteraciones de herramientas para evitar loops infinitos)
    let agentFinished = false;
    let iteration = 0;
    const MAX_ITERATIONS = 5;

    while (!agentFinished && iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`[Agent-Runner] Iteración ${iteration}...`);

      const isConfirmation = history.length > 0 && history[history.length - 1].role === 'tool';
      const maxTokensToUse = isConfirmation 
        ? (MODEL_CONFIG.max_tokens_confirmation || 100) 
        : (MODEL_CONFIG.max_tokens_normal || 300);

      const { text: llmText, toolCalls } = await adapter.chat({
        systemPrompt: SYSTEM_PROMPT, 
        messages: history, 
        tools: TOOLS, 
        maxTokens: maxTokensToUse
      });

      // Si hay texto dirigido al usuario, lo guardamos y lo enviamos a WA
      if (llmText) {
        history.push({ role: 'assistant', content: llmText });
        await sendWhatsAppResponse(senderNumber, llmText);
        agentFinished = true;
      }

      // Si el modelo decidió usar herramientas (Tool Calling)
      if (toolCalls && toolCalls.length > 0) {
        agentFinished = false; // El agente necesita ver los resultados de la herramienta
        
        // Guardar la intención de usar herramienta en el historial (necesario para la API)
        history.push({ role: 'assistant', content: '', tool_calls: toolCalls });

        for (const tool of toolCalls) {
          console.log(`[Agent-Runner] Ejecutando tool: ${tool.name}`, tool.input);
          let toolResultStr = "";
          
          if (toolExecutors[tool.name]) {
             const context = { 
               senderNumber, 
               conversacion_id: conv.id, 
               paciente_id: conv.paciente_id 
             };
             toolResultStr = await toolExecutors[tool.name](tool.input, context);
          } else {
             toolResultStr = JSON.stringify({ error: `Tool ${tool.name} no está implementada.` });
          }

          // Guardar resultado en formato compatible con las 3 APIs
          history.push({ 
            role: 'tool',
            name: tool.name,
            tool_call_id: tool.id,
            tool_use_id: tool.id,
            content: toolResultStr 
          });
        }
      } else if (!llmText) {
        // Si no hay tools ni texto, terminamos igualmente
        agentFinished = true;
      }
    }

    // 5. Guardar Memoria a Corto Plazo (y condensar si es necesario)
    const threshold = MODEL_CONFIG.history_condensation_threshold || 6;
    if (history.length >= threshold) {
      console.log(`[Agent-Runner] Límite de memoria alcanzado (${history.length}). Condensando...`);
      
      const summaryPrompt = "Eres un analista de datos. Resume esta conversación entre el usuario y la clínica en un párrafo breve. Conserva el perfil de usuario (nombre/síntomas/necesidad) y en qué parte del flujo se quedaron (ej. buscando fechas, yendo a pagar). Omite saludos triviales.";
      
      const sumResponse = await adapter.chat({
        systemPrompt: summaryPrompt, 
        messages: history.filter((h: any) => h.role === 'user' || h.role === 'assistant'), 
        tools: [], 
        maxTokens: 250
      });
      const newSummary = sumResponse.text;
      
      await supabase
        .from('conversaciones')
        .update({
          mensajes_raw: [],
          historial_resumido: newSummary,
          ultima_actividad: new Date().toISOString(),
          reactivacion_enviada: false
        })
        .eq('id', conv.id);

    } else {
      await supabase
        .from('conversaciones')
        .update({
          mensajes_raw: history,
          ultima_actividad: new Date().toISOString(),
          reactivacion_enviada: false
        })
        .eq('id', conv.id);
    }

    return new Response(JSON.stringify({ status: "success", historyLength: history.length }), { headers: corsHeaders, status: 200 });

  } catch (err: any) {
    console.error("Error crítico en Agent-Runner:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
