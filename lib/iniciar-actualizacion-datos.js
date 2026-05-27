/**
 * lib/iniciar-actualizacion-datos.js
 *
 * Pure logic for the iniciar_actualizacion_datos agent tool.
 * No Supabase calls. Returns the conversational prompt that kicks off
 * the 3-data collection flow.
 *
 * Exported for Vitest testing (Node) and imported from agent-runner/tools.ts.
 */

/**
 * Returns the initial response for the data-update flow.
 *
 * @param {{ trigger: 'regex_keyword'|'llm_intent', paciente_id: string|null, from_number: string }} args
 * @returns {{ ok: true, instruccion: string, datos_requeridos: string[], paciente_conocido: boolean, next_step: string }}
 */
export function iniciarActualizacionDatos(args) {
  const { trigger, paciente_id, from_number } = args
  const pacienteConocido = !!paciente_id

  return {
    ok: true,
    instruccion:
      'Pedile al paciente los 3 datos obligatorios uno por uno, en el orden indicado. ' +
      'Usá parse_appointment_date para parsear ambas fechas antes de continuar.',
    datos_requeridos: [
      'nombre_completo',       // nombre completo como en cédula (2 nombres + 2 apellidos)
      'fecha_nacimiento',      // DD/MM/AAAA
      'fecha_proxima_o_ultima_cita', // DD/MM/AAAA
    ],
    paciente_conocido: pacienteConocido,
    next_step: pacienteConocido
      ? 'El sender ya está en BD. Confirmar identidad antes de tocar teléfono.'
      : 'El sender es desconocido. Recolectar datos y verificar con verificar_datos_paciente.',
    trigger,
    from_number,
  }
}
