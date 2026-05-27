/**
 * test/slot-generator.test.mjs  (T-40)
 *
 * Unit tests for lib/slot-generator.js.
 *
 * Covers spec scenarios (per design ADR-4 interpretation table):
 *   SC-01 / SC-04 — santo_domingo exception opens SD+virtual slots, not base slots
 *   SC-05         — virtual slots remain available on a santo_domingo day
 *   SC-06         — feriado takes precedence over excepcion (R-AV-02)
 *   SC-07         — occupied slots are filtered even under an exception
 *   SC-10         — solo_virtual suppresses all presencial (tag=virtual_only)
 *   SC-11         — single Map lookup per day (no extra queries inside generator)
 *
 * Also covers:
 *   quito_extendido afternoon extension
 *   Saturday base (morning only)
 *   Sunday always empty
 *   Base weekday schedule (no exception)
 *
 * Strategy: pure JS function — no Deno, no Supabase, no mocks needed.
 */

import { describe, it, expect } from 'vitest'
import {
  computeDaySlots,
  generateSlots,
  buildSlots,
  BASE_MORNING_SLOTS,
  BASE_AFTERNOON_SLOTS,
} from '../lib/slot-generator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal excepcion row */
function exc(ubicacion, hora_fin) {
  return { ubicacion, hora_fin, fecha: '2026-06-09' }
}

/** Convert sorted slot array to a Set for order-agnostic comparisons */
function slotSet(slots) {
  return new Set(slots)
}

// ---------------------------------------------------------------------------
// buildSlots helper
// ---------------------------------------------------------------------------

