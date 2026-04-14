import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function nowGuayaquil(): Date {
  // Devuelve el momento actual en UTC (Supabase maneja timestamptz correctamente)
  return new Date();
}

/** Formatea un Date como fecha/hora locales de Guayaquil (UTC-5) para comparar
 * contra las columnas citas.fecha (date) y citas.hora (time) que no llevan TZ. */
function toGuayaquilParts(d: Date): { fecha: string; hora: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    fecha: `${get("year")}-${get("month")}-${get("day")}`,
    hora: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/** Envía un mensaje de WhatsApp vía YCloud */
async function sendWhatsApp(to: string, text: string): Promise<void> {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");
  if (!apiKey || !from) {
    console.error("[Recordatorios] Faltan credenciales de YCloud");
    return;
  }
  try {
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/send", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Recordatorios] YCloud error para ${to}:`, err);
    }
  } catch (err) {
    console.error(`[Recordatorios] Error de red enviando a ${to}:`, err);
  }
}

/** Envía un mensaje a la Dra. Kelly por Telegram */
async function sendTelegram(text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("[Recordatorios] Faltan credenciales de Telegram");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[Recordatorios] Error enviando Telegram:", err);
  }
}

// ──────────────────────────────────────────────
// Anthropic Batch API  (50% descuento)
// ──────────────────────────────────────────────

interface BatchRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: string; content: string }[];
  };
}

interface TextoBatch {
  custom_id: string;
  text: string;
}

/** Genera textos personalizados para una lista de recordatorios usando la Batch API de Anthropic */
async function generarTextosBatch(requests: BatchRequest[]): Promise<TextoBatch[]> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada");

  // 1. Crear el batch
  const createRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Batch API error (create): ${err}`);
  }

  const batchData = await createRes.json();
  const batchId: string = batchData.id;
  console.log(`[Recordatorios] Batch creado: ${batchId}`);

  // 2. Polling hasta que el batch esté listo (max 60 intentos × 2s = 2 min)
  let attempts = 0;
  while (attempts < 60) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "message-batches-2024-09-24",
      },
    });
    const statusData = await statusRes.json();
    if (statusData.processing_status === "ended") {
      console.log(`[Recordatorios] Batch listo tras ${attempts + 1} intentos`);
      break;
    }
    attempts++;
  }

  // 3. Obtener resultados
  const resultsRes = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${batchId}/results`,
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "message-batches-2024-09-24",
      },
    }
  );

  if (!resultsRes.ok) {
    const err = await resultsRes.text();
    throw new Error(`Batch API error (results): ${err}`);
  }

  const resultsText = await resultsRes.text();
  // La respuesta es JSONL (una línea JSON por resultado)
  const textos: TextoBatch[] = [];
  for (const line of resultsText.split("\n").filter(Boolean)) {
    try {
      const item = JSON.parse(line);
      if (item.result?.type === "succeeded") {
        const content = item.result.message?.content?.[0]?.text ?? "";
        textos.push({ custom_id: item.custom_id, text: content });
      }
    } catch (_) {
      // línea mal formada, ignorar
    }
  }
  return textos;
}

// ──────────────────────────────────────────────
// Lógica de Recordatorios
// ──────────────────────────────────────────────

const MODEL = "claude-haiku-4-5-20251001";
const SYSTEM_RECORDATORIO = `Eres Sofía, la asistente virtual de la Dra. Kely León, nutricionista clínica y deportiva en Quito, Ecuador. 
Redacta UN SOLO mensaje de WhatsApp en español (Ecuador), cálido y profesional. 
No uses asteriscos ni emojis excesivos. Máximo 3 líneas.`;

