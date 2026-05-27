/**
 * test/calcular-precio.test.mjs
 * Backward compatibility tests for executeCalcularPrecio after catalog refactor.
 *
 * Strategy: same extraction approach — since we can't run Deno in Vitest,
 * we test the pure pricing logic via lib/calcular-precio-logic.js, which will
 * contain the price calculation extracted from tools.ts without Deno deps.
 *
 * RED: written before implementation.
 */

import { describe, it, expect } from 'vitest'
import { calcularPrecio } from '../lib/calcular-precio-logic.js'

describe('calcularPrecio — backward compat after catalog refactor', () => {
  it('alimentario_mensual + sur → precio_total=35, no adelanto', () => {
    const r = calcularPrecio('alimentario_mensual', 'sur')
    expect(r.error).toBeUndefined()
    expect(r.precio_total).toBe(35)
    expect(r.requiere_adelanto).toBe(false)
    expect(r.monto_adelanto).toBe(0)
  })

  it('alimentario_mensual + norte → precio_total=35, adelanto=17.5', () => {
    const r = calcularPrecio('alimentario_mensual', 'norte')
    expect(r.error).toBeUndefined()
    expect(r.precio_total).toBe(35)
    expect(r.requiere_adelanto).toBe(true)
    expect(r.monto_adelanto).toBe(17.5)
  })

  it('masaje + sur → precio_total=15, no adelanto', () => {
    const r = calcularPrecio('masaje', 'sur')
    expect(r.error).toBeUndefined()
    expect(r.precio_total).toBe(15)
    expect(r.requiere_adelanto).toBe(false)
    expect(r.monto_adelanto).toBe(0)
  })

  it('alimentario_quincenal + sur → precio_total=25, no adelanto', () => {
    const r = calcularPrecio('alimentario_quincenal', 'sur')
    expect(r.error).toBeUndefined()
    expect(r.precio_total).toBe(25)
    expect(r.requiere_adelanto).toBe(false)
    expect(r.monto_adelanto).toBe(0)
  })

  it('alimentario_quincenal + norte → adelanto=12.5', () => {
    const r = calcularPrecio('alimentario_quincenal', 'norte')
    expect(r.precio_total).toBe(25)
    expect(r.monto_adelanto).toBe(12.5)
  })

  it('trimestral + valle → precio_total=95, adelanto=47.5', () => {
    const r = calcularPrecio('trimestral', 'valle')
    expect(r.precio_total).toBe(95)
    expect(r.monto_adelanto).toBe(47.5)
  })

  it('any service + domicilio → precio_total=40, monto_adelanto=20', () => {
    const r = calcularPrecio('alimentario_mensual', 'domicilio')
    expect(r.precio_total).toBe(40)
    expect(r.monto_adelanto).toBe(20)
  })

  it('returns SERVICIO_DESCONOCIDO for unknown service', () => {
    const r = calcularPrecio('no_existe', 'sur')
    expect(r.error).toBe('SERVICIO_DESCONOCIDO')
  })

  it('returns error for unknown zone', () => {
    const r = calcularPrecio('masaje', 'marte')
    expect(r.error).toBeDefined()
  })

  // Legacy IDs should return SERVICIO_DESCONOCIDO (they no longer exist)
  it('legacy id "mensual" returns SERVICIO_DESCONOCIDO', () => {
    const r = calcularPrecio('mensual', 'sur')
    expect(r.error).toBe('SERVICIO_DESCONOCIDO')
  })

  it('legacy id "quincenal" returns SERVICIO_DESCONOCIDO', () => {
    const r = calcularPrecio('quincenal', 'sur')
    expect(r.error).toBe('SERVICIO_DESCONOCIDO')
  })

  it('legacy id "premium" returns SERVICIO_DESCONOCIDO', () => {
    const r = calcularPrecio('premium', 'sur')
    expect(r.error).toBe('SERVICIO_DESCONOCIDO')
  })

  // santo_domingo zone — R-PR-01: same tier as norte/sur
  it('alimentario_mensual + santo_domingo → precio same as norte, adelanto=17.5 (R-PR-01)', () => {
    const r = calcularPrecio('alimentario_mensual', 'santo_domingo')
    expect(r.error).toBeUndefined()
    expect(r.precio_total).toBe(35)
    expect(r.requiere_adelanto).toBe(true)
    expect(r.monto_adelanto).toBe(17.5)
  })

  it('santo_domingo zone is accepted (no zona inválida error) (R-PR-02)', () => {
    const r = calcularPrecio('masaje', 'santo_domingo')
    expect(r.error).toBeUndefined()
  })
})
