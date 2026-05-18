'use server'

import { createServerSupabaseClient } from '@/lib/supabase-server'

/**
 * Obtener la configuración general del sistema
 */
export async function getSystemConfig() {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('configuracion')
    .select(`
      whitelist_activa,
      whitelist_numeros,
      blocklist_numeros,
      keywords_intencion,
      keywords_spam,
      canned_texto,
      canned_cooldown_horas,
      manual_timeout_horas,
      ai_provider,
      ai_api_key,
      ycloud_daily_messages,
      datos_bancarios
    `)
    .eq('id', 1)
    .single()

  if (error) {
    console.error("Error fetching config:", error)
    return { error: error.message }
  }

  return { config: data }
}

/**
 * Actualizar configuracion (whitelist y provider preferido)
 */
export async function updateSystemConfig(updates) {
  const supabase = await createServerSupabaseClient()

  // Evitamos modificar id u otros campos accidentalmente
  const allowedUpdates = {}
  if (updates.whitelist_activa !== undefined) allowedUpdates.whitelist_activa = updates.whitelist_activa
  if (updates.whitelist_numeros !== undefined) allowedUpdates.whitelist_numeros = updates.whitelist_numeros
  if (updates.blocklist_numeros !== undefined) allowedUpdates.blocklist_numeros = updates.blocklist_numeros
  if (updates.keywords_intencion !== undefined) allowedUpdates.keywords_intencion = updates.keywords_intencion
  if (updates.keywords_spam !== undefined) allowedUpdates.keywords_spam = updates.keywords_spam
  if (updates.canned_texto !== undefined) allowedUpdates.canned_texto = updates.canned_texto
  if (updates.canned_cooldown_horas !== undefined) allowedUpdates.canned_cooldown_horas = updates.canned_cooldown_horas
  if (updates.manual_timeout_horas !== undefined) allowedUpdates.manual_timeout_horas = updates.manual_timeout_horas
  if (updates.ai_provider !== undefined) allowedUpdates.ai_provider = updates.ai_provider
  if (updates.ai_api_key !== undefined) allowedUpdates.ai_api_key = updates.ai_api_key
  if (updates.datos_bancarios !== undefined) allowedUpdates.datos_bancarios = updates.datos_bancarios
  
  // Si las llaves API vienen vacías, las consideramos como "NULL" para fallback a .env
  if (allowedUpdates.ai_api_key === '') {
    allowedUpdates.ai_api_key = null
  }

  const { error } = await supabase
    .from('configuracion')
    .update(allowedUpdates)
    .eq('id', 1)

  if (error) {
    console.error("Error updating config:", error)
    return { error: error.message }
  }

  return { success: true }
}

/**
 * Enviar mensaje manual y actualizar memoria
 */
export async function sendManualMessage(conversacion_id, telefono, texto) {
  const supabase = await createServerSupabaseClient()
  
  // Enviar a WhatsApp
  const { sendWhatsAppMessage } = await import('@/lib/ycloud')
  const sendRes = await sendWhatsAppMessage(telefono, texto)
  
  if (!sendRes.success) {
    return { error: sendRes.error }
  }
  
  // Anexar mensaje_raw a la BD
  const { data: conv } = await supabase
    .from('conversaciones')
    .select('mensajes_raw')
    .eq('id', conversacion_id)
    .single()
    
  if (conv) {
    const raw = conv.mensajes_raw || []
    raw.push({
      role: 'assistant',
      sender: 'kelly',
      content: texto,
      timestamp: new Date().toISOString(),
    })

    await supabase.from('conversaciones')
      .update({ mensajes_raw: raw, ultima_actividad: new Date().toISOString() })
      .eq('id', conversacion_id)
  }

  return { success: true }
}

/**
 * Cambiar modo de una conversación: 'auto' | 'manual' | 'personal'
 * - personal → inserta número en blocklist + configuracion.blocklist_numeros
 * - manual   → guarda manual_until = now + manual_timeout_horas
 * - auto     → limpia manual_until
 */
