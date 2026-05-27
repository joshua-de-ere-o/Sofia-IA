/**
 * test/parse-appointment-date.test.mjs
 *
 * Vitest unit tests for parseSpanishDate — the deterministic date parser
 * used by the parse_appointment_date agent tool.
 *
 * TDD RED phase: all tests written before implementation.
 *
 * Import target: lib/parse-spanish-date.js (pure JS, no Deno deps).
 *
 * Covers:
 *   - DD/MM/AAAA (slash separator)
 *   - DD-MM-AAAA (dash separator)
 *   - 'hoy' / 'mañana' / 'ayer' / 'pasado mañana'
 *   - 'el lunes', 'el martes', … (next weekday, forced future)
 *   - 'DD de <mes>' (current year)
 *   - 'DD de <mes> de YYYY'
 *   - bare 'el 3' → ok:false (ambiguous, no month)
 *   - 29/02 on non-leap year → ok:false
 *   - invalid month name → ok:false
 *   - year < 1900 → ok:false
 *   - year > 2100 → ok:false
 *   - invalid day (0, 32) → ok:false
 */

import { describe, it, expect } from 'vitest'
import { parseSpanishDate } from '../lib/parse-spanish-date.js'

// Fixed reference date for deterministic tests: Wednesday 2026-05-27
const TODAY = '2026-05-27'

describe('parseSpanishDate — numeric formats', () => {
  it('parses DD/MM/AAAA', () => {
    const result = parseSpanishDate('15/03/1990', TODAY)
    expect(result).toEqual({ ok: true, date: '1990-03-15' })
  })

  it('parses DD-MM-AAAA', () => {
    const result = parseSpanishDate('15-03-1990', TODAY)
    expect(result).toEqual({ ok: true, date: '1990-03-15' })
  })

  it('parses single-digit day and month DD/MM/AAAA', () => {
    const result = parseSpanishDate('3/6/2026', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-06-03' })
  })

  it('rejects 29/02 on non-leap year', () => {
    const result = parseSpanishDate('29/02/2025', TODAY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/fecha_invalida/)
  })

  it('accepts 29/02 on leap year', () => {
    const result = parseSpanishDate('29/02/2024', TODAY)
    expect(result).toEqual({ ok: true, date: '2024-02-29' })
  })

  it('rejects year < 1900', () => {
    const result = parseSpanishDate('01/01/1899', TODAY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/anio_invalido/)
  })

  it('rejects year > 2100', () => {
    const result = parseSpanishDate('01/01/2101', TODAY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/anio_invalido/)
  })

  it('rejects day 0', () => {
    const result = parseSpanishDate('00/05/2026', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects day 32', () => {
    const result = parseSpanishDate('32/05/2026', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects month 0', () => {
    const result = parseSpanishDate('15/00/2026', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects month 13', () => {
    const result = parseSpanishDate('15/13/2026', TODAY)
    expect(result.ok).toBe(false)
  })
})

describe('parseSpanishDate — relative keywords', () => {
  it('parses "hoy"', () => {
    expect(parseSpanishDate('hoy', TODAY)).toEqual({ ok: true, date: '2026-05-27' })
  })

  it('parses "mañana"', () => {
    expect(parseSpanishDate('mañana', TODAY)).toEqual({ ok: true, date: '2026-05-28' })
  })

  it('parses "manana" (without accent)', () => {
    expect(parseSpanishDate('manana', TODAY)).toEqual({ ok: true, date: '2026-05-28' })
  })

  it('parses "ayer"', () => {
    expect(parseSpanishDate('ayer', TODAY)).toEqual({ ok: true, date: '2026-05-26' })
  })

  it('parses "pasado mañana"', () => {
    expect(parseSpanishDate('pasado mañana', TODAY)).toEqual({ ok: true, date: '2026-05-29' })
  })

  it('parses "pasado manana" (without accent)', () => {
    expect(parseSpanishDate('pasado manana', TODAY)).toEqual({ ok: true, date: '2026-05-29' })
  })
})

describe('parseSpanishDate — weekday expressions', () => {
  // TODAY is Wednesday 2026-05-27
  it('parses "el lunes" → next Monday 2026-06-01', () => {
    const result = parseSpanishDate('el lunes', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-06-01' })
  })

  it('parses "el viernes" → next Friday 2026-05-29', () => {
    const result = parseSpanishDate('el viernes', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-05-29' })
  })

  it('parses "el miércoles" → next Wednesday (7 days out since today IS Wednesday)', () => {
    // Today is Wednesday; "el miércoles" means the NEXT one, not today
    const result = parseSpanishDate('el miércoles', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-06-03' })
  })

  it('parses "el sabado" without accent', () => {
    const result = parseSpanishDate('el sabado', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-05-30' })
  })
})

describe('parseSpanishDate — "DD de <mes>" patterns', () => {
  it('parses "3 de junio" → 2026-06-03 (current year)', () => {
    const result = parseSpanishDate('3 de junio', TODAY)
    expect(result).toEqual({ ok: true, date: '2026-06-03' })
  })

  it('parses "15 de marzo de 2025"', () => {
    const result = parseSpanishDate('15 de marzo de 2025', TODAY)
    expect(result).toEqual({ ok: true, date: '2025-03-15' })
  })

  it('parses "1 de enero de 2027"', () => {
    const result = parseSpanishDate('1 de enero de 2027', TODAY)
    expect(result).toEqual({ ok: true, date: '2027-01-01' })
  })

  it('rejects invalid month name', () => {
    const result = parseSpanishDate('3 de jolio', TODAY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/mes_invalido/)
  })

  it('rejects "el 3" with no month context → ok:false', () => {
    const result = parseSpanishDate('el 3', TODAY)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/formato_no_reconocido/)
  })
})

describe('parseSpanishDate — unrecognized formats', () => {
  it('rejects "enero del 95" (ambiguous 2-digit year)', () => {
    const result = parseSpanishDate('enero del 95', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects "01-01-95" (2-digit year)', () => {
    const result = parseSpanishDate('01-01-95', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects empty string', () => {
    const result = parseSpanishDate('', TODAY)
    expect(result.ok).toBe(false)
  })

  it('rejects pure text with no date', () => {
    const result = parseSpanishDate('no sé la fecha', TODAY)
    expect(result.ok).toBe(false)
  })
})
