import { createClient } from "jsr:@supabase/supabase-js";
import { getServicio, SERVICIO_IDS_TODOS, DERIVACION_TEMPLATES } from "./config.ts";
import { normalizeAmount, amountMatches } from "./amount.ts";
import { logPaymentEvent } from "./log.ts";
import { generateAvailability } from "../../../lib/availability/slot-generator.js";

/**
 * supabase/functions/agent-runner/tools.ts
 *
 * Implementación de las herramientas para el Agent Loop de Sofía.
 */

// Derived from lib/catalog/zonas.json — must stay in sync (T-05 parity test enforces this).
const ZONAS_VALIDAS = ["sur", "norte", "virtual", "valle", "domicilio", "santo_domingo"];

/**
 * Calcula precio y adelanto de forma 100% determinística (sin red, sin auth).
 * Antes era una Edge Function HTTP (calcular-precio); fallaba con 401 al ser
 * invocada desde dentro del agent-runner. Movida acá como función pura.
 */
export async function executeCalcularPrecio(args: any): Promise<string> {
  const { servicio_id, zona } = args;

  if (!servicio_id || !zona) {
    return JSON.stringify({ error: "Faltan parámetros: servicio_id o zona" });
  }

  const servicio = getServicio(servicio_id);
  if (!servicio) {
    return JSON.stringify({
      error: "SERVICIO_DESCONOCIDO",
      servicio_id,
      allowed: SERVICIO_IDS_TODOS,
    });
  }

  if (!ZONAS_VALIDAS.includes(zona)) {
    return JSON.stringify({
      error: "zona inválida",
      received: zona,
      allowed: ZONAS_VALIDAS,
    });
  }

  let precio_base = servicio.precio;
  let ajuste_zona = 0;
  let precio_total = precio_base;
  let requiere_adelanto = servicio.requiere_adelanto;
  let monto_adelanto = 0;

  if (zona === "domicilio") {
    // Flat fee for domicilio — overrides service price
    precio_base = 40;
    precio_total = 40;
    ajuste_zona = 0;
    requiere_adelanto = true;
  } else if (zona === "valle") {
    ajuste_zona = 5;
    precio_total += ajuste_zona;
  }

  if (zona === "sur") {
    requiere_adelanto = false;
    monto_adelanto = 0;
  } else if (zona === "domicilio") {
    monto_adelanto = 20; // 50% of 40
  } else {
    monto_adelanto = requiere_adelanto ? precio_total * 0.5 : 0;
  }

  return JSON.stringify({
    precio_base,
    ajuste_zona,
    precio_total,
    requiere_adelanto,
    monto_adelanto,
  });
}

function getSupabase() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Consulta la disponibilidad de agenda en Supabase.
 * Retorna las fechas y horas libres excluyendo domingos, feriados y slots ocupados.
 *
 * T-20: 3-way Promise.all for feriados + excepciones_horario + citas (R-AV-04, SC-11).
 * Slot generation delegated to generateAvailability (lib/availability/slot-generator.js).
 */
