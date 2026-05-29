/**
 * test/verificar-datos-paciente.test.mjs
 *
 * Vitest unit tests for the verificarDatosPaciente logic.
 *
 * TDD RED phase: tests written before implementation.
 *
 * Import target: lib/verificar-datos-paciente.js
 * This module exports applyMatchDecision(rows, fromNumber) and the
 * full verificarDatosPaciente(args, supabase) function.
 *
 * Covers:
 *   - 1 row, score >= 0.85, telefono IS NULL → match:'unique', mode_suggested:'auto_update'
 *   - 1 row, score >= 0.85, telefono IS NOT NULL, differs from from_number → mode_suggested:'request_approval'
 *   - 1 row, telefono equals from_number → match:'unique', mode_suggested:'already_up_to_date'
 *   - 0 rows → match:'none'
 *   - 2+ rows → match:'multiple'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyMatchDecision, applyRescueDecision, buildNameVariants, verificarDatosPaciente } from '../lib/verificar-datos-paciente.js'

// ─── applyMatchDecision (pure) ──────────────────────────────────────────────

describe('applyMatchDecision — pure decision logic', () => {
  it('builds conservative shortened-name variants from a full legal name', () => {
    expect(buildNameVariants('María Fernanda García López')).toEqual([
      'María Fernanda García López',
      'María García López',
    ])
  })

  it('returns match:none for empty rows', () => {
    const result = applyMatchDecision([], '+593999000001')
    expect(result.match).toBe('none')
  })

  it('returns match:multiple for 2+ rows when time was already collected', () => {
    const rows = [
      { id: 'uuid-1', nombre: 'Juan Perez', telefono: null, score: 0.91 },
      { id: 'uuid-2', nombre: 'Juana Perez', telefono: null, score: 0.86 },
    ]
    const result = applyMatchDecision(rows, '+593999000001', { timeProvided: true })
    expect(result.match).toBe('multiple')
    expect(result.candidates).toHaveLength(2)
  })

  it('returns match:needs_time_tiebreaker for 2+ rows when time was not provided', () => {
    const rows = [
      { id: 'uuid-1', nombre: 'Juan Perez', telefono: null, hora: '09:00:00', score: 1 },
      { id: 'uuid-2', nombre: 'Juan Perez', telefono: null, hora: '10:00:00', score: 1 },
    ]
    const result = applyMatchDecision(rows, '+593999000001', { timeProvided: false })
    expect(result.match).toBe('needs_time_tiebreaker')
    expect(result.candidates).toEqual([
      { id: 'uuid-1', nombre: 'Juan Perez', fecha: null, hora: '09:00:00', score: 1 },
      { id: 'uuid-2', nombre: 'Juan Perez', fecha: null, hora: '10:00:00', score: 1 },
    ])
  })

  it('returns match:multiple for 2+ rows when time was already provided', () => {
    const rows = [
      { id: 'uuid-1', nombre: 'Juan Perez', telefono: null, hora: '09:00:00', score: 1 },
      { id: 'uuid-2', nombre: 'Juan Perez', telefono: null, hora: '09:00:00', score: 1 },
    ]
    const result = applyMatchDecision(rows, '+593999000001', { timeProvided: true })
    expect(result.match).toBe('multiple')
    expect(result.candidates).toHaveLength(2)
  })

  it('returns match:unique + mode_suggested:auto_update when telefono is null', () => {
    const rows = [{ id: 'uuid-1', nombre: 'Maria Lopez', telefono: null, score: 0.92 }]
    const result = applyMatchDecision(rows, '+593999000001')
    expect(result.match).toBe('unique')
    expect(result.paciente_id).toBe('uuid-1')
    expect(result.mode_suggested).toBe('auto_update')
    expect(result.existing_telefono).toBeNull()
  })

  it('returns match:unique + mode_suggested:auto_update when telefono is empty string', () => {
    const rows = [{ id: 'uuid-1', nombre: 'Maria Lopez', telefono: '', score: 0.92 }]
    const result = applyMatchDecision(rows, '+593999000001')
    expect(result.match).toBe('unique')
    expect(result.mode_suggested).toBe('auto_update')
  })

  it('returns match:unique + mode_suggested:request_approval when telefono differs', () => {
    const rows = [{ id: 'uuid-1', nombre: 'Carlos Ruiz', telefono: '+593999000099', score: 0.88 }]
    const result = applyMatchDecision(rows, '+593999000001')
    expect(result.match).toBe('unique')
    expect(result.paciente_id).toBe('uuid-1')
    expect(result.mode_suggested).toBe('request_approval')
    expect(result.existing_telefono).toBe('+593999000099')
  })

  it('returns match:unique + mode_suggested:already_up_to_date when telefono matches from_number', () => {
    const rows = [{ id: 'uuid-1', nombre: 'Ana Torres', telefono: '+593999000001', score: 0.95 }]
    const result = applyMatchDecision(rows, '+593999000001')
    expect(result.match).toBe('unique')
    expect(result.mode_suggested).toBe('already_up_to_date')
  })
})

describe('applyRescueDecision — nearby appointment rescue', () => {
  it('returns needs_context_rescue when a nearby appointment exists', () => {
    const result = applyRescueDecision([
      { id: 'uuid-r1', nombre: 'María García López', fecha: '2026-06-16', hora: '11:00:00', score: 0.6 },
    ], { dateProvided: true })

    expect(result.match).toBe('needs_context_rescue')
    expect(result.candidates).toEqual([
      { id: 'uuid-r1', nombre: 'María García López', fecha: '2026-06-16', hora: '11:00:00', score: 0.6 },
    ])
  })

  it('returns none with no_relevant_appointment when rescue also fails', () => {
    const result = applyRescueDecision([], { dateProvided: false })
    expect(result.match).toBe('none')
    expect(result.reason).toBe('no_relevant_appointment')
  })
})

// ─── verificarDatosPaciente (integration with mocked supabase.rpc) ───────────

function makeRpcMock(rows) {
  return {
    rpc: vi.fn(async (_fn, _args) => ({ data: rows, error: null })),
  }
}

function makeRpcResponder(resolver) {
  return {
    rpc: vi.fn(async (_fn, args) => ({ data: resolver(args), error: null })),
  }
}

describe('verificarDatosPaciente — with mocked RPC', () => {
  it('returns match:none when RPC returns 0 rows', async () => {
    const supabase = makeRpcMock([])
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Juan Nadie', fecha_cita: '2026-06-01', from_number: '+593999000001' },
      supabase
    )
    expect(result.match).toBe('none')
    expect(supabase.rpc).toHaveBeenCalledWith('verificar_paciente_match', {
      p_nombre: 'Juan Nadie',
      p_fecha_cita: '2026-06-01',
      p_allow_nearby: false,
    })
  })

  it('passes hora_cita to RPC only when provided and resolves a unique tiebreaker match', async () => {
    const rows = [{ id: 'uuid-c', nombre: 'Maria Garcia', telefono: null, hora: '09:30:00', score: 1 }]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Maria Garcia', fecha_cita: '2026-06-05', hora_cita: '09:30:00', from_number: '+593987654321' },
      supabase
    )

    expect(result.match).toBe('unique')
    expect(result.mode_suggested).toBe('auto_update')
    expect(supabase.rpc).toHaveBeenCalledWith('verificar_paciente_match', {
      p_nombre: 'Maria Garcia',
      p_fecha_cita: '2026-06-05',
      p_hora_cita: '09:30:00',
      p_allow_nearby: false,
    })
  })

  it('returns needs_time_tiebreaker when name+date still has multiple candidates', async () => {
    const rows = [
      { id: 'uuid-a', nombre: 'Ana Lopez', telefono: null, hora: '09:00:00', score: 1 },
      { id: 'uuid-b', nombre: 'Ana Lopez', telefono: null, hora: '10:00:00', score: 1 },
    ]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Ana Lopez', fecha_cita: '2026-06-05', from_number: '+593987654321' },
      supabase
    )

    expect(result.match).toBe('needs_time_tiebreaker')
    expect(result.candidates).toHaveLength(2)
  })

  it('returns needs_time_tiebreaker when RPC returns 2 rows without hora_cita', async () => {
    const rows = [
      { id: 'uuid-a', nombre: 'Juan P', telefono: null, score: 0.90 },
      { id: 'uuid-b', nombre: 'Juana P', telefono: null, score: 0.86 },
    ]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Juan P', fecha_cita: '2026-06-01', from_number: '+593999000001' },
      supabase
    )
    expect(result.match).toBe('needs_time_tiebreaker')
  })

  it('returns match:unique + auto_update for a single null-phone match', async () => {
    const rows = [{ id: 'uuid-c', nombre: 'Maria Garcia', telefono: null, score: 0.93 }]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Maria Garcia', fecha_cita: '2026-06-05', from_number: '+593987654321' },
      supabase
    )
    expect(result.match).toBe('unique')
    expect(result.mode_suggested).toBe('auto_update')
    expect(result.paciente_id).toBe('uuid-c')
  })

  it('returns match:unique + request_approval for a single differing-phone match', async () => {
    const rows = [{ id: 'uuid-d', nombre: 'Pedro Ramirez', telefono: '+593999000099', score: 0.89 }]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Pedro Ramirez', fecha_cita: '2026-06-10', from_number: '+593999000001' },
      supabase
    )
    expect(result.match).toBe('unique')
    expect(result.mode_suggested).toBe('request_approval')
    expect(result.existing_telefono).toBe('+593999000099')
  })

  it('handles RPC error gracefully', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: new Error('DB timeout') })),
    }
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Test', fecha_cita: '2026-06-01', from_number: '+593000000000' },
      supabase
    )
    expect(result.match).toBe('error')
    expect(result.reason).toBeDefined()
  })

  it('falls back to a shorter stored appointment-name variant before giving up', async () => {
    const supabase = makeRpcResponder((args) => {
      if (args.p_nombre === 'María Fernanda García López' && args.p_allow_nearby === false) {
        return []
      }
      if (args.p_nombre === 'María García López' && args.p_allow_nearby === false) {
        return [{ id: 'uuid-short', nombre: 'María García López', telefono: null, fecha: '2026-06-15', hora: '09:00:00', score: 1 }]
      }
      return []
    })

    const result = await verificarDatosPaciente(
      { nombre_completo: 'María Fernanda García López', fecha_cita: '2026-06-15', from_number: '+593999000001' },
      supabase
    )

    expect(result.match).toBe('unique')
    expect(result.paciente_id).toBe('uuid-short')
  })

  it('returns needs_context_rescue when the provided date misses but a nearby appointment exists', async () => {
    const supabase = makeRpcResponder((args) => {
      if (args.p_allow_nearby === false) return []
      return [{ id: 'uuid-near', nombre: 'María García López', telefono: null, fecha: '2026-06-16', hora: '11:00:00', score: 0.6 }]
    })

    const result = await verificarDatosPaciente(
      { nombre_completo: 'María García López', fecha_cita: '2026-06-15', from_number: '+593999000001' },
      supabase
    )

    expect(result.match).toBe('needs_context_rescue')
    expect(result.reason).toBe('date_mismatch_or_nearby_context')
  })

  it('returns needs_context_rescue when the patient forgot the date but a nearby upcoming appointment exists', async () => {
    const supabase = makeRpcResponder((args) => {
      if (args.p_allow_nearby === true && args.p_fecha_cita === null) {
        return [{ id: 'uuid-upcoming', nombre: 'Ana Torres', telefono: null, fecha: '2026-06-20', hora: '08:30:00', score: 0.5 }]
      }
      return []
    })

    const result = await verificarDatosPaciente(
      { nombre_completo: 'Ana Torres', from_number: '+593999000001' },
      supabase
    )

    expect(result.match).toBe('needs_context_rescue')
    expect(result.reason).toBe('date_missing_nearby_context')
    expect(supabase.rpc).toHaveBeenCalledWith('verificar_paciente_match', {
      p_nombre: 'Ana Torres',
      p_fecha_cita: null,
      p_allow_nearby: true,
    })
  })
})
