import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function nowGuayaquil(): Date {
  return new Date();
}

/** Parts de fecha/hora locales Guayaquil para comparar contra citas.fecha/hora. */
function toGuayaquilParts(d: Date): {
  fecha: string;
  hora: string;
  hour: number;
  minute: number;
  weekday: string;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    fecha: `${get("year")}-${get("month")}-${get("day")}`,
    hora: `${get("hour")}:${get("minute")}:${get("second")}`,
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    weekday: get("weekday"),
  };
}

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

async function sendTelegram(text: string, parseMode: "HTML" | "plain" = "HTML"): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("[Recordatorios] Faltan credenciales de Telegram");
    return;
  }
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (parseMode === "HTML") body.parse_mode = "HTML";
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[Recordatorios] Error enviando Telegram:", err);
  }
}

// ──────────────────────────────────────────────
// Anthropic Batch API (para los jobs horarios)
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

async function generarTextosBatch(requests: BatchRequest[]): Promise<TextoBatch[]> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY no configurada");

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
// Jobs horarios (sólo corren en minuto :00)
// ──────────────────────────────────────────────

const MODEL = "claude-haiku-4-5-20251001";
const SYSTEM_RECORDATORIO = `Eres Sofía, la asistente virtual de la Dra. Kely León, nutricionista clínica y deportiva en Quito, Ecuador.
Redacta UN SOLO mensaje de WhatsApp en español (Ecuador), cálido y profesional.
No uses asteriscos ni emojis excesivos. Máximo 3 líneas.`;

/** Recordatorios 24h y 2h antes de la cita — idéntico a versión previa. */
async function procesarRecordatoriosCitas(supabase: ReturnType<typeof createClient>): Promise<void> {
  const now = nowGuayaquil();

  const desde24h = new Date(now.getTime() + 23 * 60 * 60 * 1000 + 50 * 60 * 1000);
  const hasta24h = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 10 * 60 * 1000);
  const desde2h = new Date(now.getTime() + 1 * 60 * 60 * 1000 + 50 * 60 * 1000);
  const hasta2h = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

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

/** No-show: cita confirmada vencida (+15 min de gracia). */
async function procesarNoShows(supabase: ReturnType<typeof createClient>): Promise<void> {
  const ahora = nowGuayaquil();
  const limiteGracia = new Date(ahora.getTime() - 15 * 60 * 1000);
  const { fecha: fechaLimite, hora: horaLimite } = toGuayaquilParts(limiteGracia);

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

    await supabase
      .from("citas")
      .update({ estado: "no_show" })
      .eq("id", cita.id);

    const msg = `⚠️ <b>No-Show registrado</b>

Paciente: <b>${paciente.nombre}</b>
Tel: ${paciente.telefono}
Cita: ${cita.fecha} a las ${cita.hora}
Servicio: ${cita.servicio}
Modalidad: ${cita.modalidad}

La cita ha sido marcada como <b>no_show</b> automáticamente.`;

    await sendTelegram(msg);
    console.log(`[NoShow] Reportado a Kely: paciente ${paciente.nombre}`);
  }
}

// ──────────────────────────────────────────────
// Jobs cada 10 min (tareas personales + resumen matutino)
// ──────────────────────────────────────────────

/** Envía recordatorios por Telegram para tareas con fecha_hora ≤ ahora + 10 min. */
async function procesarTareas(supabase: ReturnType<typeof createClient>): Promise<void> {
  const now = nowGuayaquil();
  const en10min = new Date(now.getTime() + 10 * 60 * 1000);

  const { data: tareas, error } = await supabase
    .from("tareas")
    .select("id, descripcion, fecha_hora")
    .eq("enviado", false)
    .lte("fecha_hora", en10min.toISOString())
    .order("fecha_hora", { ascending: true });

  if (error) {
    console.error("[Tareas] Error consultando tareas:", error);
    return;
  }
  if (!tareas || tareas.length === 0) {
    console.log("[Tareas] Sin tareas pendientes.");
    return;
  }

  for (const tarea of tareas) {
    const horaLocal = new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(tarea.fecha_hora));

    const msg = `⏰ <b>Recordatorio</b>

${tarea.descripcion}

Hora: ${horaLocal}`;

    await sendTelegram(msg);

    await supabase
      .from("tareas")
      .update({ enviado: true })
      .eq("id", tarea.id);

    console.log(`[Tareas] Recordatorio enviado: ${tarea.descripcion}`);
  }
}