export async function executeConsultarDisponibilidad(args: any): Promise<string> {
  const { fecha_inicio, fecha_fin } = args;
  if (!fecha_inicio || !fecha_fin) {
    return JSON.stringify({ error: "Faltan parámetros: fecha_inicio o fecha_fin" });
  }

  try {
    const supabase = getSupabase();

    // T-20: Single parallel fetch for all three data sources (R-AV-04).
    // One query per source; zero extra queries inside the day-iteration loop.
    const [feriadosRes, excepcionesRes, citasRes] = await Promise.all([
      supabase
        .from('feriados')
        .select('fecha')
        .gte('fecha', fecha_inicio)
        .lte('fecha', fecha_fin),
      supabase
        .from('excepciones_horario')
        .select('*')
        .gte('fecha', fecha_inicio)
        .lte('fecha', fecha_fin),
      supabase
        .from('citas')
        .select('fecha, hora, estado')
        .gte('fecha', fecha_inicio)
        .lte('fecha', fecha_fin)
        .not('estado', 'in', '(cancelada,no_show,rechazada)'),
    ]);

    if (feriadosRes.error) throw feriadosRes.error;
    if (excepcionesRes.error) throw excepcionesRes.error;
    if (citasRes.error) throw citasRes.error;

    // T-20: Build in-memory indexes for O(1) per-day lookups (ADR-8).
    const feriadoSet = new Set<string>((feriadosRes.data ?? []).map((f: any) => f.fecha));

    // excepcionesMap: Map<'YYYY-MM-DD', excepcion row> (R-AV-04)
    const excepcionesMap = new Map<string, any>(
      (excepcionesRes.data ?? []).map((e: any) => [e.fecha, e])
    );

    const occupiedSet = new Set<string>();
    (citasRes.data ?? []).forEach((cita: any) => {
      // hora comes as 'HH:MM:SS' — normalise to 'HH:MM'
      const timeStr = cita.hora.substring(0, 5);
      occupiedSet.add(`${cita.fecha}_${timeStr}`);
    });

    const slotsLibres = generateAvailability({
      fechaInicio: fecha_inicio,
      fechaFin: fecha_fin,
      feriadosSet: feriadoSet,
      excepcionesMap,
      occupiedSet,
      timeZone: "America/Guayaquil",
    });

    return JSON.stringify(slotsLibres);
  } catch (err: any) {
    console.error("Error executing consultar_disponibilidad:", err);
    return JSON.stringify({ error: `Hubo un error al consultar disponibilidad: ${err.message}` });
  }
}

/**
 * Registra un paciente y le agenda una cita.
 * Si la zona es 'sur', la cita se confirma. Si no, queda en 'pendiente_pago'.
 */
