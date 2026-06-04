/**
 * test/guayaquil-date.test.mjs
 *
 * Vitest unit tests for todayGuayaquil — the shared helper that computes the
 * clinic's local date (America/Guayaquil, UTC-5).
 *
 * Import target: lib/date/guayaquil.js (pure JS, no Deno deps).
 *
 * Regression guard for the dashboard bug where "today" was derived from
 * `new Date().toISOString()` (UTC). After 19:00 local the UTC date rolls over
 * to the next day, so the default date filter showed tomorrow's appointments.
 */

import { describe, it, expect } from 'vitest'
import { todayGuayaquil, GUAYAQUIL_TZ } from '../lib/date/guayaquil.js'

describe('todayGuayaquil', () => {
  it('uses the America/Guayaquil timezone', () => {
    expect(GUAYAQUIL_TZ).toBe('America/Guayaquil')
  })

  it('returns the same calendar day during Ecuadorian daytime', () => {
    // 2026-06-04 15:00 UTC === 2026-06-04 10:00 in Guayaquil
    const now = new Date('2026-06-04T15:00:00Z')
    expect(todayGuayaquil(now)).toBe('2026-06-04')
  })

  it('still returns "today" late at night in Ecuador (the bug)', () => {
    // 2026-06-05 02:00 UTC === 2026-06-04 21:00 in Guayaquil.
    // toISOString() would have returned 2026-06-05 (tomorrow) — the bug.
    const now = new Date('2026-06-05T02:00:00Z')
    expect(todayGuayaquil(now)).toBe('2026-06-04')
  })

  it('returns the next day only once Guayaquil actually crosses midnight', () => {
    // 2026-06-05 05:00 UTC === 2026-06-05 00:00 in Guayaquil
    const now = new Date('2026-06-05T05:00:00Z')
    expect(todayGuayaquil(now)).toBe('2026-06-05')
  })

  it('formats as YYYY-MM-DD', () => {
    const now = new Date('2026-01-09T15:00:00Z')
    expect(todayGuayaquil(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayGuayaquil(now)).toBe('2026-01-09')
  })
})
