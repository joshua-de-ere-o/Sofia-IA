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

/**
 * Recorta el historial a la cola más reciente para conservar contexto
 * inmediato tras condensar. Empieza siempre en un mensaje 'user' para no
 * dejar un 'tool' result huérfano ni romper la regla de Anthropic de que
 * el primer mensaje debe ser del usuario. Devuelve turnos completos.
 */
function tailWindow(history: any[], target = 8): any[] {
  if (history.length <= target) return history;
  let start = history.length - target;
  // Retroceder hasta el inicio de turno (mensaje 'user').
  while (start > 0 && history[start].role !== "user") start--;
  // Salvaguarda: si no encontró 'user' hacia atrás, avanzar hasta el primero.
  while (start < history.length && history[start].role !== "user") start++;
  return history.slice(start);
}

/**
 * Lee `datos_bancarios` de la tabla `configuracion`, con cache de 60s para
 * no hacer una query a Postgres por turno. Si el CRM actualiza los datos,
 * tarda hasta 60s en propagar — aceptable.
 *
 * Devuelve null si no hay datos cargados; en ese caso NO se inyecta el
 * bloque al contexto (el agente sigue funcionando, solo no podrá compartir
 * datos bancarios — graceful degradation).
 */
let _cachedDatosBancarios: any = null;
let _cachedDatosBancariosAt = 0;
const DATOS_BANCARIOS_CACHE_MS = 60_000;

async function getDatosBancarios(supabase: any): Promise<any | null> {
  if (_cachedDatosBancarios !== null && Date.now() - _cachedDatosBancariosAt < DATOS_BANCARIOS_CACHE_MS) {
    return _cachedDatosBancarios;
  }
  try {
    const { data } = await supabase
      .from("configuracion")
      .select("datos_bancarios")
      .eq("id", 1)
      .single();
    _cachedDatosBancarios = data?.datos_bancarios ?? null;
    _cachedDatosBancariosAt = Date.now();
    return _cachedDatosBancarios;
  } catch (err) {
    console.warn("[Agent-Runner] No se pudieron leer datos_bancarios:", err);
    return null;
  }
}

function formatDatosBancariosForLLM(db: any): string {
  if (!db || typeof db !== "object") return "";
  const lines: string[] = [];
  if (db.banco) lines.push(`Banco: ${String(db.banco).trim()}`);
  if (db.tipo_cuenta) lines.push(`Tipo de cuenta: ${db.tipo_cuenta}`);
  if (db.numero) lines.push(`Número de cuenta: ${db.numero}`);
  if (db.titular) lines.push(`Titular: ${db.titular}`);
  if (db.cedula) lines.push(`Cédula del titular: ${db.cedula}`);
  if (lines.length === 0) return "";
  return `\n\n[DATOS BANCARIOS PARA TRANSFERENCIAS — usá EXACTAMENTE estos cuando el paciente deba pagar adelanto]:\n${lines.join("\n")}`;
}

async function sendWhatsAppResponse(to: string, text: string) {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");
  
  if (!apiKey || !from) {
    console.error("Faltan credenciales de YCloud en el entorno");
    return;
  }

  try {
    await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
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

  let debugSenderNumber: string | null = null;
  let debugSupabase: any = null;
  let debugIteration = 0;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);
    debugSupabase = supabase;

    const body = await req.json();
    const { senderNumber, text } = body;
    debugSenderNumber = senderNumber;
    
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

    // 1b. Detectar paciente existente por teléfono (no por conversación).
    // Esto le dice al LLM si tiene que tratar al usuario como nuevo o retornante.
    const { data: pacienteExistente } = await supabase
      .from('pacientes')
      .select('id, nombre, fecha_nacimiento, email, zona')
      .eq('telefono', senderNumber)
      .maybeSingle();

    // Si el paciente existe y la conversación aún no está vinculada, vincularla.
    if (pacienteExistente && !conv.paciente_id) {
      await supabase
        .from('conversaciones')
        .update({ paciente_id: pacienteExistente.id })
        .eq('id', conv.id);
      conv.paciente_id = pacienteExistente.id;
    }

    // 2. Cargar historial y armar el nuevo mensaje del usuario
    let history: any[] = Array.isArray(conv.mensajes_raw) ? conv.mensajes_raw : [];

    // Inyectamos contexto temporal, identidad del paciente y memoria condensada (si existe).
    const nowGuayaquil = new Date().toLocaleString("es-EC", {
      timeZone: "America/Guayaquil",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    const pacienteCtx = pacienteExistente
      ? `\n\n[PACIENTE EXISTENTE]: nombre="${pacienteExistente.nombre}", fecha_nacimiento="${pacienteExistente.fecha_nacimiento ?? 'no registrada'}", zona_habitual="${pacienteExistente.zona ?? 'no registrada'}"`
      : `\n\n[PACIENTE NUEVO — no existe registro previo en el sistema]`;
    const memoryContext = conv.historial_resumido ? `\n\n[ESTADO PREVIO DE LA CONVERSACIÓN]:\n${conv.historial_resumido}` : "";

    const datosBancarios = await getDatosBancarios(supabase);
    const datosBancariosCtx = formatDatosBancariosForLLM(datosBancarios);

    const userMessage = {
      role: 'user',
      content: `[CONTEXTO SISTEMA: Hora actual: ${nowGuayaquil}]${pacienteCtx}${memoryContext}${datosBancariosCtx}\n\n[MENSAJE DEL USUARIO]:\n${text}`
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
      debugIteration = iteration;
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
      
      const summaryPrompt = `Eres un analista de datos de una clínica nutricional. Resume esta conversación en JSON ESTRICTO (sin prosa fuera del JSON) con las siguientes claves obligatorias (usa null si el dato no fue mencionado):
{
  "paciente_nombre": string|null,
  "paciente_es_existente": boolean,
  "modalidad_elegida": "presencial"|"virtual"|null,
  "zona_elegida": "sur"|"norte"|"valle"|"virtual"|"domicilio"|null,
  "plan_tentativo": string|null,
  "motivo_consulta": string|null,
  "fecha_hora_tentativa": string|null,
  "estado_flujo": "explorando"|"recolectando_datos"|"eligiendo_horario"|"pendiente_pago"|"agendada"|"derivada",
  "ultima_pregunta_pendiente": string|null,
  "notas_relevantes": string|null
}
No inventes datos. Si no estás seguro de un campo, usá null.`;
      
      const sumResponse = await adapter.chat({
        systemPrompt: summaryPrompt, 
        messages: history.filter((h: any) => h.role === 'user' || h.role === 'assistant'), 
        tools: [], 
        maxTokens: 250
      });
      const newSummary = sumResponse.text;
      
      // Conservamos los últimos turnos completos para que el LLM mantenga
      // contexto inmediato aunque ya exista un resumen.
      await supabase
        .from('conversaciones')
        .update({
          mensajes_raw: tailWindow(history),
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
    const errorDetails = `[${new Date().toISOString()}] iter=${debugIteration} ${err?.name}: ${err?.message}\n\nSTACK:\n${err?.stack}\n\nCAUSE: ${JSON.stringify(err?.cause)}`;
    console.error("[Agent-Runner] Error crítico:", errorDetails);
    try {
      if (debugSupabase && debugSenderNumber) {
        await debugSupabase.from("conversaciones")
          .update({ historial_resumido: `LAST_ERROR: ${errorDetails}` })
          .eq("telefono_contacto", debugSenderNumber)
          .eq("estado", "activa");
      }
    } catch (_) { /* no-op */ }
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
