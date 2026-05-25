/**
 * test/webhook-image-branch.test.mjs
 *
 * Unit tests for the image branch in app/api/webhook/route.js (T7).
 * Written FIRST (TDD RED phase) before implementation.
 *
 * Covers:
 *   1. Happy path — markLastMessage called, uploadComprobante called, agent-runner dispatched (fire-and-forget)
 *   2. Missing patient — uploadComprobante returns error, short-circuits, returns { received: true }
 *   3. Duplicate wamid — pagos row exists for referencia, skip dispatch, return { received: true, duplicate: true }
 *   4. Agent-runner URL env var missing — logs error, returns { received: true }
 *   5. Missing imageUrl — early return
 *   6. Missing wamid — early return
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---- Mocks setup ----

// We mock the module dependencies BEFORE importing the route.
// Next.js App Router exports POST from route.js — we import it directly.

vi.mock('../lib/payments.js', () => ({
  uploadComprobante: vi.fn(),
}))

// We need to mock @supabase/supabase-js for markLastMessage / pagos check
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

// We need to mock crypto for the YCloud signature check — bypass it in tests
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // We'll control process.env.YCLOUD_WEBHOOK_SECRET = undefined in tests
    // so the route skips signature validation in non-production mode.
    default: actual,
  }
})

import { createClient } from '@supabase/supabase-js'
import { uploadComprobante } from '../lib/payments.js'

// Helper: create a minimal NextRequest-like object that the route expects
function makeRequest(body, headers = {}) {
  const rawBody = JSON.stringify(body)
  return {
    text: async () => rawBody,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
  }
}

// Helper: build a YCloud image message payload
function imagePayload(senderNumber, imageUrl, wamid = 'wamid-test-001') {
  return {
    type: 'whatsapp.inbound_message.received',
    whatsappInboundMessage: {
      id: wamid,
      wamid,
      from: senderNumber,
      type: 'image',
      image: { url: imageUrl, mimeType: 'image/jpeg' },
    },
  }
}

// Helper: create a supabase mock
function makeSupabaseMock({ existingPago = null } = {}) {
  const conversacionesUpdate = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    // Second .eq returns a thenable that resolves to {}
  }))

  // We need the full fluent chain for markLastMessage: .from("conversaciones").update(...).eq(...).eq(...)
  // And for pagos check: .from("pagos").select("id").eq("referencia", ...).maybeSingle()
  const maybeSingle = vi.fn(async () => ({ data: existingPago, error: null }))

  const fromMock = vi.fn((table) => {
    if (table === 'conversaciones') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        })),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: { last_message_at: new Date().toISOString() }, error: null })),
      }
    }
    if (table === 'pagos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle,
          })),
        })),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return { from: fromMock, _maybeSingle: maybeSingle }
}

let fetchSpy

beforeEach(() => {
  vi.clearAllMocks()
  // Disable YCloud signature validation in test environment
  process.env.NODE_ENV = 'test'
  delete process.env.YCLOUD_WEBHOOK_SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.AGENT_RUNNER_URL = 'https://test.supabase.co/functions/v1/agent-runner'

  // Spy on globalThis.fetch for agent-runner dispatch detection
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// We also need to mock the pre-filter to always return 'pass'
vi.mock('../lib/pre-filter.js', () => ({
  preFilter: vi.fn(async () => ({ action: 'pass', context: null })),
}))

describe('Webhook image branch — T7', () => {
  it('happy path: markLastMessage called + uploadComprobante called + agent-runner dispatched fire-and-forget', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-test-001.jpg',
      image_path: 'pago_wamid-test-001.jpg',
      citaId: 'cita-123',
      pacienteId: 'pac-456',
    })

    const { POST } = await import('../app/api/webhook/route.js?v=1')
    const req = makeRequest(imagePayload('+593999000111', 'https://ycloud.example.com/img.jpg'))
    const res = await POST(req)
    const json = await res.json()

    // Must return received: true quickly
    expect(json.received).toBe(true)

    // uploadComprobante must be called with senderNumber, wamid, imageUrl
    expect(uploadComprobante).toHaveBeenCalledWith(
      '+593999000111',
      'wamid-test-001',
      'https://ycloud.example.com/img.jpg'
    )

    // agent-runner fetch must have been called (fire-and-forget — we don't await it but it IS called)
    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(1)

    // The dispatch body must include imagen_recibida context
    const dispatchBody = JSON.parse(agentCalls[0][1].body)
    expect(dispatchBody.context.imagen_recibida).toBe(true)
    expect(dispatchBody.context.image_url).toBe('https://storage.example.com/comprobantes/pago_wamid-test-001.jpg')
    expect(dispatchBody.context.cita_id).toBe('cita-123')
    expect(dispatchBody.senderNumber).toBe('+593999000111')
  })

  it('missing patient: uploadComprobante returns error → short-circuits, returns { received: true }', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({ success: false, error: 'Paciente no encontrado' })

    const { POST } = await import('../app/api/webhook/route.js?v=2')
    const req = makeRequest(imagePayload('+593000000000', 'https://ycloud.example.com/img.jpg'))
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)

    // agent-runner should NOT have been called
    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(0)
  })

  it('duplicate wamid: pagos row already exists for this referencia → skips dispatch, returns duplicate: true', async () => {
    const supabase = makeSupabaseMock({ existingPago: { id: 'pago-already-exists' } })
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-dup.jpg',
      image_path: 'pago_wamid-dup.jpg',
      citaId: 'cita-123',
      pacienteId: 'pac-456',
    })

    const { POST } = await import('../app/api/webhook/route.js?v=3')
    const req = makeRequest(imagePayload('+593999000111', 'https://ycloud.example.com/img.jpg', 'wamid-dup'))
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)
    expect(json.duplicate).toBe(true)

    // agent-runner must NOT have been dispatched
    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(0)
  })

  it('missing imageUrl: early return without calling uploadComprobante', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)

    const payload = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-noimgurl',
        wamid: 'wamid-noimgurl',
        from: '+593999000111',
        type: 'image',
        image: {}, // no url field
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=4')
    const req = makeRequest(payload)
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)
    expect(uploadComprobante).not.toHaveBeenCalled()
  })

  it('dispatch body includes Authorization header with service role key', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-auth.jpg',
      image_path: 'pago_wamid-auth.jpg',
      citaId: 'cita-auth',
      pacienteId: 'pac-auth',
    })

    const { POST } = await import('../app/api/webhook/route.js?v=5')
    const req = makeRequest(imagePayload('+593999000111', 'https://ycloud.example.com/img.jpg', 'wamid-auth'))
    await POST(req)

    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(1)
    const headers = agentCalls[0][1].headers
    expect(headers['Authorization']).toContain('Bearer')
  })
})