describe('buildSlots', () => {
  it('15:00 to 17:00 → [15:00, 15:30, 16:00, 16:30]', () => {
    expect(buildSlots('15:00', '17:00')).toEqual(['15:00', '15:30', '16:00', '16:30'])
  })

  it('15:00 to 19:30 → 9 slots ending at 19:00', () => {
    const slots = buildSlots('15:00', '19:30')
    expect(slots[0]).toBe('15:00')
    expect(slots[slots.length - 1]).toBe('19:00')
    expect(slots).toHaveLength(9)
  })

  it('empty when startTime >= endTime', () => {
    expect(buildSlots('17:00', '17:00')).toEqual([])
    expect(buildSlots('18:00', '17:00')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeDaySlots — base schedule (no exception)
// ---------------------------------------------------------------------------

describe('computeDaySlots — base schedule', () => {
  it('Sunday → empty slots', () => {
    const { slots } = computeDaySlots({ dayOfWeek: 0, isFeriado: false, excepcion: null })
    expect(slots).toHaveLength(0)
  })

  it('Monday (no exception, no feriado) → morning + afternoon', () => {
    const { slots, tag } = computeDaySlots({ dayOfWeek: 1, isFeriado: false, excepcion: null })
    expect(tag).toBe('normal')
    expect(slots).toEqual([...BASE_MORNING_SLOTS, ...BASE_AFTERNOON_SLOTS])
  })

  it('Saturday (no exception, no feriado) → morning only', () => {
    const { slots, tag } = computeDaySlots({ dayOfWeek: 6, isFeriado: false, excepcion: null })
    expect(tag).toBe('normal')
    expect(slots).toEqual(BASE_MORNING_SLOTS)
  })

  it('Weekday + feriado → zero slots (SC-06 / R-AV-02: no slots on feriado)', () => {
    const { slots, tag } = computeDaySlots({ dayOfWeek: 1, isFeriado: true, excepcion: null })
    expect(tag).toBe('normal')
    expect(slots).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeDaySlots — quito_extendido
// ---------------------------------------------------------------------------

describe('computeDaySlots — quito_extendido', () => {
  it('quito_extendido hora_fin=19:30 → morning + extended afternoon ending at 19:00', () => {
    const { slots, tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('quito_extendido', '19:30'),
    })
    expect(tag).toBe('normal')
    expect(slots).toContain('08:00')
    expect(slots).toContain('15:00')
    expect(slots).toContain('19:00')
    expect(slots).not.toContain('19:30') // last slot is hora_fin - 30min
  })

  it('quito_extendido hora_fin=17:00 → afternoon same as base (15:00–16:30)', () => {
    const { slots } = computeDaySlots({
      dayOfWeek: 2,
      isFeriado: false,
      excepcion: exc('quito_extendido', '17:00'),
    })
    // 15:00, 15:30, 16:00, 16:30 — same as base afternoon
    const afternoon = slots.filter((s) => s >= '15:00')
    expect(afternoon).toEqual(['15:00', '15:30', '16:00', '16:30'])
  })
})

// ---------------------------------------------------------------------------
// computeDaySlots — solo_virtual  (SC-10)
// ---------------------------------------------------------------------------

describe('computeDaySlots — solo_virtual (SC-10)', () => {
  it('tag is virtual_only', () => {
    const { tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('solo_virtual', '17:00'),
    })
    expect(tag).toBe('virtual_only')
  })

  it('generates time slots (caller responsible for presencial filtering)', () => {
    const { slots } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('solo_virtual', '17:00'),
    })
    expect(slots).toContain('08:00')
    expect(slots).toContain('15:00')
    expect(slots.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// computeDaySlots — santo_domingo (SC-01 / SC-04 / SC-05)
// ---------------------------------------------------------------------------

describe('computeDaySlots — santo_domingo (SC-01, SC-04, SC-05)', () => {
  it('tag is santo_domingo', () => {
    const { tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('santo_domingo', '19:30'),
    })
    expect(tag).toBe('santo_domingo')
  })

  it('SC-01: generates slots from 08:00 to 19:00 (hora_fin=19:30)', () => {
    const { slots } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('santo_domingo', '19:30'),
    })
    expect(slots).toContain('08:00')
    expect(slots).toContain('19:00')
    expect(slots).not.toContain('19:30')
  })

  it('SC-04: without exception, 18:00 is outside base schedule (not in slots)', () => {
    // Base weekday schedule ends at 16:30; 18:00 would not appear
    const { slots } = computeDaySlots({ dayOfWeek: 1, isFeriado: false, excepcion: null })
    expect(slots).not.toContain('18:00')
  })

  it('SC-05: virtual slots are available (tag=santo_domingo, not virtual_only; caller shows both SD+virtual)', () => {
    // The tag 'santo_domingo' signals: show SD presencial + virtual; suppress Quito presencial
    // Virtual slots are NOT suppressed — this is the whole point of ADR-1
    const { tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: false,
      excepcion: exc('santo_domingo', '19:00'),
    })
    expect(tag).toBe('santo_domingo')
    expect(tag).not.toBe('virtual_only')
  })
})

// ---------------------------------------------------------------------------
// computeDaySlots — feriado precedence (SC-06)
// ---------------------------------------------------------------------------

describe('computeDaySlots — feriado beats excepcion (SC-06, R-AV-02)', () => {
  it('SC-06: feriado + santo_domingo exception → zero slots (feriado wins)', () => {
    const { slots, tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: true,
      excepcion: exc('santo_domingo', '19:30'),
    })
    expect(tag).toBe('normal')
    // Spec R-AV-02 / SC-06: feriado wins → NO slots offered at all
    expect(slots).toEqual([])
    expect(slots).not.toContain('08:00')
    expect(slots).not.toContain('15:00')
  })

  it('feriado + quito_extendido → zero slots (feriado wins)', () => {
    const { slots } = computeDaySlots({
      dayOfWeek: 2,
      isFeriado: true,
      excepcion: exc('quito_extendido', '21:00'),
    })
    expect(slots).toEqual([])
  })

  it('feriado + solo_virtual → zero slots + tag=normal (feriado wins, not virtual_only)', () => {
    const { slots, tag } = computeDaySlots({
      dayOfWeek: 3,
      isFeriado: true,
      excepcion: exc('solo_virtual', '17:00'),
    })
    expect(tag).toBe('normal')
    expect(slots).toEqual([])
  })

  it('feriado with no excepcion → zero slots', () => {
    const { slots, tag } = computeDaySlots({
      dayOfWeek: 1,
      isFeriado: true,
      excepcion: null,
    })
    expect(tag).toBe('normal')
    expect(slots).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// generateSlots — integration (SC-07, SC-11)
// ---------------------------------------------------------------------------

describe('generateSlots — full range generator', () => {
  it('SC-07: occupied slot is filtered even under a santo_domingo exception', () => {
    // 2026-06-09 is a Tuesday (dayOfWeek=2)
    const fecha = '2026-06-09'
    const feriadosSet = new Set()
    const excepcionesMap = new Map([[fecha, { ubicacion: 'santo_domingo', hora_fin: '19:30', fecha }]])
    const occupiedSet = new Set([`${fecha}_16:00`])

    const result = generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet,
      excepcionesMap,
      occupiedSet,
      todayStr: null,
      currentHourStr: null,
    })

    expect(result[fecha]).toBeDefined()
    expect(result[fecha].horarios).not.toContain('16:00')
    expect(result[fecha].horarios).toContain('15:30')
    expect(result[fecha].horarios).toContain('16:30')
  })

  it('SC-11: excepcionesMap is read via Map.get() — O(1) per day (no extra queries in loop)', () => {
    // This test validates the API contract: generateSlots receives a pre-built Map
    // and does NOT perform any I/O. The Promise.all that builds the Map happens
    // BEFORE calling generateSlots (verified structurally in tools.ts review).
    // We spy on Map.prototype.get to confirm it is called exactly once per day.
    const fecha = '2026-06-09'
    const excepcionesMap = new Map([[fecha, { ubicacion: 'quito_extendido', hora_fin: '19:30', fecha }]])

    const getCalls = []
    const originalGet = excepcionesMap.get.bind(excepcionesMap)
    excepcionesMap.get = (key) => {
      getCalls.push(key)
      return originalGet(key)
    }

    generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet: new Set(),
      excepcionesMap,
      occupiedSet: new Set(),
      todayStr: null,
      currentHourStr: null,
    })

    // Should call .get exactly once for the single date in the range
    expect(getCalls).toHaveLength(1)
    expect(getCalls[0]).toBe(fecha)
  })

  it('feriado date is absent from full range result (zero slots → date omitted)', () => {
    const fecha = '2026-06-09'
    const feriadosSet = new Set([fecha])
    const excepcionesMap = new Map()

    const result = generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet,
      excepcionesMap,
      occupiedSet: new Set(),
      todayStr: null,
      currentHourStr: null,
    })

    // 2026-06-09 is Tuesday — feriado → zero slots → not included in result (R-AV-02 / SC-06)
    expect(result[fecha]).toBeUndefined()
  })

  it('no exception weekday returns morning + afternoon', () => {
    const fecha = '2026-06-09' // Tuesday
    const result = generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet: new Set(),
      excepcionesMap: new Map(),
      occupiedSet: new Set(),
      todayStr: null,
      currentHourStr: null,
    })

    expect(result[fecha].horarios).toEqual([...BASE_MORNING_SLOTS, ...BASE_AFTERNOON_SLOTS])
    expect(result[fecha].tag).toBe('normal')
  })

  it('tag is propagated to output record', () => {
    const fecha = '2026-06-09'
    const excepcionesMap = new Map([
      [fecha, { ubicacion: 'solo_virtual', hora_fin: '17:00', fecha }],
    ])

    const result = generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet: new Set(),
      excepcionesMap,
      occupiedSet: new Set(),
      todayStr: null,
      currentHourStr: null,
    })

    expect(result[fecha].tag).toBe('virtual_only')
  })

  it('past slots for today are filtered out', () => {
    const fecha = '2026-06-09'
    const result = generateSlots({
      fechaInicio: fecha,
      fechaFin: fecha,
      feriadosSet: new Set(),
      excepcionesMap: new Map(),
      occupiedSet: new Set(),
      todayStr: fecha,
      currentHourStr: '09:30', // slots at 08:00, 08:30, 09:00, 09:30 should be filtered
    })

    const horarios = result[fecha]?.horarios ?? []
    expect(horarios).not.toContain('08:00')
    expect(horarios).not.toContain('09:30')
    expect(horarios).toContain('10:00')
  })
})