/** Recordatorios 24h y 2h antes de la cita */
async function procesarRecordatoriosCitas(supabase: ReturnType<typeof createClient>): Promise<void> {
  const now = nowGuayaquil();

  // Ventana 24h: citas que empiezan entre 23h 50min y 24h 10min desde ahora
  const desde24h = new Date(now.getTime() + 23 * 60 * 60 * 1000 + 50 * 60 * 1000);
  const hasta24h = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 10 * 60 * 1000);

  // Ventana 2h
  const desde2h = new Date(now.getTime() + 1 * 60 * 60 * 1000 + 50 * 60 * 1000);
  const hasta2h = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

  // Query: citas confirmadas que no hayan recibido sus recordatorios
  const { data: citas, error } = await supabase
    .from("citas")
    .select(`
      id, fecha, hora, modalidad, servicio,
      reminder_24h_sent, reminder_2h_sent,
      pacientes!inner(nombre, telefono)
    `)
    .eq("estado", "confirmada");

  if (error) {
    console.error("[Recordatorios] Error al consultar citas:", error);
    return;
  }

  if (!citas || citas.length === 0) {
    console.log("[Recordatorios] Sin citas confirmadas para recordar.");
    return;
  }

  const batchRequests: BatchRequest[] = [];

  for (const cita of citas) {
    const paciente = (cita as any).pacientes;
    if (!paciente?.telefono) continue;

    const fechaHoraCita = new Date(`${cita.fecha}T${cita.hora}`);

    // Comprobar si entra en ventana 24h
    if (!cita.reminder_24h_sent && fechaHoraCita >= desde24h && fechaHoraCita <= hasta24h) {
      batchRequests.push({
        custom_id: `24h_${cita.id}`,
        params: {
          model: MODEL,
          max_tokens: 150,
          system: SYSTEM_RECORDATORIO,
          messages: [
            {
              role: "user",
              content: `Redacta el recordatorio de 24 horas para ${paciente.nombre}. 
Fecha: ${cita.fecha}, Hora: ${cita.hora}, Modalidad: ${cita.modalidad}, Servicio: ${cita.servicio}.`,
            },
          ],
        },
      });
    }

    // Comprobar si entra en ventana 2h
    if (!cita.reminder_2h_sent && fechaHoraCita >= desde2h && fechaHoraCita <= hasta2h) {
      batchRequests.push({
        custom_id: `2h_${cita.id}`,
        params: {
          model: MODEL,
          max_tokens: 100,
          system: SYSTEM_RECORDATORIO,
          messages: [
            {
              role: "user",
              content: `Redacta el recordatorio de 2 horas para ${paciente.nombre}. 
Hora: ${cita.hora}, Modalidad: ${cita.modalidad}.`,
            },
          ],
        },
      });
    }
  }

  if (batchRequests.length === 0) {
    console.log("[Recordatorios] Sin recordatorios de cita pendientes para esta hora.");
    return;
  }

  console.log(`[Recordatorios] Procesando batch de ${batchRequests.length} recordatorios...`);

  let textos: TextoBatch[] = [];
  try {
    textos = await generarTextosBatch(batchRequests);
  } catch (err) {
    console.error("[Recordatorios] Error en Batch API:", err);
    return;
  }

  // Enviar mensajes y marcar en BD
  for (const { custom_id, text } of textos) {
    const [tipo, citaId] = custom_id.split("_");
    const cita = citas.find((c: any) => c.id === citaId);
    if (!cita) continue;

    const paciente = (cita as any).pacientes;
    await sendWhatsApp(paciente.telefono, text);
    console.log(`[Recordatorios] Enviado ${tipo} a ${paciente.telefono}`);

    const update: Record<string, boolean> = {};
    if (tipo === "24h") update.reminder_24h_sent = true;
    if (tipo === "2h") update.reminder_2h_sent = true;

    await supabase.from("citas").update(update).eq("id", citaId);
  }
}

