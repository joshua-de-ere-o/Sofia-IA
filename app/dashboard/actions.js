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
    raw.push({ role: 'assistant', content: texto })
    
    await supabase.from('conversaciones')
      .update({ mensajes_raw: raw, ultima_actividad: new Date().toISOString() })
      .eq('id', conversacion_id)
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