export async function executeAgendarCita(args: any, context: any, supabaseOverride?: ReturnType<typeof getSupabase>): Promise<string> {
  const {
    paciente_nombre, paciente_fecha_nacimiento, paciente_email,
    servicio_id, fecha, hora, modalidad, zona, motivo, monto_adelanto, precio_total
  } = args;

  if (!paciente_nombre || !servicio_id || !fecha || !hora || !modalidad || !zona) {
    return JSON.stringify({ error: "Faltan parámetros requeridos para agendar la cita" });
  }

  if (typeof precio_total !== "number" || typeof monto_adelanto !== "number") {
    return JSON.stringify({ error: "Faltan precio_total o monto_adelanto calculados. Primero llama calcular_precio y usa sus valores exactos." });
  }

  // Guard: reject non-schedulable services before any DB operation
  const servicioGuard = getServicio(servicio_id);
  if (!servicioGuard) {
    return JSON.stringify({ error: "SERVICIO_DESCONOCIDO", servicio_id });
  }
  if (!servicioGuard.agendable) {
    return JSON.stringify({
      error: "NO_AGENDABLE",
      servicio_id,
      accion_requerida: "derivar_a_kelly",
      motivo_sugerido: servicioGuard.derivacion_motivo,
    });
  }

  try {
    const supabase = supabaseOverride ?? getSupabase();
    const { conversacion_id, senderNumber } = context ?? {};

    // Guard: senderNumber is server-owned identity — must always be present
    if (!senderNumber || typeof senderNumber !== "string" || senderNumber.trim() === "") {
      console.error("[agendar_cita] missing senderNumber in context", { conversacion_id });
      return JSON.stringify({ error: "Identidad del paciente no disponible en el contexto del chat." });
    }

    // Observability: warn if LLM still supplies paciente_telefono (schema-removal regression detector)
    if (args.paciente_telefono && args.paciente_telefono !== senderNumber) {
      console.warn("[agendar_cita] LLM supplied paciente_telefono differs from senderNumber", {
        llm_value_type: typeof args.paciente_telefono,
        sender_len: senderNumber.length,
        conversacion_id,
      });
    }

    // Normalizar hora a HH:MM:SS — el LLM puede enviar "9:00" o "09:00"
    const [hPart, mPart] = String(hora).split(':');
    const horaNorm = `${hPart.padStart(2, '0')}:${(mPart ?? '00').padStart(2, '0')}:00`;

    // 1. Verificar si el slot no fue ocupado en el último segundo
    const { data: slotCheck } = await supabase
      .from('citas')
      .select('id')
      .eq('fecha', fecha)
      .eq('hora', horaNorm)
      .not('estado', 'in', '(cancelada,no_show,rechazada)');

    if (slotCheck && slotCheck.length > 0) {
      return JSON.stringify({ 
        error: "El slot ya fue ocupado. Por favor, realiza otra consultar_disponibilidad y ofrécele al paciente otras opciones." 
      });
    }

    // 2. Buscar paciente o crearlo (el teléfono es único según esquema)
    // Usamos select + insert/update en lugar de upsert directo para mayor control
    let pacienteId;
    const { data: existingPatient } = await supabase
      .from('pacientes')
      .select('id')
      .eq('telefono', senderNumber)
      .single();

    if (existingPatient) {
      pacienteId = existingPatient.id;
      // No pisamos pacientes.zona: es la zona de residencia del paciente.
      // La zona particular de esta cita ya se guarda abajo en citas.zona.
      await supabase.from('pacientes').update({
        nombre: paciente_nombre,
        fecha_nacimiento: paciente_fecha_nacimiento || null,
        email: paciente_email || null
      }).eq('id', pacienteId);
    } else {
      const { data: newPatient, error: newError } = await supabase
        .from('pacientes')
        .insert({
          nombre: paciente_nombre,
          fecha_nacimiento: paciente_fecha_nacimiento || null,
          telefono: senderNumber,
          email: paciente_email || null,
          zona: zona
        })
        .select()
        .single();
        
      if (newError) throw newError;
      pacienteId = newPatient.id;
    }

    // 3. Crear la Cita
    const estadoCita = zona === 'sur' ? 'confirmada' : 'pendiente_pago';
    
    const { data: citaData, error: citaError } = await supabase
      .from('citas')
      .insert({
        paciente_id: pacienteId,
        servicio: servicio_id,
        fecha: fecha,
        hora: horaNorm,
        duracion_min: 30,
        estado: estadoCita,
        modalidad: modalidad,
        motivo: motivo,
        zona: zona,
        monto_adelanto: monto_adelanto,
        monto_total: precio_total
      })
      .select()
      .single();

    if (citaError) throw citaError;

    // 4. Vincular la conversación al paciente creado/encontrado
    if (conversacion_id) {
      const { error: conversacionError } = await supabase
        .from('conversaciones')
        .update({ paciente_id: pacienteId })
        .eq('id', conversacion_id);

      if (conversacionError) throw conversacionError;
    }

    // Si confirmada, podemos inyectar `monto_adelanto: 0`. Si pendiente_pago el LLM recordará el monto.
    return JSON.stringify({
      success: true,
      cita_id: citaData.id,
      estado: estadoCita,
      mensaje: estadoCita === 'confirmada' 
        ? "Cita confirmada (sin adelanto por sistema)." 
        : "Cita reservada, pendiente de recibir el pago de adelanto por transferencia."
    });

  } catch (err: any) {
    console.error("Error agendando cita:", err);
    return JSON.stringify({ error: `Hubo un error al registrar la cita: ${err.message}` });
  }
}

/**
 * Escala la consulta a Telegram para que Kelly atienda en persona (Handoff).
 * Returns mensaje_paciente resolved from DERIVACION_TEMPLATES so the LLM
 * sends the exact text without rewriting it.
 */
