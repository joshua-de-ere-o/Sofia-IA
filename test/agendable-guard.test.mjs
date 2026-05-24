/**
 * test/agendable-guard.test.mjs
 * Tests that executeAgendarCita returns NO_AGENDABLE error (without DB insert)
 * when the service has agendable=false.
 *
 * Strategy: we import executeAgendarCita from a thin JS wrapper that doesn't
 * depend on Deno. Since tools.ts is Deno TS, we test the guard logic via a
 * dedicated testable module at lib/agendable-guard.js that contains ONLY the
 * guard function — pure, no Supabase, no Deno.
 *
 * The guard module is created as part of Grupo 3 implementation, but the test
 * must be written first (RED phase).
 *
 * RED: this will fail until lib/agendable-guard.js is created.
 */

import { describe, it, expect } from 'vitest'
import { checkAgendable } from '../lib/agendable-guard.js'
import { SERVICIOS } from '../lib/servicios.js'

describe('checkAgendable — guard for agendable=false services', () => {
  it('returns NO_AGENDABLE error for reduccion_medidas', () => {
    const result = checkAgendable('reduccion_medidas')
    expect(result).not.toBeNull()
    expect(result.error).toBe('NO_AGENDABLE')
    expect(result.servicio_id).toBe('reduccion_medidas')
    expect(result.accion_requerida).toBe('derivar_a_kelly')
    expect(typeof result.motivo_sugerido).toBe('string')
    expect(result.motivo_sugerido.length).toBeGreaterThan(0)
  })

  it('returns NO_AGENDABLE error for taller_empresarial', () => {
    const result = checkAgendable('taller_empresarial')
    expect(result).not.toBeNull()
    expect(result.error).toBe('NO_AGENDABLE')
    expect(result.servicio_id).toBe('taller_empresarial')
    expect(result.accion_requerida).toBe('derivar_a_kelly')
  })

  it('returns null (pass) for taller_individual (agendable: true)', () => {
    const result = checkAgendable('taller_individual')
    expect(result).toBeNull()
  })

  it('returns SERVICIO_DESCONOCIDO error for unknown service', () => {
    const result = checkAgendable('servicio_fantasma')
    expect(result).not.toBeNull()
    expect(result.error).toBe('SERVICIO_DESCONOCIDO')
  })

  it('returns null for all 12 agendable services', () => {
    const agendables = Object.values(SERVICIOS).filter(s => s.agendable)
    for (const s of agendables) {
      const result = checkAgendable(s.id)
      expect(result, `Expected null for agendable service ${s.id}`).toBeNull()
    }
  })

  it('returns NO_AGENDABLE for all 2 non-agendable services', () => {
    const nonAgendables = Object.values(SERVICIOS).filter(s => !s.agendable)
    expect(nonAgendables).toHaveLength(2)
    for (const s of nonAgendables) {
      const result = checkAgendable(s.id)
      expect(result, `Expected NO_AGENDABLE for ${s.id}`).not.toBeNull()
      expect(result.error).toBe('NO_AGENDABLE')
    }
  })
})
