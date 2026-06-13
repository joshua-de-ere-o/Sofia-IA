import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";
import { collectPendingAppointmentReminders } from "./reminder-selection.ts";

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

/** Envía un template aprobado de WhatsApp vía YCloud. Devuelve true si OK. */
async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  variables: string[],
): Promise<boolean> {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");
  if (!apiKey || !from) {
    console.error("[Recordatorios] Faltan credenciales de YCloud");
    return false;
  }
  try {
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es_EC" },
          components: [
            {
              type: "body",
              parameters: variables.map((v) => ({ type: "text", text: v })),
            },
          ],
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Recordatorios] YCloud error para ${to} (${templateName}):`, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Recordatorios] Error de red enviando a ${to}:`, err);
    return false;
  }
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-05-29" → "viernes 29 de mayo". */
function formatFechaEspanol(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return `${DIAS_SEMANA[dt.getUTCDay()]} ${d} de ${MESES[dt.getUTCMonth()]}`;
}

/** "10:30:00" → "10:30". */
function formatHora(hora: string): string {
  return (hora || "").slice(0, 5);
}

const ZONA_LABEL: Record<string, string> = {
  sur: "Sur",
  norte: "Norte",
  santo_domingo: "Santo Domingo",
};

/** Modalidad + zona → string legible para el template. */
function formatModalidad(modalidad: string, zona: string | null): string {
  if (modalidad === "virtual") return "virtual por videollamada";
  if (modalidad === "presencial") {
    const label = zona ? ZONA_LABEL[zona] : null;
    return label ? `presencial en consultorio ${label}` : "presencial en consultorio";
  }
  if (zona === "domicilio") return "a domicilio";
  return modalidad;
}

async function sendTelegram(
  text: string,
  parseMode: "HTML" | "plain" = "HTML",
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("[Recordatorios] Faltan credenciales de Telegram");
    return;
  }
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (parseMode === "HTML") body.parse_mode = "HTML";
    if (replyMarkup) body.reply_markup = replyMarkup;
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
// Jobs horarios (sólo corren en minuto :00)
// ──────────────────────────────────────────────

/**
 * Recordatorios 24h y 2h antes de la cita mediante templates aprobados por
 * Meta en YCloud:
 *   - recordatorio_cita_24h: {{1}} nombre, {{2}} fecha legible, {{3}} hora, {{4}} modalidad
 *     Botones: Confirmar asistencia / Reagendar cita / Cancelar cita
 *   - recordatorio_cita_2h:  {{1}} nombre, {{2}} hora, {{3}} modalidad
 *     Botones: Confirmar asistencia / No podré asistir
 */
