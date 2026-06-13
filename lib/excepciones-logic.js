/**
 * lib/excepciones-logic.js
 *
 * Pure business logic for excepciones_horario server actions.
 * No Supabase client, no Next.js — fully testable in Vitest.
 *
 * Exported functions are used by app/dashboard/actions.js.
 */

/** Valid ubicacion values per spec R-DM-01 and design §5 */
export const VALID_UBICACIONES = ['quito_extendido', 'solo_virtual', 'santo_domingo']

/**
 * Validate the create-exception input fields.
 *
 * @param {{ fecha_inicio: string, fecha_fin: string, ubicacion: string, hora_fin: string }} input
 * @returns {{ ok: boolean, message?: string }}
 */
export function validateExcepcionInput({ fecha_inicio, fecha_fin, ubicacion, hora_fin }) {
  if (!fecha_inicio) {
    return { ok: false, message: 'La fecha de inicio es requerida.' }
  }
  if (!fecha_fin) {
    return { ok: false, message: 'La fecha de fin es requerida.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio)) {
    return { ok: false, message: 'Formato de fecha_inicio inválido (YYYY-MM-DD).' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_fin)) {
    return { ok: false, message: 'Formato de fecha_fin inválido (YYYY-MM-DD).' }
  }
  if (fecha_fin < fecha_inicio) {
    return { ok: false, message: 'La fecha de fin no puede ser anterior a la fecha de inicio.' }
  }
  if (!VALID_UBICACIONES.includes(ubicacion)) {
    return {
      ok: false,
      message: `Ubicación inválida. Valores aceptados: ${VALID_UBICACIONES.join(', ')}.`,
    }
  }
  if (!hora_fin || !/^\d{2}:\d{2}$/.test(hora_fin)) {
    return { ok: false, message: 'La hora de fin es requerida (formato HH:MM).' }
  }
  // hora_fin must be after 12:00 (after morning close) and <= 21:00 (hard ceiling per design §5)
  if (hora_fin <= '12:00') {
    return { ok: false, message: 'La hora de fin debe ser posterior a las 12:00.' }
  }
  if (hora_fin > '21:00') {
    return { ok: false, message: 'La hora de fin no puede superar las 21:00.' }
  }
  return { ok: true }
}

/**
 * Expand a date range into an array of YYYY-MM-DD strings (ascending, inclusive).
 *
 * @param {string} fecha_inicio YYYY-MM-DD
 * @param {string} fecha_fin    YYYY-MM-DD
 * @returns {string[]}
 */
export function expandDateRange(fecha_inicio, fecha_fin) {
  if (fecha_fin < fecha_inicio) return []

  const dates = []
  // Use UTC dates to avoid DST shifts
  const start = new Date(fecha_inicio + 'T00:00:00Z')
  const end = new Date(fecha_fin + 'T00:00:00Z')

  const cur = new Date(start)
  while (cur <= end) {
    const y = cur.getUTCFullYear()
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cur.getUTCDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * Detect conflicting citas for the given exception type.
 *
 * A conflict exists when:
 *  - ubicacion is 'santo_domingo' or 'solo_virtual': any presencial cita whose
 *    zona is NOT 'santo_domingo' (i.e. Quito zones: norte, sur, domicilio).
 *  - For 'solo_virtual': ALL presencial citas are conflicts (including santo_domingo zone).
 *  - 'quito_extendido' NEVER conflicts — it only adds slots, never removes.
 *
 * @param {Array<{cita_id: string, fecha: string, hora_inicio: string, modalidad: string, zona: string, paciente_nombre: string, paciente_telefono: string}>} citasRows
 * @param {string} ubicacion  The new exception's ubicacion value
 * @returns {Array} Subset of citasRows that conflict
 */
export function detectConflicts(citasRows, ubicacion) {
  if (ubicacion === 'quito_extendido') {
    // Extended hours never remove existing slots — no conflict possible
    return []
  }

  return citasRows.filter((c) => {
    if (c.modalidad === 'virtual') return false

    if (ubicacion === 'solo_virtual') {
      // All presencial citas conflict (any zone)
      return true
    }

    if (ubicacion === 'santo_domingo') {
      // Conflicts with presencial Quito zones only (norte, sur, domicilio)
      // SD presencial citas are not a conflict because SD presencial stays available
      return c.zona !== 'santo_domingo'
    }

    return false
  })
}

/**
 * Detect overlap between the requested new dates and existing excepciones.
 *
 * @param {string[]} newDates        YYYY-MM-DD strings (expanded range)
 * @param {Array<{fecha: string}>} existingExcepciones  Rows from excepciones_horario
 * @returns {string[]} Dates in newDates that already have an existing excepcion
 */
export function detectOverlaps(newDates, existingExcepciones) {
  const existingSet = new Set(existingExcepciones.map((e) => e.fecha))
  return newDates.filter((d) => existingSet.has(d))
}
