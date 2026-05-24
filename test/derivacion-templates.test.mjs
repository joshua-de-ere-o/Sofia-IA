/**
 * test/derivacion-templates.test.mjs
 *
 * Tests for DERIVACION_TEMPLATES and the deriveDerivarAKelly pure logic.
 *
 * Strategy: same pattern as agendable-guard — pure testable module at
 * lib/derivacion.js; tools.ts runtime is NOT importable from Node (Deno TS).
 *
 * RED: this will fail until lib/derivacion.js is created.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDerivacion } from '../lib/derivacion.js'
import { DERIVACION_TEMPLATES } from '../lib/derivacion.js'

describe('DERIVACION_TEMPLATES', () => {
  it('exports all expected motivo keys', () => {
    const expected = [
      'reduccion_medidas',
      'taller_empresarial',
      'caso_clinico_complejo',
      'medicacion',
      'pago_disputa',
      'urgencia',
      'default',
    ]
    for (const key of expected) {
      expect(DERIVACION_TEMPLATES, `missing key: ${key}`).toHaveProperty(key)
      expect(typeof DERIVACION_TEMPLATES[key]).toBe('string')
      expect(DERIVACION_TEMPLATES[key].length).toBeGreaterThan(10)
    }
  })

  it('has exactly 7 templates', () => {
    expect(Object.keys(DERIVACION_TEMPLATES)).toHaveLength(7)
  })
})

describe('resolveDerivacion', () => {
  it('returns correct mensaje_paciente for reduccion_medidas', () => {
    const result = resolveDerivacion('reduccion_medidas')
    expect(result.mensaje_paciente).toBe(DERIVACION_TEMPLATES.reduccion_medidas)
    expect(result.mensaje_interno).toContain(DERIVACION_TEMPLATES.reduccion_medidas)
    expect(result.mensaje_interno).toContain('ENVÍA TEXTUAL')
  })

  it('returns correct mensaje_paciente for urgencia', () => {
    const result = resolveDerivacion('urgencia')
    expect(result.mensaje_paciente).toBe(DERIVACION_TEMPLATES.urgencia)
  })

  it('falls back to default for an unknown motivo', () => {
    const result = resolveDerivacion('motivo_inexistente')
    expect(result.mensaje_paciente).toBe(DERIVACION_TEMPLATES.default)
    expect(result.mensaje_interno).toContain(DERIVACION_TEMPLATES.default)
  })

  it('falls back to default when motivo is undefined', () => {
    const result = resolveDerivacion(undefined)
    expect(result.mensaje_paciente).toBe(DERIVACION_TEMPLATES.default)
  })

  it('mensaje_interno includes TEXTUAL instruction with exact mensaje_paciente', () => {
    const motivos = Object.keys(DERIVACION_TEMPLATES)
    for (const motivo of motivos) {
      const result = resolveDerivacion(motivo)
      expect(result.mensaje_interno, `motivo: ${motivo}`).toContain(result.mensaje_paciente)
      expect(result.mensaje_interno, `motivo: ${motivo}`).toContain('ENVÍA TEXTUAL')
    }
  })

  it('returns the same result shape for all valid motivos', () => {
    const motivos = Object.keys(DERIVACION_TEMPLATES)
    for (const motivo of motivos) {
      const result = resolveDerivacion(motivo)
      expect(result, `motivo: ${motivo}`).toHaveProperty('mensaje_paciente')
      expect(result, `motivo: ${motivo}`).toHaveProperty('mensaje_interno')
      expect(typeof result.mensaje_paciente).toBe('string')
      expect(typeof result.mensaje_interno).toBe('string')
    }
  })
})
