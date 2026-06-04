/**
 * Shared timezone helpers for the clinic's local time (Ecuador, UTC-5).
 *
 * The whole product reasons about dates in `America/Guayaquil`, never UTC.
 * Using `new Date().toISOString()` to derive "today" is a bug: after 19:00
 * local the UTC date has already rolled over to tomorrow, so any default date
 * filter jumps a day ahead. Always go through these helpers in app code.
 *
 * Backend counterpart: `toGuayaquilParts` in
 * `supabase/functions/enviar-recordatorios/index.ts` (same Intl + timeZone).
 */

export const GUAYAQUIL_TZ = 'America/Guayaquil'

/**
 * Current local date in Guayaquil as 'YYYY-MM-DD'.
 *
 * `en-CA` formats dates as 'YYYY-MM-DD', so this returns the value directly
 * in the shape used by `citas.fecha` and `<input type="date">`.
 *
 * @param {Date} [now=new Date()] Injectable clock for tests.
 * @returns {string} 'YYYY-MM-DD' in America/Guayaquil.
 */
export function todayGuayaquil(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GUAYAQUIL_TZ }).format(now)
}