async function procesarRecordatoriosCitas(supabase: ReturnType<typeof createClient>): Promise<void> {
  const now = nowGuayaquil();

  const { data: citas, error } = await supabase
    .from("citas")
    .select(`
      id, fecha, hora, modalidad, zona, servicio, estado,
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

  const reminders = collectPendingAppointmentReminders(citas as any[], now);
  if (reminders.length === 0) {
    console.log("[Recordatorios] Sin recordatorios de cita pendientes para esta hora.");
    return;
  }

  for (const reminder of reminders) {
    const hora = formatHora(reminder.hora);
    const modalidad = formatModalidad(reminder.modalidad, reminder.zona);
    const templateName = reminder.reminderType === "24h"
      ? "recordatorio_cita_24h"
      : "recordatorio_cita_2h";
    const variables = reminder.reminderType === "24h"
      ? [reminder.nombre, formatFechaEspanol(reminder.fecha), hora, modalidad]
      : [reminder.nombre, hora, modalidad];

    const ok = await sendWhatsAppTemplate(reminder.phone, templateName, variables);
    if (ok) {
      const column = reminder.reminderType === "24h" ? "reminder_24h_sent" : "reminder_2h_sent";
      await supabase.from("citas").update({ [column]: true }).eq("id", reminder.citaId);
      console.log(`[Recordatorios] ${reminder.reminderType} enviado a ${reminder.phone} (cita ${reminder.citaId})`);
    }
  }
}

/**
 * Confirmación de asistencia: cita confirmada vencida (+15 min de gracia).
 *
 * No marca `no_show` automáticamente. Pregunta a Kely por Telegram con
 * botones inline. La cita queda en `confirmada` hasta que Kely responda;
 * el webhook de Telegram (app/api/telegram/route.js) procesa el callback
 * y actualiza el estado a `completada` o `no_show`.
 *
 * `attendance_check_sent` evita preguntar dos veces por la misma cita.
 */
async function procesarConfirmacionAsistencia(
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  const ahora = nowGuayaquil();
  const limiteGracia = new Date(ahora.getTime() - 15 * 60 * 1000);
  const { fecha: fechaLimite, hora: horaLimite } = toGuayaquilParts(limiteGracia);

  const { data: pendientes, error } = await supabase
    .from("citas")
    .select(`
      id, fecha, hora, servicio, modalidad,
      pacientes!inner(nombre, telefono)
    `)
    .eq("estado", "confirmada")
    .eq("attendance_check_sent", false)
    .or(`fecha.lt.${fechaLimite},and(fecha.eq.${fechaLimite},hora.lt.${horaLimite})`);

  if (error) {
    console.error("[Asistencia] Error consultando citas:", error);
    return;
  }
  if (!pendientes || pendientes.length === 0) {
    console.log("[Asistencia] Sin confirmaciones pendientes.");
    return;
  }

  for (const cita of pendientes) {
    const paciente = (cita as any).pacientes;
    const hora = (cita.hora || "").slice(0, 5);

    const msg = `🕒 <b>¿Vino ${paciente.nombre}?</b>

Cita: ${cita.fecha} a las ${hora}
Servicio: ${cita.servicio}
Modalidad: ${cita.modalidad}
Tel: ${paciente.telefono}

Confirma para registrar la asistencia.`;

    const replyMarkup = {
      inline_keyboard: [[
        { text: "✅ Sí, vino", callback_data: `attendance_yes_${cita.id}` },
        { text: "❌ No vino", callback_data: `attendance_no_${cita.id}` },
      ]],
    };

    await sendTelegram(msg, "HTML", replyMarkup);

    // Marcar como preguntada — aunque Telegram falle, no insistimos cada 10 min.
    await supabase
      .from("citas")
      .update({ attendance_check_sent: true })
      .eq("id", cita.id);

    console.log(`[Asistencia] Pregunta enviada a Kely: paciente ${paciente.nombre}`);
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

  // Agenda del día via funcion SQL compartida (citas de pacientes + bloqueos de Kely).
  // Misma fuente de verdad que la tool consultar_agenda del modo-Kelly por Telegram.
  const { data: agenda, error: agendaErr } = await supabase
    .rpc("obtener_agenda_del_dia", { p_fecha: hoyQuito });

  if (agendaErr) {
    console.error("[Resumen] Error en obtener_agenda_del_dia:", agendaErr);
  }

  const citas = (agenda ?? []).filter((row: any) => !row.es_bloqueo);
  const bloqueos = (agenda ?? []).filter((row: any) => row.es_bloqueo);

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
  if (citas.length === 0) {
    lines.push("• Sin citas agendadas.");
  } else {
    for (const c of citas) {
      const hora = (c.hora || "").slice(0, 5);
      const marca = c.estado === "pendiente_pago" ? " (pendiente pago)" : "";
      lines.push(`• ${hora} — ${c.paciente_nombre} · ${c.servicio}${marca}`);
    }
  }

  if (bloqueos.length > 0) {
    lines.push("");
    lines.push("📌 <b>Bloqueos / reuniones</b>");
    for (const b of bloqueos) {
      const hora = (b.hora || "").slice(0, 5);
      const motivo = b.motivo_bloqueo || "Bloqueo de agenda";
      lines.push(`• ${hora} — ${motivo}`);
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
  const expectedSecret = Deno.env.get("CRON_SECRET") ?? "kelly-cron-secret-2026";

  const isValidCron = cronSecret === expectedSecret;
  const isValidJwt = authHeader.startsWith("Bearer ");
  if (!isValidCron && !isValidJwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // El cron corre cada 10 min. Todos los jobs corren en cada tick:
    //  - Recordatorios 24h/2h: usan templates aprobados (no consumen Anthropic),
    //    y la ventana fina de selección en reminder-selection.ts asegura que
    //    cada cita reciba el recordatorio exactamente una vez. Hace falta correr
    //    cada 10min para cubrir citas en HH:00, HH:10, HH:20, HH:30, etc.
    //  - Confirmación de asistencia: delay máximo respecto a hora de cita + 15min
    //    de gracia ≈ 10min, aceptable para Kely.
    //  - Tareas y resumen matutino: idem.
    const { minute } = toGuayaquilParts(nowGuayaquil());
    console.log(`[Recordatorios] Tick — minuto Quito ${minute}`);

    await Promise.all([
      procesarTareas(supabase),
      procesarResumenMatutino(supabase),
      procesarConfirmacionAsistencia(supabase),
      procesarRecordatoriosCitas(supabase),
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
