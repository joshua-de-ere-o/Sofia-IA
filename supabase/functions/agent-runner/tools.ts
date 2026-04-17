import { createClient } from "jsr:@supabase/supabase-js";

/**
 * supabase/functions/agent-runner/tools.ts
 *
 * Implementación de las herramientas para el Agent Loop de Sofía.
 */

// URL del propio proyecto de supabase para llamar a edge functions internas
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

/**
 * Llama a la Edge Function 'calcular-precio' previamente construida.
 * Devuelve un string JSON para el LLM.
 */
export async function executeCalcularPrecio(args: any): Promise<string> {
  const { servicio_id, zona } = args;
  
  if (!servicio_id || !zona) {
    return JSON.stringify({ error: "Faltan parámetros: servicio_id o zona" });
  }

  try {
    const url = `${SUPABASE_URL}/functions/v1/calcular-precio`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ servicio_id, zona })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Error from calcular-precio function:", errBody);
      return JSON.stringify({ error: `Fallo al calcular precio: HTTP ${res.status}` });
    }

    const data = await res.json();
    return JSON.stringify(data);
  } catch (err: any) {
    console.error("Fetch error calling calcular-precio:", err);
    return JSON.stringify({ error: `Fallo interno al contactar calculador: ${err.message}` });
  }
}

function getSupabase() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Consulta la disponibilidad de agenda en Supabase.
 * Retorna las fechas y horas libres excluyendo domingos, feriados (tarde) y slots ocupados.
 */
