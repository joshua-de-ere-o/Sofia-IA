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
import { applyMatchDecision, verificarDatosPaciente } from '../lib/verificar-datos-paciente.js'

// ─── applyMatchDecision (pure) ──────────────────────────────────────────────

describe('applyMatchDecision — pure decision logic', () => {
  it('returns match:none for empty rows', () => {
    const result = applyMatchDecision([], '+593999000001')
    expect(result.match).toBe('none')
  })

  it('returns match:multiple for 2+ rows', () => {
    const rows = [
      { id: 'uuid-1', nombre: 'Juan Perez', telefono: null, score: 0.91 },
      { id: 'uuid-2', nombre: 'Juana Perez', telefono: null, score: 0.86 },
    ]
    const result = applyMatchDecision(rows, '+593999000001')
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

// ─── verificarDatosPaciente (integration with mocked supabase.rpc) ───────────

function makeRpcMock(rows) {
  return {
    rpc: vi.fn(async (_fn, _args) => ({ data: rows, error: null })),
  }
}

describe('verificarDatosPaciente — with mocked RPC', () => {
  it('returns match:none when RPC returns 0 rows', async () => {
    const supabase = makeRpcMock([])
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Juan Nadie', fecha_cita: '2026-06-01', fecha_nacimiento: '1990-01-01', from_number: '+593999000001' },
      supabase
    )
    expect(result.match).toBe('none')
    expect(supabase.rpc).toHaveBeenCalledWith('verificar_paciente_match', {
      p_nombre: 'Juan Nadie',
      p_fecha_cita: '2026-06-01',
    })
  })

  it('returns match:multiple when RPC returns 2 rows', async () => {
    const rows = [
      { id: 'uuid-a', nombre: 'Juan P', telefono: null, score: 0.90 },
      { id: 'uuid-b', nombre: 'Juana P', telefono: null, score: 0.86 },
    ]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Juan P', fecha_cita: '2026-06-01', fecha_nacimiento: '1990-01-01', from_number: '+593999000001' },
      supabase
    )
    expect(result.match).toBe('multiple')
  })

  it('returns match:unique + auto_update for a single null-phone match', async () => {
    const rows = [{ id: 'uuid-c', nombre: 'Maria Garcia', telefono: null, score: 0.93 }]
    const supabase = makeRpcMock(rows)
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Maria Garcia', fecha_cita: '2026-06-05', fecha_nacimiento: '1985-03-20', from_number: '+593987654321' },
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
      { nombre_completo: 'Pedro Ramirez', fecha_cita: '2026-06-10', fecha_nacimiento: '1978-07-15', from_number: '+593999000001' },
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
      { nombre_completo: 'Test', fecha_cita: '2026-06-01', fecha_nacimiento: '1990-01-01', from_number: '+593000000000' },
      supabase
    )
    expect(result.match).toBe('error')
    expect(result.reason).toBeDefined()
  })
})