export async function executeDerivarAKelly(args: any, context: any): Promise<string> {
  const { motivo, nivel_urgencia, historial_resumido } = args;
  const { paciente_id, conversacion_id, senderNumber } = context;

  if (!motivo || !historial_resumido) {
    return JSON.stringify({ error: "Motivo y resumen histórico son obligatorios" });
  }

  // Resolve patient message from templates; fall back to default for unknown motivos
  const mensaje_paciente =
    (DERIVACION_TEMPLATES[motivo as string] ?? DERIVACION_TEMPLATES['default']) as string;
  const mensaje_interno =
    `Notificación enviada a la doctora. ENVÍA TEXTUAL este mensaje al paciente, sin reescribirlo: "${mensaje_paciente}"`;

  try {
    const supabase = getSupabase();

    // 1. Activate handoff on conversation
    if (conversacion_id) {
      await supabase
        .from('conversaciones')
        .update({ handoff_activo: true })
        .eq('id', conversacion_id);
    }

    // 2. Create handoff record
    if (paciente_id && conversacion_id) {
      await supabase
        .from('handoffs')
        .insert({
          conversacion_id: conversacion_id,
          paciente_id: paciente_id,
          motivo: motivo,
          nivel_urgencia: nivel_urgencia || 'medio',
          estado: 'activo'
        })
        .select('id')
        .single();
    }

    // 3. Notify via Telegram
    const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

    if (telegramToken && chatId) {
      const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const txt = `
🚨 <b>ALERTA DE HANDOFF</b> 🚨
<b>Paciente:</b> ${senderNumber}
<b>Nivel:</b> ${nivel_urgencia}

<b>Motivo:</b> ${motivo}
<b>Contexto IA:</b> ${historial_resumido}

Por favor, contesta a este paciente desde tu WhatsApp Business oficial ahora.
`.trim();

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: txt,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Terminé la atención (Retomar IA)", callback_data: `handoff_done_${conversacion_id || 'none'}` }]
            ]
          }
        })
      });
    }

    return JSON.stringify({
      success: true,
      mensaje_paciente,
      mensaje_interno,
    });

  } catch (err: any) {
    console.error("Error derivando a kelly:", err);
    return JSON.stringify({ error: `Hubo un error en derivación técnica: ${err.message}` });
  }
}

export async function executeCancelarCita(args: any, context: any): Promise<string> {
  const { motivo } = args;
  const { paciente_id } = context;

  if (!paciente_id) {
    return JSON.stringify({ error: "No se identificó al paciente. Usa derivar_a_kelly." });
  }

  try {
    const supabase = getSupabase();
    // Obtener cita futura no cancelada/no_show
    const { data: cita } = await supabase
      .from("citas")
      .select("id, fecha, hora")
      .eq("paciente_id", paciente_id)
      .in("estado", ["confirmada", "pendiente_pago"])
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true })
      .limit(1)
      .single();

    if (!cita) {
      return JSON.stringify({ error: "No se encontró ninguna cita activa para este paciente. Infórmale que no ves citas a su nombre." });
    }

    const fechaCita = new Date(`${cita.fecha}T${cita.hora}`);
    const timeDiffMs = fechaCita.getTime() - new Date().getTime();
    const isLessThan24h = timeDiffMs < 24 * 60 * 60 * 1000;

    if (isLessThan24h) {
      return JSON.stringify({ 
        error: "política_incumplida", 
        mensaje_interno: `Falta menos de 24h para la cita (Quedan ${Math.round(timeDiffMs / 3600000)}h). Informa al paciente que por políticas no puedes cancelarlo tú y transfiérelo usando derivar_a_kelly.` 
      });
    }

    // Cancelar en DB
    await supabase.from("citas").update({ estado: "cancelada" }).eq("id", cita.id);

    return JSON.stringify({ success: true, mensaje_interno: "Cita cancelada exitosamente. Comunícale la confirmación." });
  } catch (err: any) {
    return JSON.stringify({ error: `Fallo al cancelar: ${err.message}` });
  }
}

