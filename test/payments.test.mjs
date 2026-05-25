/**
 * test/payments.test.mjs
 *
 * Unit tests for lib/payments.js — simplified uploadComprobante.
 * Written FIRST (TDD RED phase) before implementation.
 *
 * Contract after PR 2 simplification:
 *   uploadComprobante(senderNumber, wamid, imageUrl)
 *     → { success: true, publicUrl, image_path }
 *     → { success: false, error: string }
 *
 * All approval/state logic has been removed — that lives in agent-runner (PR 3).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Supabase mock factory ---
function makeSupabaseMock({ uploadError = null, pacienteData = null, pacienteError = null, citaData = null, citaError = null } = {}) {
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://storage.example.com/comprobantes/pago_test.jpg' } }))
  const upload = vi.fn(async () => ({ data: { path: 'pago_test.jpg' }, error: uploadError }))

  const storageMock = {
    from: vi.fn(() => ({
      upload,
      getPublicUrl,
    })),
  }

  // Fluent query builder mock
  function makeQuery(data, error) {
    const obj = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data, error })),
    }
    return obj
  }

  const fromMock = vi.fn((table) => {
    if (table === 'pacientes') return makeQuery(pacienteData, pacienteError)
    if (table === 'citas') return makeQuery(citaData, citaError)
    return makeQuery(null, new Error(`Unexpected table: ${table}`))
  })

  return {
    storage: storageMock,
    from: fromMock,
  }
}

// Mock fetch (for downloading the image from YCloud)
function makeFetchMock(ok = true) {
  const blob = { arrayBuffer: async () => new ArrayBuffer(8) }
  return vi.fn(async () => ({ ok, blob: async () => blob }))
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@supabase/supabase-js'

let fetchSpy

beforeEach(() => {
  vi.clearAllMocks()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock())
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
})

describe('uploadComprobante — happy path', () => {
  it('returns success with publicUrl and image_path', async () => {
    const supabase = makeSupabaseMock({
      pacienteData: { id: 'paciente-123' },
      citaData: { id: 'cita-456', servicio: 'Consulta', monto_adelanto: 17.5 },
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=1')
    const result = await uploadComprobante('+593999000111', 'wamid-abc123', 'https://ycloud.example.com/image.jpg')

    expect(result.success).toBe(true)
    expect(result.publicUrl).toBeDefined()
    expect(result.image_path).toBeDefined()
    // image_path must be deterministic and include the wamid
    expect(result.image_path).toContain('wamid-abc123')
  })

  it('uses deterministic filename based on wamid (not Date.now)', async () => {
    const supabase = makeSupabaseMock({
      pacienteData: { id: 'paciente-123' },
      citaData: { id: 'cita-456', servicio: 'Consulta', monto_adelanto: 17.5 },
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=2')
    const result = await uploadComprobante('+593999000111', 'wamid-xyz999', 'https://ycloud.example.com/img.jpg')

    expect(result.success).toBe(true)
    expect(result.image_path).toBe('pago_wamid-xyz999.jpg')
  })

  it('returns citaId and pacienteId along with upload data', async () => {
    const supabase = makeSupabaseMock({
      pacienteData: { id: 'paciente-777' },
      citaData: { id: 'cita-888', servicio: 'Nutricion', monto_adelanto: 25 },
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=3')
    const result = await uploadComprobante('+593999000222', 'wamid-ret001', 'https://example.com/img.jpg')

    expect(result.success).toBe(true)
    expect(result.citaId).toBe('cita-888')
    expect(result.pacienteId).toBe('paciente-777')
  })
})

describe('uploadComprobante — missing patient', () => {
  it('returns error when paciente not found', async () => {
    const supabase = makeSupabaseMock({
      pacienteData: null,
      pacienteError: new Error('not found'),
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=4')
    const result = await uploadComprobante('+593000000000', 'wamid-nope', 'https://example.com/img.jpg')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/paciente/i)
  })
})

describe('uploadComprobante — missing cita', () => {
  it('returns error when no pendiente_pago cita found', async () => {
    const supabase = makeSupabaseMock({
      pacienteData: { id: 'paciente-exists' },
      citaData: null,
      citaError: new Error('no cita'),
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=5')
    const result = await uploadComprobante('+593111000000', 'wamid-nocita', 'https://example.com/img.jpg')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/cita/i)
  })
})

describe('uploadComprobante — does NOT touch cita estado', () => {
  it('does NOT call supabase.from("citas").update()', async () => {
    const updateSpy = vi.fn()
    const supabase = makeSupabaseMock({
      pacienteData: { id: 'paciente-123' },
      citaData: { id: 'cita-456', servicio: 'Consulta', monto_adelanto: 17.5 },
    })
    // Override to spy on update calls
    const originalFrom = supabase.from.bind(supabase)
    supabase.from = vi.fn((table) => {
      const q = originalFrom(table)
      q.update = updateSpy
      return q
    })
    createClient.mockReturnValue(supabase)

    const { uploadComprobante } = await import('../lib/payments.js?v=6')
    await uploadComprobante('+593999000111', 'wamid-nostate', 'https://example.com/img.jpg')

    expect(updateSpy).not.toHaveBeenCalled()
  })
})
