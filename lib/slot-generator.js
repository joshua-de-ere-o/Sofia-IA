/**
 * lib/slot-generator.js
 *
 * Pure slot-generation logic extracted from executeConsultarDisponibilidad
 * (supabase/functions/agent-runner/tools.ts) for Vitest testability.
 *
 * No Deno deps. No Supabase deps. All inputs are plain JS values.
 *
 * Exported for both Node (CRM tests) and tools.ts (imports via relative path
 * with Deno-compatible ESM import — Deno can import Node-compatible ESM).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPENING_HOUR = '08:00'

/** Base morning slots: 08:00–11:30 (30-min cadence) */
export const BASE_MORNING_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
]

/** Base afternoon slots for weekdays (Mon–Fri): 15:00–16:30 */
export const BASE_AFTERNOON_SLOTS = ['15:00', '15:30', '16:00', '16:30']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build time slots from startTime (inclusive) to endTime (exclusive, last slot
 * starts at endTime - 30 min) in 30-minute increments.
 *
 * Example: buildSlots('15:00', '19:30') → ['15:00','15:30',...,'19:00']
 *
 * @param {string} startTime  'HH:MM'
 * @param {string} endTime    'HH:MM' — last slot is endTime minus 30 min
 * @returns {string[]}
 */
export function buildSlots(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em

  const slots = []
  for (let t = startMin; t < endMin; t += 30) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0')
    const mm = String(t % 60).padStart(2, '0')
    slots.push(`${hh}:${mm}`)
  }
  return slots
}

// ---------------------------------------------------------------------------
// Core: per-day slot builder
// ---------------------------------------------------------------------------

/**
 * Compute allowed slots for a single calendar date given availability context.
 *
 * Precedence rules (spec R-AV-02):
 *   1. If feriado → zero slots (regardless of excepcion).
 *   2. If excepcion exists (and not feriado) → apply override by ubicacion.
 *   3. No excepcion, no feriado → base hardcoded schedule.
 *
 * Override semantics (ADR-1, ADR-4):
 *   quito_extendido  → morning + extended afternoon (base 15:00 to hora_fin)
 *   solo_virtual     → morning + base afternoon; all slots tagged virtual_only
 *   santo_domingo    → morning + SD afternoon (base 15:00 to hora_fin); Quito presencial blocked
 *
 * @param {object} params
 * @param {number} params.dayOfWeek        0=Sunday … 6=Saturday
 * @param {boolean} params.isFeriado
 * @param {object|null} params.excepcion   Row from excepciones_horario or null
 * @returns {{ slots: string[], tag: 'normal'|'virtual_only'|'santo_domingo' }}
 */
export function computeDaySlots({ dayOfWeek, isFeriado, excepcion }) {
  // Sunday: no slots ever
  if (dayOfWeek === 0) {
    return { slots: [], tag: 'normal' }
  }

  // Feriado takes precedence over everything (R-AV-02, SC-06).
  // Spec says zero slots on feriado — no morning, no afternoon.
  if (isFeriado) {
    return { slots: [], tag: 'normal' }
  }

  // Exception override
  if (excepcion) {
    const { ubicacion, hora_fin } = excepcion

    if (ubicacion === 'quito_extendido') {
      // Extend afternoon up to hora_fin (SC-04 inverse, ADR-4 step 3)
      const afternoon = buildSlots('15:00', hora_fin)
      return {
        slots: [...BASE_MORNING_SLOTS, ...afternoon],
        tag: 'normal',
      }
    }

    if (ubicacion === 'solo_virtual') {
      // Only virtual slots — use same time windows but tag them (SC-10, ADR-4 step 4)
      const afternoon = buildSlots('15:00', hora_fin)
      return {
        slots: [...BASE_MORNING_SLOTS, ...afternoon],
        tag: 'virtual_only',
      }
    }

    if (ubicacion === 'santo_domingo') {
      // SD presencial + virtual; no Quito presencial (SC-01, ADR-4 step 5)
      const afternoon = buildSlots('15:00', hora_fin)
      return {
        slots: [...BASE_MORNING_SLOTS, ...afternoon],
        tag: 'santo_domingo',
      }
    }
  }

  // Base schedule: no exception
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  const isSaturday = dayOfWeek === 6

  if (isWeekday) {
    return {
      slots: [...BASE_MORNING_SLOTS, ...BASE_AFTERNOON_SLOTS],
      tag: 'normal',
    }
  }

  if (isSaturday) {
    // Saturdays: morning only (existing behavior)
    return { slots: [...BASE_MORNING_SLOTS], tag: 'normal' }
  }

  return { slots: [], tag: 'normal' }
}

// ---------------------------------------------------------------------------
// Full range generator (used by tools.ts via inline delegation)
// ---------------------------------------------------------------------------

/**
 * Generate available slots for a date range.
 *
 * @param {object} params
 * @param {string} params.fechaInicio          'YYYY-MM-DD'
 * @param {string} params.fechaFin             'YYYY-MM-DD'
 * @param {Set<string>} params.feriadosSet     Set of 'YYYY-MM-DD' strings
 * @param {Map<string, object>} params.excepcionesMap  Map<'YYYY-MM-DD', excepcion row>
 * @param {Set<string>} params.occupiedSet     Set of 'YYYY-MM-DD_HH:MM' strings
 * @param {string|null} params.todayStr        'YYYY-MM-DD' or null (skip past-filter)
 * @param {string|null} params.currentHourStr  'HH:MM' or null
 * @param {number} [params.maxDays=14]
 * @returns {Record<string, { dia_semana: string; horarios: string[]; tag: string }>}
 */
export function generateSlots({
  fechaInicio,
  fechaFin,
  feriadosSet,
  excepcionesMap,
  occupiedSet,
  todayStr,
  currentHourStr,
  maxDays = 14,
}) {
  const DIAS_SEMANA = [
    'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
  ]

  const startObj = new Date(fechaInicio + 'T00:00:00')
  const endObj = new Date(fechaFin + 'T00:00:00')
  let current = new Date(startObj)

  const result = {}
  let dayCount = 0

  while (current <= endObj && dayCount <= maxDays) {
    const dateStr =
      current.getFullYear() +
      '-' +
      String(current.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(current.getDate()).padStart(2, '0')

    const dayOfWeek = current.getDay()

    if (dayOfWeek !== 0) {
      const isFeriado = feriadosSet.has(dateStr)
      const excepcion = excepcionesMap.get(dateStr) ?? null

      const { slots: allowedSlots, tag } = computeDaySlots({
        dayOfWeek,
        isFeriado,
        excepcion,
      })

      const validSlots = allowedSlots.filter((timeSlot) => {
        if (todayStr && dateStr === todayStr && currentHourStr && timeSlot <= currentHourStr) {
          return false
        }
        return !occupiedSet.has(`${dateStr}_${timeSlot}`)
      })

      if (validSlots.length > 0) {
        result[dateStr] = { dia_semana: DIAS_SEMANA[dayOfWeek], horarios: validSlots, tag }
      }
    }

    current.setDate(current.getDate() + 1)
    dayCount++
  }

  return result
}