export async function executeReprogramarCita(args: any, context: any): Promise<string> {
  const { nueva_fecha, nueva_hora, motivo } = args;
  const { paciente_id } = context;

  if (!paciente_id) return JSON.stringify({ error: "No se identificó al paciente." });

  try {
    const supabase = getSupabase();
    
    // Obtener cita futura
    const { data: cita } = await supabase
      .from("citas")
      .select("id, fecha, hora")
      .eq("paciente_id", paciente_id)
      .in("estado", ["confirmada", "pendiente_pago"])
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true })
      .limit(1)
      .single();

    if (!cita) {
      return JSON.stringify({ error: "No se encontró ninguna cita activa para reprogramar." });
    }

    // Identificar si es paciente nuevo (1 sola cita en la vida) o habitual (más citas confirmadas)
    const { count } = await supabase
      .from("citas")
      .select("id", { count: "exact" })
      .eq("paciente_id", paciente_id)
      .eq("estado", "completada");
      
    const isHabitual = (count && count > 0) ? true : false;
    const minHours = isHabitual ? 24 : 48;

    const fechaCita = new Date(`${cita.fecha}T${cita.hora}`);
    const timeDiffMs = fechaCita.getTime() - new Date().getTime();
    const hoursLeft = timeDiffMs / 3600000;

    // Verificar si ya pasó la cita (No-Show situation detected here by time)
    if (hoursLeft < 0) {
      // Enviar como no_show
      await supabase.from("citas").update({ estado: "no_show" }).eq("id", cita.id);
      return JSON.stringify({ 
        error: "no_show_detectado", 
        mensaje_interno: "El usuario escribió para reprogramar después de la hora de la cita. Marca como no_show usando derivar_a_kelly para que le cobren multa." 
      });
    }

    if (hoursLeft < minHours) {
      return JSON.stringify({ 
        error: "política_incumplida", 
        mensaje_interno: `Paciente ${isHabitual?'Habitual (req 24h)':'Nuevo (req 48h)'}. Faltan solo ${Math.round(hoursLeft)}h. Informa al paciente que no cumple política y deriva a Kely usando derivar_a_kelly con historial_resumido.` 
      });
    }

    // Reprogramar en DB
    // Normalizar nueva_hora a HH:MM:SS
    const [hPart, mPart] = String(nueva_hora).split(':');
    const nuevaHoraNorm = `${hPart.padStart(2, '0')}:${(mPart ?? '00').padStart(2, '0')}:00`;

    // Primero verificar slot libre
    const { data: slotCheck } = await supabase
      .from('citas')
      .select('id')
      .eq('fecha', nueva_fecha)
      .eq('hora', nuevaHoraNorm)
      .not('estado', 'in', '(cancelada,no_show,rechazada)');

    if (slotCheck && slotCheck.length > 0) {
      return JSON.stringify({ error: "El nuevo slot ya está ocupado. Intenta con otra fecha/hora." });
    }

    await supabase
      .from("citas")
      .update({ fecha: nueva_fecha, hora: nuevaHoraNorm })
      .eq("id", cita.id);

    return JSON.stringify({ success: true, mensaje_interno: "Cita reprogramada exitosamente. Confírmaselo al paciente." });
  } catch (err: any) {
    return JSON.stringify({ error: `Fallo al reprogramar: ${err.message}` });
  }
}

/**
 * executeConfirmarMontoComprobante — OCR fallback text confirmation (FR-11).
 *
 * Called when the LLM detects the patient replied with a numeric amount after
 * Sofia asked "¿puedes confirmarme cuánto pagaste?" (OCR failure turn).
 *
 * Looks for the most recent pagos row with verificado=false AND monto IS NULL
 * for this patient's cita (via pending_payment_confirmation_cita_id on
 * conversaciones). If the normalized amount matches monto_adelanto, runs the
 * same side-effects as the OCR-ok-match path in payment-flow.ts.
 *
 * Returns JSON with status + copy key for Sofia to use as her reply.
 */
