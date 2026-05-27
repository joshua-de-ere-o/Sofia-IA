/**
 * lib/parse-spanish-date.js
 *
 * Deterministic Spanish date parser for the parse_appointment_date agent tool.
 * Pure JS — no external dependencies, no Deno APIs. Usable in Node (Vitest)
 * and importable from agent-runner/tools.ts via a relative path.
 *
 * Returns:
 *   { ok: true,  date: "YYYY-MM-DD" }
 *   { ok: false, reason: string }
 *
 * Hard rule: NEVER guesses when ambiguous. If the format is not recognized
 * exactly, returns ok:false. Bare "el 3" (no month) → ok:false.
 */

// Ecuador Spanish month names → 1-indexed month number
const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4,
  mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // common abbreviations
  ene: 1, feb: 2, mar: 3, abr: 4,
  jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
}

// Day-of-week names → JS getDay() index (0=Sunday)
const DIAS_SEMANA = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
}

/**
 * Checks whether the given year is a leap year.
 */
function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Returns the number of days in the given month/year.
 */
function daysInMonth(year, month) {
  const days = [0, 31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month]
}

/**
 * Validates a calendar date and returns ISO string or error.
 * year, month (1-12), day (1-31)
 */
function mkDate(year, month, day) {
  if (year < 1900 || year > 2100) {
    return { ok: false, reason: 'anio_invalido' }
  }
  if (month < 1 || month > 12) {
    return { ok: false, reason: 'mes_invalido' }
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, reason: 'fecha_invalida' }
  }
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return { ok: true, date: `${year}-${mm}-${dd}` }
}

/**
 * Returns a new Date offset by `days` from `base`.
 * Operates in UTC to avoid timezone-shift side effects.
 */
function addDays(base, days) {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * Converts a Date to ISO yyyy-mm-dd string (UTC date parts).
 */
function dateToIso(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return { ok: true, date: `${y}-${m}-${day}` }
}

/**
 * Parses today_iso ("YYYY-MM-DD") into a UTC Date anchored at noon
 * to avoid any DST-adjacent off-by-one when manipulating UTC dates.
 */
function parseToday(today_iso) {
  // Parse as UTC noon to be timezone-safe
  return new Date(today_iso + 'T12:00:00Z')
}

/**
 * Returns the next occurrence of the given weekday (0=Sun…6=Sat)
 * AFTER today (never returns today itself).
 */
function nextWeekday(today, targetDay) {
  const todayDay = today.getUTCDay()
  let diff = targetDay - todayDay
  if (diff <= 0) diff += 7 // always future, never today
  return addDays(today, diff)
}

/**
 * Main export. Parses `text` (free-form Spanish) relative to `today_iso`
 * ("YYYY-MM-DD") and returns a parse result.
 *
 * @param {string} text
 * @param {string} today_iso
 * @returns {{ ok: true, date: string } | { ok: false, reason: string }}
 */
export function parseSpanishDate(text, today_iso) {
  if (!text || typeof text !== 'string') {
    return { ok: false, reason: 'formato_no_reconocido' }
  }

  const today = parseToday(today_iso)
  const t = text.trim().toLowerCase()

  if (!t) return { ok: false, reason: 'formato_no_reconocido' }

  // ── 1. Numeric DD/MM/AAAA or DD-MM-AAAA ──────────────────────────────────
  // Must be exactly 4-digit year to avoid "01-01-95" matching.
  const numericMatch = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (numericMatch) {
    return mkDate(+numericMatch[3], +numericMatch[2], +numericMatch[1])
  }

  // ── 2. Relative keywords ──────────────────────────────────────────────────
  if (t === 'hoy') return dateToIso(today)
  if (t === 'mañana' || t === 'manana') return dateToIso(addDays(today, 1))
  if (t === 'ayer') return dateToIso(addDays(today, -1))
  if (t === 'pasado mañana' || t === 'pasado manana') return dateToIso(addDays(today, 2))
  if (t === 'antes de ayer' || t === 'anteayer') return dateToIso(addDays(today, -2))

  // ── 3. Weekday expressions: "el lunes", "este viernes", "el próximo martes" ─
  // Match: optional prefix (el|este|el próximo) + weekday name
  const weekdayMatch = t.match(/^(?:el\s+pr[oó]ximo\s+|este\s+|el\s+)?([a-záéíóúü]+)$/)
  if (weekdayMatch) {
    const dayName = weekdayMatch[1]
    if (dayName in DIAS_SEMANA) {
      const targetDay = DIAS_SEMANA[dayName]
      return dateToIso(nextWeekday(today, targetDay))
    }
  }

  // ── 4. "DD de <mes>" or "DD de <mes> de YYYY" ────────────────────────────
  const spanishDateMatch = t.match(/^(\d{1,2})\s+de\s+([a-záéíóúü]+)(?:\s+de\s+(\d{4}))?$/)
  if (spanishDateMatch) {
    const day = +spanishDateMatch[1]
    const mesName = spanishDateMatch[2]
    const month = MESES[mesName]
    if (!month) return { ok: false, reason: 'mes_invalido' }
    const year = spanishDateMatch[3] ? +spanishDateMatch[3] : today.getUTCFullYear()
    return mkDate(year, month, day)
  }

  // ── 5. Everything else is ambiguous → bail ────────────────────────────────
  return { ok: false, reason: 'formato_no_reconocido' }
}