/** Resumen matutino 07:30 Quito: citas del día + tareas pendientes del día. Sin IA. */
async function procesarResumenMatutino(supabase: ReturnType<typeof createClient>): Promise<void> {
  const now = nowGuayaquil();
  const { fecha: hoyQuito, hour, minute, weekday } = toGuayaquilParts(now);

  // Ventana de disparo: 07:30 a 07:39 hora Quito. Con cron */10 aterriza una sola vez en 07:30.
  const enVentana = hour === 7 && minute >= 30 && minute <= 39;
  if (!enVentana) return;

  // Dedup: ya se envió hoy?
  const { data: cfg } = await supabase
    .from("configuracion")
    .select("id, last_summary_date")
    .eq("id", 1)
    .limit(1)
    .single();

  if (cfg?.last_summary_date === hoyQuito) {
    console.log("[Resumen] Ya se envió el resumen de hoy.");
    return;
  }

  // Citas del día (confirmadas + pendientes de pago)
  const { data: citas } = await supabase
    .from("citas")
    .select(`
      hora, servicio, modalidad, estado,
      pacientes!inner(nombre)
    `)
    .eq("fecha", hoyQuito)
    .in("estado", ["confirmada", "pendiente_pago"])
    .order("hora", { ascending: true });

  // Tareas pendientes del día (no enviadas cuya fecha_hora cae dentro del día Quito)
  const startQuitoUTC = new Date(`${hoyQuito}T00:00:00-05:00`);
  const endQuitoUTC = new Date(startQuitoUTC.getTime() + 24 * 60 * 60 * 1000);
  const { data: tareas } = await supabase
    .from("tareas")
    .select("descripcion, fecha_hora")
    .eq("enviado", false)
    .gte("fecha_hora", startQuitoUTC.toISOString())
    .lt("fecha_hora", endQuitoUTC.toISOString())
    .order("fecha_hora", { ascending: true });

  const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const lines: string[] = [];
  lines.push(`🌅 <b>Buenos días, Kely</b>`);
  lines.push(`${weekdayCap}, ${hoyQuito}`);
  lines.push("");

  lines.push("📅 <b>Citas de hoy</b>");
  if (!citas || citas.length === 0) {
    lines.push("• Sin citas agendadas.");
  } else {
    for (const c of citas as any[]) {
      const hora = (c.hora || "").slice(0, 5);
      const marca = c.estado === "pendiente_pago" ? " (pendiente pago)" : "";
      lines.push(`• ${hora} — ${c.pacientes.nombre} · ${c.servicio}${marca}`);
    }
  }

  lines.push("");
  lines.push("✅ <b>Tareas del día</b>");
  if (!tareas || tareas.length === 0) {
    lines.push("• Sin tareas pendientes.");
  } else {
    for (const t of tareas) {
      const hora = new Intl.DateTimeFormat("es-EC", {
        timeZone: "America/Guayaquil",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(new Date(t.fecha_hora));
      lines.push(`• ${hora} — ${t.descripcion}`);
    }
  }

  await sendTelegram(lines.join("\n"));

  // Marcar como enviado
  await supabase
    .from("configuracion")
    .update({ last_summary_date: hoyQuito })
    .eq("id", 1);

  console.log(`[Resumen] Enviado a Kely para ${hoyQuito}`);
}

// ──────────────────────────────────────────────
// Entry Point
// ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
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

    // El cron ahora corre cada 10 min. Los jobs que consumen Anthropic Batch API
    // (recordatorios 24h/2h + no-shows) se gatean a minuto :00 para mantener el
    // costo igual al esquema horario anterior. Tareas y resumen corren siempre.
    const { minute } = toGuayaquilParts(nowGuayaquil());
    const esTopDeHora = minute === 0;

    console.log(`[Recordatorios] Tick — minuto Quito ${minute}, topDeHora=${esTopDeHora}`);

    const jobs: Promise<void>[] = [
      procesarTareas(supabase),
      procesarResumenMatutino(supabase),
    ];
    if (esTopDeHora) {
      jobs.push(procesarRecordatoriosCitas(supabase));
      jobs.push(procesarNoShows(supabase));
    }

    await Promise.all(jobs);

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