export async function executeConfirmarMontoComprobante(
  args: { monto: number },
  ctx: { senderNumber: string; conversacion_id: string; paciente_id: string | null },
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get conversacion to find pending cita
    const { data: conv } = await supabase
      .from("conversaciones")
      .select("id, pending_payment_confirmation_cita_id, last_message_at")
      .eq("id", ctx.conversacion_id)
      .single();

    const citaId = conv?.pending_payment_confirmation_cita_id;
    if (!citaId) {
      return JSON.stringify({ error: "no_pending_cita", mensaje_sofia: "No encontré una cita pendiente de confirmación de pago. ¿Puedes indicarme cuál es tu cita?" });
    }

    // 2. Load cita
    //    Schema note: citas uses `servicio` (text) + separate `fecha`/`hora`,
    //    not `servicio_id`/`fecha_hora` (confirmed 2026-05-26).
    const { data: cita } = await supabase
      .from("citas")
      .select("id, monto_adelanto, estado, paciente_id, servicio, fecha, hora")
      .eq("id", citaId)
      .single();

    if (!cita) {
      return JSON.stringify({ error: "cita_not_found" });
    }

    if (cita.estado !== "pendiente_pago") {
      return JSON.stringify({
        status: "already_processed",
        mensaje_sofia: "Tu cita ya está en proceso de confirmación.",
      });
    }

    // 3. Normalize and check amount
    const montoNorm = normalizeAmount(args.monto);
    if (montoNorm === null) {
      return JSON.stringify({
        status: "invalid_amount",
        mensaje_sofia: "No pude interpretar el monto que me diste. ¿Puedes indicarme solo el número, por ejemplo: 17.50?",
      });
    }

    if (!amountMatches(montoNorm, cita.monto_adelanto)) {
      return JSON.stringify({
        status: "underpayment",
        monto_recibido: montoNorm,
        monto_esperado: cita.monto_adelanto,
        mensaje_sofia: `El monto de la señal es $${cita.monto_adelanto.toFixed(2)}, pero me indicaste $${montoNorm.toFixed(2)}. ¿Puedes verificarlo?`,
      });
    }

    // 4. Match! Apply same side-effects as OCR-ok-match path
    const expiraAt = new Date(Date.now() + 24 * 3_600_000).toISOString();

    // Insert pago (referencia = "texto_paciente" to distinguish from OCR path).
    // Schema: column is `comprobante_url` and `metodo` is NOT NULL (enum
    // transfer|cash|payphone) — same fix as payment-flow.ts on 2026-05-26.
    const { data: pagoData } = await supabase
      .from("pagos")
      .insert({
        cita_id: cita.id,
        monto: montoNorm,
        metodo: "transfer",
        referencia: `texto_${ctx.conversacion_id}`,
        verificado: false,
        comprobante_url: null,
      })
      .select()
      .single();

    // Transition cita
    await supabase
      .from("citas")
      .update({ estado: "confirmada_provisional" })
      .eq("id", cita.id);

    // Insert pending_kelly_actions
    if (pagoData) {
      await supabase
        .from("pending_kelly_actions")
        .insert({
          action_type: "aprobar_pago",
          expira_at: expiraAt,
          args: { cita_id: cita.id, pago_id: pagoData.id, source: "ocr_fallback_text" },
        });
    }

    // Clear the pending flag on conversacion
    await supabase
      .from("conversaciones")
      .update({ pending_payment_confirmation_cita_id: null })
      .eq("id", ctx.conversacion_id);

    logPaymentEvent("text_fallback_confirmed", { citaId: cita.id, monto: montoNorm });

    // Sofia uses M4 copy (copy-final: "Gracias por confirmarme el monto...")
    return JSON.stringify({
      status: "confirmed_provisional",
      monto: montoNorm,
      mensaje_sofia: "Gracias por confirmarme el monto. ¡Tu cita queda agendada! La Dra. Kely valida el pago cuando tenga un momento. ¡Te esperamos!",
    });
  } catch (err: any) {
    logPaymentEvent("text_fallback_error", { reason: err?.message });
    return JSON.stringify({ error: `Error al confirmar monto: ${err?.message}` });
  }
}
