/**
 * lib/agendable-guard.js
 * Pure guard logic extracted from executeAgendarCita (tools.ts) for testability.
 * tools.ts calls this function at the start of executeAgendarCita.
 */

import { getServicio } from './servicios.js'

/**
 * Checks whether a service can be scheduled.
 * @param {string} servicio_id
 * @returns {object|null} error object if blocked, null if the service can be scheduled
 */
export function checkAgendable(servicio_id) {
  const servicio = getServicio(servicio_id)

  if (!servicio) {
    return { error: 'SERVICIO_DESCONOCIDO', servicio_id }
  }

  if (!servicio.agendable) {
    return {
      error: 'NO_AGENDABLE',
      servicio_id,
      accion_requerida: 'derivar_a_kelly',
      motivo_sugerido: servicio.derivacion_motivo,
    }
  }

  return null
}
