/**
 * test/catalogo.test.mjs
 * Validates the shape and invariants of CATALOGO_SERVICIOS in lib/servicios.js.
 * RED: written before implementation — expected to fail until Grupo 1 is done.
 */

import { describe, it, expect } from 'vitest'
import { SERVICIOS, getServicioLabel, getServicioPrecio, getServicio } from '../lib/servicios.js'

const REQUIRED_FIELDS = [
  'id', 'label', 'precio', 'duracion_min', 'categoria',
  'agendable', 'modalidades', 'zonas_permitidas',
  'requiere_adelanto', 'permite_combo', 'derivacion_motivo',
]

const EXPECTED_IDS = [
  'alimentario_quincenal',
  'alimentario_mensual',
  'alimentario_exclusivo',
  'trimestral',
  'virtual',
  'inbody',
  'deportivo_quincenal',
  'deportivo_mensual',
  'deportivo_exclusivo',
  'masaje',
  'taller_individual',
  'taller_grupal',
  'taller_empresarial',
  'reduccion_medidas',
]

describe('CATALOGO_SERVICIOS — shape and invariants', () => {
  it('contains exactly 14 services', () => {
    expect(Object.keys(SERVICIOS)).toHaveLength(14)
  })

  it('contains exactly the expected 14 IDs', () => {
    const ids = Object.keys(SERVICIOS).sort()
    expect(ids).toEqual(EXPECTED_IDS.slice().sort())
  })

  it('has exactly 12 agendable and 2 non-agendable services', () => {
    const values = Object.values(SERVICIOS)
    const agendable = values.filter(s => s.agendable === true)
    const nonAgendable = values.filter(s => s.agendable === false)
    expect(agendable).toHaveLength(12)
    expect(nonAgendable).toHaveLength(2)
  })

  it('non-agendable services are exactly taller_empresarial and reduccion_medidas', () => {
    const nonAgendable = Object.values(SERVICIOS)
      .filter(s => s.agendable === false)
      .map(s => s.id)
      .sort()
    expect(nonAgendable).toEqual(['reduccion_medidas', 'taller_empresarial'])
  })

  it('every service has all required fields with non-undefined values', () => {
    for (const servicio of Object.values(SERVICIOS)) {
      for (const field of REQUIRED_FIELDS) {
        expect(servicio[field], `${servicio.id}.${field} must not be undefined`).not.toBeUndefined()
      }
    }
  })

  it('every agendable service has duracion_min > 0', () => {
    for (const servicio of Object.values(SERVICIOS)) {
      if (servicio.agendable) {
        expect(
          typeof servicio.duracion_min === 'number' && servicio.duracion_min > 0,
          `${servicio.id}.duracion_min must be > 0 when agendable`
        ).toBe(true)
      }
    }
  })

  it('every non-agendable service has derivacion_motivo not null', () => {
    for (const servicio of Object.values(SERVICIOS)) {
      if (!servicio.agendable) {
        expect(
          servicio.derivacion_motivo,
          `${servicio.id}.derivacion_motivo must not be null when agendable=false`
        ).not.toBeNull()
      }
    }
  })

  it('every non-agendable service has duracion_min === null', () => {
    for (const servicio of Object.values(SERVICIOS)) {
      if (!servicio.agendable) {
        expect(servicio.duracion_min, `${servicio.id}.duracion_min must be null when agendable=false`).toBeNull()
      }
    }
  })

  it('modalidades array is non-empty for every service', () => {
    for (const servicio of Object.values(SERVICIOS)) {
      expect(Array.isArray(servicio.modalidades), `${servicio.id}.modalidades must be array`).toBe(true)
      expect(servicio.modalidades.length, `${servicio.id}.modalidades must not be empty`).toBeGreaterThan(0)
    }
  })
})

describe('getServicioLabel', () => {
  it('returns label for alimentario_quincenal', () => {
    expect(getServicioLabel('alimentario_quincenal')).toBe('Plan Alimentario Quincenal')
  })

  it('returns the id itself for unknown ids (not undefined)', () => {
    expect(getServicioLabel('id_raro')).toBe('id_raro')
    expect(getServicioLabel('id_raro')).not.toBeUndefined()
  })

  it('returns empty string for empty/nullish input', () => {
    expect(getServicioLabel('')).toBe('')
    expect(getServicioLabel(null)).toBe('')
    expect(getServicioLabel(undefined)).toBe('')
  })
})

describe('getServicioPrecio', () => {
  it('returns 35 for alimentario_mensual', () => {
    expect(getServicioPrecio('alimentario_mensual')).toBe(35)
  })

  it('returns 15 for masaje', () => {
    expect(getServicioPrecio('masaje')).toBe(15)
  })

  it('returns null for unknown id', () => {
    expect(getServicioPrecio('id_raro')).toBeNull()
  })
})

describe('getServicio', () => {
  it('returns full object for valid id', () => {
    const s = getServicio('masaje')
    expect(s).not.toBeNull()
    expect(s.id).toBe('masaje')
    expect(s.agendable).toBe(true)
  })

  it('returns null for unknown id', () => {
    expect(getServicio('id_raro')).toBeNull()
  })
})
