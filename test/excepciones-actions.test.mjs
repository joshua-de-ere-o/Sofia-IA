/**
 * test/excepciones-actions.test.mjs  (T-41)
 *
 * Unit tests for the excepcion server action logic:
 *   - conflict detection blocks save when presencial Quito citas exist (SC-08, ADR-2)
 *   - no conflict = success path (SC-09)
 *   - overlap detection when excepcion already exists for a date (ADR-3)
 *   - range expansion to N rows (R-UI-03, ADR-3)
 *   - validation errors: missing fields, fecha_fin < fecha_inicio, hora_fin out of range (SC-08, SC-09)
 *
 * Strategy: extract pure logic functions from a separate testable module
 * (lib/excepciones-logic.js) so no Supabase client or Next.js Server Actions
 * machinery is needed.
 *
 * RED phase: written before implementation.
 */

import { describe, it, expect } from 'vitest'
import {
  validateExcepcionInput,
  expandDateRange,
  detectConflicts,
  detectOverlaps,
} from '../lib/excepciones-logic.js'

// ---------------------------------------------------------------------------
// validateExcepcionInput
// ---------------------------------------------------------------------------

describe('validateExcepcionInput', () => {
  it('returns ok for a valid single-day input', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-09',
      ubicacion: 'santo_domingo',
      hora_fin: '19:30',
    })
    expect(result.ok).toBe(true)
  })

  it('returns ok for a valid multi-day range', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-11',
      ubicacion: 'quito_extendido',
      hora_fin: '20:00',
    })
    expect(result.ok).toBe(true)
  })

  it('returns error when fecha_inicio is missing', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '',
      fecha_fin: '2026-06-09',
      ubicacion: 'santo_domingo',
      hora_fin: '19:30',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('returns error when fecha_fin < fecha_inicio (SC-14)', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-10',
      fecha_fin: '2026-06-09',
      ubicacion: 'santo_domingo',
      hora_fin: '19:30',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/fecha/i)
  })

  it('returns error for invalid ubicacion', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-09',
      ubicacion: 'invalid_zone',
      hora_fin: '19:30',
    })
    expect(result.ok).toBe(false)
  })

  it('returns error when hora_fin is <= 12:00 (must be after morning close)', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-09',
      ubicacion: 'quito_extendido',
      hora_fin: '12:00',
    })
    expect(result.ok).toBe(false)
  })

  it('returns error when hora_fin > 21:00 (hard ceiling per design §5)', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-09',
      ubicacion: 'quito_extendido',
      hora_fin: '21:01',
    })
    expect(result.ok).toBe(false)
  })

  it('returns ok for hora_fin exactly at 21:00', () => {
    const result = validateExcepcionInput({
      fecha_inicio: '2026-06-09',
      fecha_fin: '2026-06-09',
      ubicacion: 'solo_virtual',
      hora_fin: '21:00',
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// expandDateRange
// ---------------------------------------------------------------------------

describe('expandDateRange', () => {
  it('returns a single date when inicio === fin', () => {
    const dates = expandDateRange('2026-06-09', '2026-06-09')
    expect(dates).toEqual(['2026-06-09'])
  })

  it('returns N dates for a multi-day range (R-UI-03, ADR-3)', () => {
    const dates = expandDateRange('2026-06-09', '2026-06-11')
    expect(dates).toEqual(['2026-06-09', '2026-06-10', '2026-06-11'])
  })

  it('returns dates in ascending order', () => {
    const dates = expandDateRange('2026-06-01', '2026-06-03')
    expect(dates[0] < dates[1]).toBe(true)
    expect(dates[1] < dates[2]).toBe(true)
  })

  it('returns empty array when fin < inicio', () => {
    const dates = expandDateRange('2026-06-11', '2026-06-09')
    expect(dates).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detectConflicts (ADR-2, SC-08, SC-09)
//
// Conflict = existing presencial (non-virtual) citas agendada/confirmada
// on a date in the range, WHEN the new exception would remove presencial Quito.
// quito_extendido NEVER conflicts (it only adds slots).
// ---------------------------------------------------------------------------

describe('detectConflicts', () => {
  const makeQuitoCita = (fecha) => ({
    cita_id: `cita-${fecha}`,
    fecha,
    hora_inicio: '10:00',
    modalidad: 'presencial',
    zona: 'norte',
    paciente_nombre: 'Juan Pérez',
    paciente_telefono: '0991234567',
  })

  const makeVirtualCita = (fecha) => ({
    cita_id: `cita-v-${fecha}`,
    fecha,
    hora_inicio: '09:00',
    modalidad: 'virtual',
    zona: 'virtual',
    paciente_nombre: 'Ana García',
    paciente_telefono: '0997654321',
  })

  const makeSdCita = (fecha) => ({
    cita_id: `cita-sd-${fecha}`,
    fecha,
    hora_inicio: '11:00',
    modalidad: 'presencial',
    zona: 'santo_domingo',
    paciente_nombre: 'Pedro López',
    paciente_telefono: '0999999999',
  })

  it('detects conflict for santo_domingo when Quito presencial cita exists (SC-08)', () => {
    const citas = [makeQuitoCita('2026-06-10')]
    const conflicts = detectConflicts(citas, 'santo_domingo')
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].cita_id).toBe('cita-2026-06-10')
  })

  it('no conflict for santo_domingo when only virtual citas exist (SC-09)', () => {
    const citas = [makeVirtualCita('2026-06-15')]
    const conflicts = detectConflicts(citas, 'santo_domingo')
    expect(conflicts.length).toBe(0)
  })

  it('detects conflict for solo_virtual when presencial cita exists', () => {
    const citas = [makeQuitoCita('2026-06-10')]
    const conflicts = detectConflicts(citas, 'solo_virtual')
    expect(conflicts.length).toBe(1)
  })

  it('detects conflict for solo_virtual when SD presencial cita exists', () => {
    const citas = [makeSdCita('2026-06-10')]
    const conflicts = detectConflicts(citas, 'solo_virtual')
    expect(conflicts.length).toBe(1)
  })

  it('no conflict for quito_extendido — never blocks any zone (ADR-2)', () => {
    const citas = [makeQuitoCita('2026-06-10')]
    const conflicts = detectConflicts(citas, 'quito_extendido')
    expect(conflicts.length).toBe(0)
  })

  it('handles multi-date range — reports all conflicting citas across range (R-UI-06)', () => {
    const citas = [
      makeQuitoCita('2026-06-09'),
      makeQuitoCita('2026-06-10'),
    ]
    const conflicts = detectConflicts(citas, 'santo_domingo')
    expect(conflicts.length).toBe(2)
  })

  it('returns empty array when there are no citas at all', () => {
    const conflicts = detectConflicts([], 'santo_domingo')
    expect(conflicts.length).toBe(0)
  })

  it('no conflict for santo_domingo when only SD-zone citas exist (SD stays allowed)', () => {
    // SD presencial is NOT Quito, so no conflict for santo_domingo excepcion
    const citas = [makeSdCita('2026-06-10')]
    const conflicts = detectConflicts(citas, 'santo_domingo')
    expect(conflicts.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// detectOverlaps (ADR-3)
//
// Overlap = an existing excepcion already exists for one of the dates in range.
// ---------------------------------------------------------------------------

describe('detectOverlaps', () => {
  const makeExcepcion = (fecha) => ({
    id: `exc-${fecha}`,
    fecha,
    ubicacion: 'quito_extendido',
    hora_fin: '19:00',
  })

  it('detects overlap when existing excepcion covers one of the new dates', () => {
    const existing = [makeExcepcion('2026-06-10')]
    const newDates = ['2026-06-09', '2026-06-10', '2026-06-11']
    const overlaps = detectOverlaps(newDates, existing)
    expect(overlaps).toContain('2026-06-10')
    expect(overlaps.length).toBe(1)
  })

  it('returns empty array when no existing excepciones overlap', () => {
    const existing = [makeExcepcion('2026-06-15')]
    const newDates = ['2026-06-09', '2026-06-10']
    const overlaps = detectOverlaps(newDates, existing)
    expect(overlaps.length).toBe(0)
  })

  it('returns all overlapping dates when multiple existing excepciones conflict', () => {
    const existing = [makeExcepcion('2026-06-09'), makeExcepcion('2026-06-11')]
    const newDates = ['2026-06-09', '2026-06-10', '2026-06-11']
    const overlaps = detectOverlaps(newDates, existing)
    expect(overlaps.length).toBe(2)
    expect(overlaps).toContain('2026-06-09')
    expect(overlaps).toContain('2026-06-11')
  })

  it('returns empty array when there are no existing excepciones', () => {
    const overlaps = detectOverlaps(['2026-06-09'], [])
    expect(overlaps.length).toBe(0)
  })
})
