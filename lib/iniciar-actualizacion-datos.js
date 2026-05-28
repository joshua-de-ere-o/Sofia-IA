/**
 * lib/iniciar-actualizacion-datos.js
 *
 * Pure logic for the iniciar_actualizacion_datos agent tool.
 * No Supabase calls. Returns the conversational prompt that kicks off
 * the safe reminder-linking flow.
 *
 * Exported for Vitest testing (Node) and imported from agent-runner/tools.ts.
 */

/**
 * Returns the initial response for the data-update flow.
 *
 * @param {{ trigger: 'regex_keyword'|'llm_intent', paciente_id: string|null, from_number: string }} args
 * @returns {{ ok: true, instruccion: string, datos_requeridos: string[], optional_enrichment: string[], paciente_conocido: boolean, next_step: string }}
 */
export function iniciarActualizacionDatos(args) {
  const { trigger, paciente_id, from_number } = args
  const pacienteConocido = !!paciente_id

  return {
    ok: true,
    instruccion:
      'Pedile al paciente los datos obligatorios uno por uno, en el orden indicado. ' +
      'Usá parse_appointment_date para la fecha de cita y pedí la hora solo si verificar_datos_paciente devuelve needs_time_tiebreaker.',
    datos_requeridos: [
      'nombre_completo',
      'fecha_cita',
    ],
    optional_enrichment: ['fecha_nacimiento'],
    paciente_conocido: pacienteConocido,
    next_step: pacienteConocido
      ? 'El sender ya está en BD. Confirmá nombre + cita antes de tocar el teléfono.'
      : 'El sender es desconocido. Recolectá nombre + cita y verificá con verificar_datos_paciente.',
    trigger,
    from_number,
  }
}