export async function setConversacionMode(conversacion_id, mode) {
  if (!['auto', 'manual', 'personal'].includes(mode)) {
    return { error: 'Modo inválido' }
  }
  const supabase = await createServerSupabaseClient()

  const { data: conv, error: errConv } = await supabase
    .from('conversaciones')
    .select('telefono_contacto')
    .eq('id', conversacion_id)
    .single()
  if (errConv || !conv) return { error: errConv?.message || 'Conversación no encontrada' }

  const phone = conv.telefono_contacto
  const update = { mode }

  if (mode === 'manual') {
    const { data: cfg } = await supabase
      .from('configuracion')
      .select('manual_timeout_horas')
      .eq('id', 1)
      .maybeSingle()
    const horas = cfg?.manual_timeout_horas || 6
    update.manual_until = new Date(Date.now() + horas * 3600 * 1000).toISOString()
  } else {
    update.manual_until = null
  }

  const { error } = await supabase
    .from('conversaciones')
    .update(update)
    .eq('id', conversacion_id)
  if (error) return { error: error.message }

  if (mode === 'personal' && phone) {
    await supabase
      .from('blocklist')
      .upsert({ phone, tipo: 'personal' }, { onConflict: 'phone' })

    const { data: cfg } = await supabase
      .from('configuracion')
      .select('blocklist_numeros')
      .eq('id', 1)
      .maybeSingle()
    const actuales = Array.isArray(cfg?.blocklist_numeros) ? cfg.blocklist_numeros : []
    if (!actuales.includes(phone)) {
      await supabase
        .from('configuracion')
        .update({ blocklist_numeros: [...actuales, phone] })
        .eq('id', 1)
    }
  }

  if (mode === 'auto' && phone) {
    // Al volver a auto, se remueve del blocklist (si estaba por modo personal)
    await supabase.from('blocklist').delete().eq('phone', phone)

    const { data: cfg } = await supabase
      .from('configuracion')
      .select('blocklist_numeros')
      .eq('id', 1)
      .maybeSingle()
    const actuales = Array.isArray(cfg?.blocklist_numeros) ? cfg.blocklist_numeros : []
    const next = actuales.filter((n) => n !== phone)
    if (next.length !== actuales.length) {
      await supabase
        .from('configuracion')
        .update({ blocklist_numeros: next })
        .eq('id', 1)
    }
  }

  return { success: true }
}

/**
 * Retomar conversación (Resolver Handoff y cerrar la conversación o retomarla)
 */
export async function resolveHandoff(conversacion_id) {
  const supabase = await createServerSupabaseClient()
  
  const { error } = await supabase
    .from('conversaciones')
    .update({ handoff_activo: false })
    .eq('id', conversacion_id)
    
  if (error) return { error: error.message }
  return { success: true }
}

/**
 * Actualizar estado de una cita
 */
export async function actualizarEstadoCita(cita_id, estado) {
  const supabase = await createServerSupabaseClient()
  
  const { error } = await supabase
    .from('citas')
    .update({ estado })
    .eq('id', cita_id)
    
  if (error) return { error: error.message }
  return { success: true }
}

/**
 * Verificar pago y confirmar cita
 */
export async function verificarPago(cita_id) {
  const supabase = await createServerSupabaseClient()
  
  // Marcar pago como verificado
  const { error: errorPago } = await supabase
    .from('pagos')
    .update({ verificado: true })
    .eq('cita_id', cita_id)
    
  if (errorPago) return { error: errorPago.message }
  
  // Cambiar cita a confirmada
  const { error: errorCita } = await supabase
    .from('citas')
    .update({ estado: 'confirmada' })
    .eq('id', cita_id)
    
  if (errorCita) return { error: errorCita.message }
  
  return { success: true }
}

/**
 * Calcular rango de fechas para un periodo dado.
 * Devuelve strings YYYY-MM-DD en zona horaria local.
 */
function calcularRangoPeriodo(periodo) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const fmt = (date) => {
    const yy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
  }

  let desde, hasta, prevDesde, prevHasta, label

  switch (periodo) {
    case 'hoy': {
      desde = new Date(y, m, d)
      hasta = new Date(y, m, d)
      prevDesde = new Date(y, m, d - 1)
      prevHasta = new Date(y, m, d - 1)
      label = 'Hoy'
      break
    }
    case 'semana': {
      const dow = (now.getDay() + 6) % 7
      desde = new Date(y, m, d - dow)
      hasta = new Date(y, m, d - dow + 6)
      prevDesde = new Date(y, m, d - dow - 7)
      prevHasta = new Date(y, m, d - dow - 1)
      label = 'Esta semana'
      break
    }
    case 'mes-anterior': {
      desde = new Date(y, m - 1, 1)
      hasta = new Date(y, m, 0)
      prevDesde = new Date(y, m - 2, 1)
      prevHasta = new Date(y, m - 1, 0)
      label = 'Mes anterior'
      break
    }
    case 'mes':
    default: {
      desde = new Date(y, m, 1)
      hasta = new Date(y, m + 1, 0)
      prevDesde = new Date(y, m - 1, 1)
      prevHasta = new Date(y, m, 0)
      label = 'Este mes'
      break
    }
  }

  return {
    desde: fmt(desde),
    hasta: fmt(hasta),
    prevDesde: fmt(prevDesde),
    prevHasta: fmt(prevHasta),
    label,
  }
}

/**
 * Obtener métricas financieras para un periodo.
 * Devuelve totales y detalle de items para cada categoría: cobrado, por verificar y pendiente.
 */