export async function executeConsultarDisponibilidad(args: any): Promise<string> {
  const { fecha_inicio, fecha_fin } = args; // modalidad puede ignorarse para disponibilidad porque el calendario es el mismo
  if (!fecha_inicio || !fecha_fin) {
    return JSON.stringify({ error: "Faltan parámetros: fecha_inicio o fecha_fin" });
  }

  try {
    const supabase = getSupabase();
    
    // 1. Consultar citas en este periodo que no estén canceladas u omitidas
    const { data: citas, error: errorCitas } = await supabase
      .from('citas')
      .select('fecha, hora, estado')
      .gte('fecha', fecha_inicio)
      .lte('fecha', fecha_fin)
      .not('estado', 'in', '(cancelada,no_show)');
      
    if (errorCitas) throw errorCitas;

    // 2. Consultar feriados
    const { data: feriados, error: errorFeriados } = await supabase
      .from('feriados')
      .select('fecha')
      .gte('fecha', fecha_inicio)
      .lte('fecha', fecha_fin);

    if (errorFeriados) throw errorFeriados;

    const occupiedSet = new Set();
    citas?.forEach((cita: any) => {
      // hora viene como 'HH:MM:SS', nos quedamos con 'HH:MM'
      const timeStr = cita.hora.substring(0, 5); 
      occupiedSet.add(`${cita.fecha}_${timeStr}`);
    });

    const feriadoSet = new Set(feriados?.map((f: any) => f.fecha));

    // 3. Generar slots libres
    const startObj = new Date(fecha_inicio + "T00:00:00");
    const endObj = new Date(fecha_fin + "T00:00:00");
    let current = new Date(startObj);
    
    let slotsLibres: Record<string, string[]> = {};
    let dayCount = 0;

    // Para evitar dar slots en el pasado el día de "hoy"
    const nowLocalStr = new Date().toLocaleString("en-US", { timeZone: "America/Guayaquil" });
    const localNow = new Date(nowLocalStr);
    const todayStr = localNow.getFullYear() + "-" + String(localNow.getMonth() + 1).padStart(2, '0') + "-" + String(localNow.getDate()).padStart(2, '0');
    const currentHourStr = String(localNow.getHours()).padStart(2, '0') + ":" + String(localNow.getMinutes()).padStart(2, '0');

    while (current <= endObj && dayCount <= 14) {
      const dateStr = current.getFullYear() + "-" + String(current.getMonth() + 1).padStart(2, '0') + "-" + String(current.getDate()).padStart(2, '0');
      const dayOfWeek = current.getDay(); // 0 es Domingo
      
      if (dayOfWeek !== 0) { // Ignorar domingos
        let isFeriado = feriadoSet.has(dateStr);
        let allowedSlots: string[] = [];
        
        // Franja mañana: 08:00 a 11:30 (ya que citas pueden durar hasta 40m, 11:30 termina 12:10)
        const morningSlots = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
        const afternoonSlots = ["15:00", "15:30", "16:00", "16:30"];
        
        allowedSlots.push(...morningSlots);
        
        // Sabados y Feriados SOLO trabajan en la mañana
        if (!isFeriado && dayOfWeek !== 6) {
          allowedSlots.push(...afternoonSlots);
        }

        const validSlots = allowedSlots.filter(timeSlot => {
          // Descartar citas del mismo día que ya pasaron
          if (dateStr === todayStr && timeSlot <= currentHourStr) {
             return false;
          }
          return !occupiedSet.has(`${dateStr}_${timeSlot}`);
        });

        if (validSlots.length > 0) {
          slotsLibres[dateStr] = validSlots;
        }
      }

      current.setDate(current.getDate() + 1);
      dayCount++;
    }

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
export async function executeAgendarCita(args: any, context: any): Promise<string> {
  const {
    paciente_nombre, paciente_fecha_nacimiento, paciente_telefono, paciente_email,
    servicio_id, fecha, hora, modalidad, zona, motivo, monto_adelanto
  } = args;

  if (!paciente_nombre || !paciente_telefono || !servicio_id || !fecha || !hora || !modalidad || !zona) {
    return JSON.stringify({ error: "Faltan parámetros requeridos para agendar la cita" });
  }

  try {
    const supabase = getSupabase();
    const { conversacion_id } = context ?? {};

    // Normalizar hora a HH:MM:SS — el LLM puede enviar "9:00" o "09:00"
    const [hPart, mPart] = String(hora).split(':');
    const horaNorm = `${hPart.padStart(2, '0')}:${(mPart ?? '00').padStart(2, '0')}:00`;

    // 1. Verificar si el slot no fue ocupado en el último segundo
    const { data: slotCheck } = await supabase
      .from('citas')
      .select('id')
      .eq('fecha', fecha)
      .eq('hora', horaNorm)
      .not('estado', 'in', '(cancelada,no_show)');

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
      .eq('telefono', paciente_telefono)
      .single();

    if (existingPatient) {
      pacienteId = existingPatient.id;
      // Opcional: Actualizar datos
      await supabase.from('pacientes').update({ 
        nombre: paciente_nombre,
        fecha_nacimiento: paciente_fecha_nacimiento || null,
        email: paciente_email || null,
        zona: zona
      }).eq('id', pacienteId);
    } else {
      const { data: newPatient, error: newError } = await supabase
        .from('pacientes')
        .insert({
          nombre: paciente_nombre,
          fecha_nacimiento: paciente_fecha_nacimiento || null,
          telefono: paciente_telefono,
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
        monto_adelanto: monto_adelanto || 0
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
 */
export async function executeDerivarAKelly(args: any, context: any): Promise<string> {
  const { motivo, nivel_urgencia, historial_resumido } = args;
  const { paciente_id, conversacion_id, senderNumber } = context;

  if (!motivo || !historial_resumido) {
    return JSON.stringify({ error: "Motivo y resumen histórico son obligatorios" });
  }

  try {
    const supabase = getSupabase();

    // 1. Activar Handoff en la conversación
    if (conversacion_id) {
      await supabase
        .from('conversaciones')
        .update({ handoff_activo: true })
        .eq('id', conversacion_id);
    }

    // 2. Crear registro de Handoff
    let handoffId = null;
    if (paciente_id && conversacion_id) {
      const { data: handoffData } = await supabase
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
      if (handoffData) handoffId = handoffData.id;
    }

    // 3. Notificar a Telegram
    // Invocaremos al webhook de Telegram u optaremos por fetch directo a la api si telegram.js es importable localmente 
    // Para Deno es mejor un POST a una internal route de Telegram si existe, pero como telegram.js está en /lib,
    // es un módulo Node de Next. Llamemos al bot directo desde aquí (necesitamos el token).
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

      const options = {
         reply_markup: {
           inline_keyboard: [
              [{ text: "✅ Terminé la atención (Retomar IA)", callback_data: `handoff_done_${conversacion_id || 'none'}` }]
           ]
         }
      };

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: "HTML", reply_markup: options.reply_markup })
      });
    }

    return JSON.stringify({
      success: true,
      mensaje_interno: "Notificación enviada a la doctora. Indica al usuario educadamente que será contactado brevemente por ella y detén la conversación."
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
        mensaje_interno: `Paciente ${isHabitual?'Habitual (req 24h)':'Nuevo (req 48h)'}. Faltan solo ${Math.round(hoursLeft)}h. Informa al paciente que no cumple política y deriva a Kelly usando derivar_a_kelly con historial_resumido.` 
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
      .not('estado', 'in', '(cancelada,no_show)');

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
