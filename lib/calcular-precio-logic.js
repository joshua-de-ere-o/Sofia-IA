/**
 * lib/calcular-precio-logic.js
 * Pure price calculation logic extracted from executeCalcularPrecio (tools.ts).
 * tools.ts delegates to this for testability. No Deno or Supabase deps.
 */

import { getServicio, SERVICIOS } from './servicios.js'

const ZONAS_VALIDAS = ['sur', 'norte', 'virtual', 'valle', 'domicilio', 'santo_domingo']

/**
 * Calculates precio_total and monto_adelanto for a service + zone combination.
 * Mirrors the logic in executeCalcularPrecio (tools.ts).
 * @param {string} servicio_id
 * @param {string} zona
 * @returns {object} pricing result or error
 */
export function calcularPrecio(servicio_id, zona) {
  if (!servicio_id || !zona) {
    return { error: 'Faltan parámetros: servicio_id o zona' }
  }

  const servicio = getServicio(servicio_id)
  if (!servicio) {
    return {
      error: 'SERVICIO_DESCONOCIDO',
      servicio_id,
      allowed: Object.keys(SERVICIOS),
    }
  }

  if (!ZONAS_VALIDAS.includes(zona)) {
    return { error: 'zona inválida', received: zona, allowed: ZONAS_VALIDAS }
  }

  let precio_base = servicio.precio
  let ajuste_zona = 0
  let precio_total = precio_base
  let requiere_adelanto = servicio.requiere_adelanto
  let monto_adelanto = 0

  if (zona === 'domicilio') {
    // Flat fee for domicilio — overrides service price
    precio_base = 40
    precio_total = 40
    ajuste_zona = 0
    requiere_adelanto = true
  } else if (zona === 'valle') {
    ajuste_zona = 5
    precio_total += ajuste_zona
  }

  if (zona === 'sur') {
    requiere_adelanto = false
    monto_adelanto = 0
  } else if (zona === 'domicilio') {
    monto_adelanto = 20 // 50% of 40
  } else {
    monto_adelanto = requiere_adelanto ? precio_total * 0.5 : 0
  }

  return {
    precio_base,
    ajuste_zona,
    precio_total,
    requiere_adelanto,
    monto_adelanto,
  }
}