export async function getFinanzasMetrics(periodo = 'mes') {
  const supabase = await createServerSupabaseClient()
  const rango = calcularRangoPeriodo(periodo)

  // Pagos del periodo, con datos de cita y paciente
  const { data: pagos, error: errPagos } = await supabase
    .from('pagos')
    .select(`
      id, monto, verificado, created_at, cita_id,
      cita:citas(id, fecha, servicio, paciente:pacientes(nombre, telefono))
    `)
    .gte('created_at', `${rango.desde}T00:00:00`)
    .lte('created_at', `${rango.hasta}T23:59:59`)
    .order('created_at', { ascending: false })

  if (errPagos) return { error: errPagos.message }

  // Citas pendientes de pago en el periodo (sin pago verificado todavía)
  const { data: citasPendientes, error: errCitas } = await supabase
    .from('citas')
    .select(`
      id, fecha, hora, servicio, monto_adelanto, monto_total, estado,
      paciente:pacientes(nombre, telefono),
      pagos(verificado)
    `)
    .eq('estado', 'pendiente_pago')
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha', { ascending: true })

  if (errCitas) return { error: errCitas.message }

  // Pagos verificados del periodo anterior, sólo para comparación de cobrado
  const { data: pagosPrev } = await supabase
    .from('pagos')
    .select('monto, verificado')
    .gte('created_at', `${rango.prevDesde}T00:00:00`)
    .lte('created_at', `${rango.prevHasta}T23:59:59`)

  const cobradoItems = (pagos || [])
    .filter((p) => p.verificado)
    .map((p) => ({
      id: p.id,
      fecha: p.cita?.fecha || p.created_at?.substring(0, 10),
      paciente_nombre: p.cita?.paciente?.nombre || 'Sin nombre',
      paciente_telefono: p.cita?.paciente?.telefono || '',
      servicio: p.cita?.servicio || '',
      monto: Number(p.monto) || 0,
    }))

  const porVerificarItems = (pagos || [])
    .filter((p) => !p.verificado)
    .map((p) => ({
      id: p.id,
      cita_id: p.cita_id,
      fecha: p.cita?.fecha || p.created_at?.substring(0, 10),
      paciente_nombre: p.cita?.paciente?.nombre || 'Sin nombre',
      paciente_telefono: p.cita?.paciente?.telefono || '',
      servicio: p.cita?.servicio || '',
      monto: Number(p.monto) || 0,
    }))

  const pendienteItems = (citasPendientes || [])
    .filter((c) => !c.pagos || c.pagos.length === 0)
    .map((c) => ({
      id: c.id,
      fecha: c.fecha,
      hora: c.hora,
      paciente_nombre: c.paciente?.nombre || 'Sin nombre',
      paciente_telefono: c.paciente?.telefono || '',
      servicio: c.servicio || '',
      monto: Number(c.monto_adelanto) || 0,
    }))

  const sum = (arr) => arr.reduce((acc, x) => acc + x.monto, 0)
  const cobradoTotal = sum(cobradoItems)
  const porVerificarTotal = sum(porVerificarItems)
  const pendienteTotal = sum(pendienteItems)

  const cobradoPrev = (pagosPrev || [])
    .filter((p) => p.verificado)
    .reduce((acc, p) => acc + (Number(p.monto) || 0), 0)

  const deltaPct = cobradoPrev > 0
    ? Math.round(((cobradoTotal - cobradoPrev) / cobradoPrev) * 100)
    : null

  return {
    periodo: { ...rango, key: periodo },
    cobrado: { total: cobradoTotal, cantidad: cobradoItems.length, items: cobradoItems },
    porVerificar: { total: porVerificarTotal, cantidad: porVerificarItems.length, items: porVerificarItems },
    pendiente: { total: pendienteTotal, cantidad: pendienteItems.length, items: pendienteItems },
    comparacion: { cobradoPrev, deltaPct },
  }
}

/**
 * Obtener métricas para el dashboard
 */
export async function getDashboardMetrics() {
  const supabase = await createServerSupabaseClient()
  
  const [
    { count: leads_recibidos },
    { count: citas_agendadas },
    { count: no_shows },
    { count: casos_escalados }
  ] = await Promise.all([
    supabase.from('pacientes').select('*', { count: 'exact', head: true }),
    supabase.from('citas').select('*', { count: 'exact', head: true }),
    supabase.from('citas').select('*', { count: 'exact', head: true }).eq('estado', 'no_show'),
    supabase.from('handoffs').select('*', { count: 'exact', head: true })
  ])
  
  const tasa = leads_recibidos > 0 ? Math.round((citas_agendadas / leads_recibidos) * 100) : 0
  
  return {
    leads_recibidos: leads_recibidos || 0,
    citas_agendadas: citas_agendadas || 0,
    no_shows: no_shows || 0,
    casos_escalados: casos_escalados || 0,
    tasa_agendamiento: tasa
  }
}
