/**
 * test/conversaciones-delete.test.mjs
 *
 * Unit tests para el validador de la server action deleteConversaciones.
 * La maquinaria de Supabase/Next no se testea acá — solo la lógica pura,
 * mismo enfoque que excepciones-actions.test.mjs.
 */

import { describe, it, expect } from 'vitest'
import { validateConversacionIds } from '../lib/conversaciones-actions-logic.js'

describe('validateConversacionIds', () => {
  it('acepta una lista de ids válida', () => {
    const r = validateConversacionIds(['a', 'b'])
    expect(r.ok).toBe(true)
    expect(r.ids).toEqual(['a', 'b'])
  })

  it('rechaza un array vacío', () => {
    const r = validateConversacionIds([])
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  })

  it('rechaza cuando no es un array', () => {
    expect(validateConversacionIds(null).ok).toBe(false)
    expect(validateConversacionIds(undefined).ok).toBe(false)
    expect(validateConversacionIds('abc').ok).toBe(false)
    expect(validateConversacionIds({}).ok).toBe(false)
  })

  it('rechaza ids no-string o vacíos', () => {
    expect(validateConversacionIds(['a', 2]).ok).toBe(false)
    expect(validateConversacionIds(['a', '']).ok).toBe(false)
    expect(validateConversacionIds(['a', '   ']).ok).toBe(false)
    expect(validateConversacionIds(['a', null]).ok).toBe(false)
  })

  it('deduplica ids repetidos', () => {
    const r = validateConversacionIds(['a', 'a', 'b'])
    expect(r.ok).toBe(true)
    expect(r.ids).toEqual(['a', 'b'])
  })
})