/** Reactivación: pacientes sin actividad por 8 días */
async function procesarReactivaciones(supabase: ReturnType<typeof createClient>): Promise<void> {
  const hace8Dias = new Date(nowGuayaquil().getTime() - 8 * 24 * 60 * 60 * 1000);

  const { data: convs, error } = await supabase
    .from("conversaciones")
    .select(`
      id,
      ultima_actividad,
      reactivacion_enviada,
      pacientes!inner(nombre, telefono)
    `)
    .eq("reactivacion_enviada", false)
    .eq("estado", "activa")
    .lt("ultima_actividad", hace8Dias.toISOString());

  if (error) {
    console.error("[Recordatorios] Error al consultar reactivaciones:", error);
    return;
  }

  if (!convs || convs.length === 0) {
    console.log("[Recordatorios] Sin reactivaciones pendientes.");
    return;
  }

  const batchRequests: BatchRequest[] = convs.map((conv: any) => ({
    custom_id: `reactiv_${conv.id}`,
    params: {
      model: MODEL,
      max_tokens: 120,
      system: `Eres Sofía, asistente de la Dra. Kely León, nutricionista en Quito. 
Redacta UN mensaje de reactivación cálido, breve y sin presión para alguien que no ha escrito en más de una semana. 
Invita amablemente a retomar. Máximo 3 líneas. Sin asteriscos.`,
      messages: [
        {
          role: "user",
          content: `Redacta el mensaje de reactivación para ${conv.pacientes.nombre}.`,
        },
      ],
    },
  }));

  console.log(`[Reactivación] Procesando ${batchRequests.length} mensajes...`);

  let textos: TextoBatch[] = [];
  try {
    textos = await generarTextosBatch(batchRequests);
  } catch (err) {
    console.error("[Reactivación] Error en Batch API:", err);
    return;
  }

  for (const { custom_id, text } of textos) {
    const [, convId] = custom_id.split("_");
    const conv = convs.find((c: any) => c.id === convId);
    if (!conv) continue;

    await sendWhatsApp((conv as any).pacientes.telefono, text);
    await supabase
      .from("conversaciones")
      .update({ reactivacion_enviada: true })
      .eq("id", convId);

    console.log(`[Reactivación] Enviada a ${(conv as any).pacientes.telefono}`);
  }
}

/** No-show: cita confirmada que ya pasó (+15 min de gracia) y sigue como 'confirmada' */
async function procesarNoShows(supabase: ReturnType<typeof createClient>): Promise<void> {
  const ahora = nowGuayaquil();
  // 15 minutos de gracia
  const limiteGracia = new Date(ahora.getTime() - 15 * 60 * 1000);

  // citas.fecha/hora están en hora local de Guayaquil (UTC-5) sin TZ.
  // toISOString() daría UTC y desfasaría la comparación 5 horas.
  const { fecha: fechaLimite, hora: horaLimite } = toGuayaquilParts(limiteGracia);

  // Citas confirmadas cuya fecha+hora ya superó el límite de gracia
  const { data: noShows, error } = await supabase
    .from("citas")
    .select(`
      id, fecha, hora, servicio, modalidad,
      pacientes!inner(nombre, telefono)
    `)
    .eq("estado", "confirmada")
    .or(`fecha.lt.${fechaLimite},and(fecha.eq.${fechaLimite},hora.lt.${horaLimite})`);

  if (error) {
    console.error("[NoShow] Error consultando citas:", error);
    return;
  }

  if (!noShows || noShows.length === 0) {
    console.log("[NoShow] Sin no-shows para reportar.");
    return;
  }

  for (const cita of noShows) {
    const paciente = (cita as any).pacientes;

    // Marcar como no_show
    await supabase
      .from("citas")
      .update({ estado: "no_show" })
      .eq("id", cita.id);

    // Notificar a la Dra. Kelly por Telegram
    const msg = `⚠️ <b>No-Show registrado</b>

Paciente: <b>${paciente.nombre}</b>
Tel: ${paciente.telefono}
Cita: ${cita.fecha} a las ${cita.hora}
Servicio: ${cita.servicio}
Modalidad: ${cita.modalidad}

La cita ha sido marcada como <b>no_show</b> automáticamente.`;

    await sendTelegram(msg);
    console.log(`[NoShow] Reportado a Kelly: paciente ${paciente.nombre}`);
  }
}

// ──────────────────────────────────────────────
// Entry Point
// ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Autenticación: acepta x-cron-secret (para pg_cron) o Bearer JWT válido
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const expectedSecret = Deno.env.get("CRON_SECRET") ?? "kelly-cron-secret-2024";

  const isValidCron = cronSecret === expectedSecret;
  const isValidJwt = authHeader.startsWith("Bearer ");

  if (!isValidCron && !isValidJwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log("[Recordatorios] Iniciando ejecución cron...");

    // Ejecutar las 3 tareas en paralelo
    await Promise.all([
      procesarRecordatoriosCitas(supabase),
      procesarReactivaciones(supabase),
      procesarNoShows(supabase),
    ]);

    console.log("[Recordatorios] Ejecución completada.");
    return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("[Recordatorios] Error crítico:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
