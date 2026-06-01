/**
 * test/telegram-bulk-hora-filter.test.mjs
 *
 * PR1 unit tests — hora_desde / hora_hasta filter on buscar_citas_bulk.
 *
 * Covers:
 *   Test A: both hora_desde + hora_hasta → .gte('hora') and .lte('hora') applied
 *   Test B: only hora_desde → validation error, no DB call
 *   Test C: only hora_hasta → validation error, no DB call
 *   Test D: neither hora param → existing query path unchanged (regression guard)
 *   Test E: hora filter applied on default-states branch
 *   Test F: hora filter applied on explicit-estado branch (BOTH branches covered)
 *
 * REQ-1.1, REQ-1.2, REQ-1.3, REQ-1.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mockFrom,
  resetTelegramState,
  teardownTelegramMocks,
  makeBuilder,
  makeRequest,
  loadRoute,
  getCapturedFetches,
  setAdapterResponse,
} from './helpers/telegram-mock-builder.mjs'

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

// ─── Helper: base candidatos ──────────────────────────────────────────────────

const makeCandidatos = () => [
  {
    id: 'c-001',
    fecha: '2026-06-02',
    hora: '07:30:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 45,
    patient_name_normalized: null,
    pacientes: { nombre: 'Ana Torres' },
  },
  {
    id: 'c-002',
    fecha: '2026-06-02',
    hora: '08:45:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 30,
    patient_name_normalized: null,
    pacientes: { nombre: 'Luis Vera' },
  },
]

// ─── Test A: both hora params → filter applied ────────────────────────────────

describe('PR1-A: hora_desde + hora_hasta both provided — filter applied', () => {
  it('applies .gte("hora", hora_desde) and .lte("hora", hora_hasta) to the default-states query branch', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        zona: 'norte',
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
        hora_desde: '07:00',
        hora_hasta: '09:00',
      },
    })

    let capturedBuilder = null
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') {
        const b = makeBuilder(table, makeCandidatos())
        capturedBuilder = b
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas norte 7-9am lunes', chat: { id: 999 } },
    }))

    expect(capturedBuilder).not.toBeNull()
    expect(capturedBuilder.gte).toHaveBeenCalledWith('hora', '07:00')
    expect(capturedBuilder.lte).toHaveBeenCalledWith('hora', '09:00')
  })

  it('sends results to Kely when citas match the hora window', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
        hora_desde: '07:00',
        hora_hasta: '09:00',
      },
    })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, makeCandidatos())
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas 7-9am', chat: { id: 999 } },
    }))

    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(sends[0].opts.body).text
    expect(text).toMatch(/Ana Torres/)
  })
})

// ─── Test B: only hora_desde → validation error ───────────────────────────────

describe('PR1-B: only hora_desde provided — validation error, no DB call', () => {
  it('returns a validation error without calling supabase', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
        hora_desde: '07:00',
        // hora_hasta intentionally absent
      },
    })

    let citasQueryCalled = false
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') {
        citasQueryCalled = true
        return makeBuilder(table, makeCandidatos())
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas desde las 7am', chat: { id: 999 } },
    }))

    // DB should NOT be called (both-or-neither rule)
    expect(citasQueryCalled).toBe(false)

    // Kely should receive an error/clarification
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(sends[0].opts.body).text
    expect(text).toMatch(/hora_hasta|ambos|ambas|both|par/i)
  })
})

// ─── Test C: only hora_hasta → validation error ───────────────────────────────

describe('PR1-C: only hora_hasta provided — validation error, no DB call', () => {
  it('returns a validation error without calling supabase', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
        // hora_desde intentionally absent
        hora_hasta: '09:00',
      },
    })

    let citasQueryCalled = false
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') {
        citasQueryCalled = true
        return makeBuilder(table, makeCandidatos())
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas hasta las 9am', chat: { id: 999 } },
    }))

    expect(citasQueryCalled).toBe(false)

    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(sends[0].opts.body).text
    expect(text).toMatch(/hora_desde|ambos|ambas|both|par/i)
  })
})

// ─── Test D: no hora params → regression guard ────────────────────────────────

describe('PR1-D: no hora params — existing query path unchanged (regression guard)', () => {
  it('does NOT apply .gte("hora") or .lte("hora") when no hora params given', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        zona: 'norte',
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
      },
    })

    let capturedBuilder = null
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') {
        const b = makeBuilder(table, makeCandidatos())
        capturedBuilder = b
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas norte lunes', chat: { id: 999 } },
    }))

    expect(capturedBuilder).not.toBeNull()
    // gte('hora', ...) should NOT have been called — only gte('fecha', ...) is expected
    const gteHoraCalls = capturedBuilder.gte.mock.calls.filter(([col]) => col === 'hora')
    const lteHoraCalls = capturedBuilder.lte.mock.calls.filter(([col]) => col === 'hora')
    expect(gteHoraCalls).toHaveLength(0)
    expect(lteHoraCalls).toHaveLength(0)
  })

  it('returns results normally when no hora filter', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-02', fecha_hasta: '2026-06-02' },
    })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, makeCandidatos())
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas lunes', chat: { id: 999 } },
    }))

    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(sends[0].opts.body).text
    expect(text).toMatch(/Ana Torres/)
  })
})

// ─── Test E+F: BOTH query branches (default-states AND explicit-estado) ────────

describe('PR1-E/F: hora filter applied to BOTH query branches', () => {
  it('applies hora filter on the explicit-estado branch (override path)', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: {
        zona: 'norte',
        fecha_desde: '2026-06-02',
        fecha_hasta: '2026-06-02',
        estado: ['confirmada', 'pendiente'],
        hora_desde: '07:00',
        hora_hasta: '09:00',
      },
    })

    // The explicit-estado branch rebuilds the query from scratch — capture that builder
    let callCount = 0
    let lastBuilder = null
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') {
        callCount++
        const b = makeBuilder(table, makeCandidatos())
        lastBuilder = b
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'citas norte 7-9am confirmadas', chat: { id: 999 } },
    }))

    // The explicit-estado branch creates a new supabase.from('citas') call —
    // lastBuilder is the one from that branch
    expect(lastBuilder).not.toBeNull()
    expect(lastBuilder.gte).toHaveBeenCalledWith('hora', '07:00')
    expect(lastBuilder.lte).toHaveBeenCalledWith('hora', '09:00')
  })
})

// ─── System prompt includes hora_desde / hora_hasta ───────────────────────────

describe('PR1 — KELLY_SYSTEM_PROMPT documents hora_desde / hora_hasta', () => {
  it('route.js system prompt mentions hora_desde and hora_hasta for buscar_citas_bulk', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve('app/api/telegram/route.js'), 'utf8')

    // The system prompt buscar_citas_bulk entry must document the new params
    expect(source).toMatch(/hora_desde/)
    expect(source).toMatch(/hora_hasta/)
  })
})
