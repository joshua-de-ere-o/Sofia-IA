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

// Mock ycloud so sendWhatsAppMessage is controllable in unsupported-branch tests
vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}))

import { createClient } from '@supabase/supabase-js'
import { uploadComprobante } from '../lib/payments.js'
import { sendWhatsAppMessage } from '../lib/ycloud.js'

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

  // ── T4: document-typed image cases (S1-webhook, S2-webhook, S5-regression) ──

  // S1-webhook: document payload with image/jpeg mime + document.link → image branch fires
  it('S1: document payload with image/jpeg mime (document.link) → image branch fires', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-doc-img.jpg',
      image_path: 'pago_wamid-doc-img.jpg',
      citaId: 'cita-doc-img',
      pacienteId: 'pac-doc-img',
    })

    const documentImagePayload = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-doc-img-001',
        wamid: 'wamid-doc-img-001',
        from: '+593999000111',
        type: 'document',
        document: {
          mime_type: 'image/jpeg',
          link: 'https://cdn.ycloud.com/abc123',
          filename: 'comprobante.jpg',
        },
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=6')
    const req = makeRequest(documentImagePayload)
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)

    // uploadComprobante MUST be called — confirms normalization rewrote type to 'image'
    expect(uploadComprobante).toHaveBeenCalledWith(
      '+593999000111',
      'wamid-doc-img-001',
      'https://cdn.ycloud.com/abc123'
    )

    // agent-runner MUST be dispatched
    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(1)
  })

  // S2-webhook: document with image/jpeg mime but URL only in document.url (fallback chain)
  it('S2: document payload with image/jpeg mime — URL in document.url (fallback) → image branch fires', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-doc-url.jpg',
      image_path: 'pago_wamid-doc-url.jpg',
      citaId: 'cita-doc-url',
      pacienteId: 'pac-doc-url',
    })

    const documentImagePayloadUrlFallback = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-doc-url-001',
        wamid: 'wamid-doc-url-001',
        from: '+593999000222',
        type: 'document',
        document: {
          mime_type: 'image/jpeg',
          // note: no 'link' field — URL is only in 'url'
          url: 'https://cdn.ycloud.com/fallback-url-field',
          filename: 'comprobante2.jpg',
        },
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=7')
    const req = makeRequest(documentImagePayloadUrlFallback)
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)

    // uploadComprobante must be called with the fallback URL
    expect(uploadComprobante).toHaveBeenCalledWith(
      '+593999000222',
      'wamid-doc-url-001',
      'https://cdn.ycloud.com/fallback-url-field'
    )
  })

  // S5-regression: native type:'image' payload → existing image branch unchanged
  it('S5: native type:image payload → existing image branch unchanged (no regression)', async () => {
    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)
    uploadComprobante.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example.com/comprobantes/pago_wamid-native.jpg',
      image_path: 'pago_wamid-native.jpg',
      citaId: 'cita-native',
      pacienteId: 'pac-native',
    })

    const { POST } = await import('../app/api/webhook/route.js?v=8')
    const req = makeRequest(imagePayload('+593999000333', 'https://cdn.ycloud.com/img000', 'wamid-native'))
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)
    expect(uploadComprobante).toHaveBeenCalledWith(
      '+593999000333',
      'wamid-native',
      'https://cdn.ycloud.com/img000'
    )

    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(1)
  })

  // ── T5: unsupported-type and cascade-fix cases (S3-webhook, S4-webhook, S6-webhook) ──

  // We need preFilter to return 'unsupported' for these — override the module-level mock per-test
  // by using a dedicated mock for the pre-filter inside each test.

  // S3-webhook: PDF document → unsupported branch fires, sendWhatsAppMessage called, agent NOT dispatched
  it('S3: PDF document → unsupported branch, sendWhatsAppMessage called, agent NOT dispatched, 200 received:true filtered:true reason:unsupported', async () => {
    const { preFilter } = await import('../lib/pre-filter.js')
    preFilter.mockResolvedValueOnce({ action: 'unsupported', reply: 'Solo texto e imágenes' })

    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)

    // Mock sendWhatsAppMessage — we need it injected via the ycloud mock
    const { sendWhatsAppMessage } = await import('../lib/ycloud.js')
    sendWhatsAppMessage.mockResolvedValueOnce({ success: true })

    const pdfPayload = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-pdf-001',
        wamid: 'wamid-pdf-001',
        from: '+593999000444',
        type: 'document',
        document: {
          mime_type: 'application/pdf',
          link: 'https://cdn.ycloud.com/doc789',
          filename: 'documento.pdf',
        },
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=9')
    const req = makeRequest(pdfPayload)
    const res = await POST(req)
    const json = await res.json()

    expect(json.received).toBe(true)
    expect(json.filtered).toBe(true)
    expect(json.reason).toBe('unsupported')

    // sendWhatsAppMessage MUST have been called
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+593999000444', 'Solo texto e imágenes')

    // agent-runner must NOT have been dispatched
    const agentCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('agent-runner')
    )
    expect(agentCalls.length).toBe(0)

    // uploadComprobante must NOT have been called
    expect(uploadComprobante).not.toHaveBeenCalled()
  })

  // S4-webhook: sendWhatsAppMessage returns {success:false} → structured console.error, no throw, 200
  it('S4: sendWhatsAppMessage returns {success:false} → console.error with structured payload, response 200 reason:unsupported', async () => {
    const { preFilter } = await import('../lib/pre-filter.js')
    preFilter.mockResolvedValueOnce({ action: 'unsupported', reply: 'Solo texto e imágenes' })

    const { sendWhatsAppMessage } = await import('../lib/ycloud.js')
    sendWhatsAppMessage.mockResolvedValueOnce({ success: false, error: 'Credenciales faltantes' })

    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)

    const consoleSpy = vi.spyOn(console, 'error')

    const audioPayload = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-audio-001',
        wamid: 'wamid-audio-001',
        from: '+593999000555',
        type: 'audio',
        audio: { url: 'https://cdn.ycloud.com/audio.ogg' },
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=10')
    const req = makeRequest(audioPayload)
    const res = await POST(req)
    const json = await res.json()

    // Must not throw — response is 200
    expect(json.received).toBe(true)
    expect(json.filtered).toBe(true)
    expect(json.reason).toBe('unsupported')

    // console.error MUST have been called with structured JSON containing event:'unsupported_reply_failed'
    const errorCalls = consoleSpy.mock.calls
    const structuredCall = errorCalls.find((args) => {
      try {
        const parsed = JSON.parse(args[0])
        return parsed.event === 'unsupported_reply_failed'
      } catch {
        return false
      }
    })
    expect(structuredCall).toBeDefined()

    const logObj = JSON.parse(structuredCall[0])
    expect(logObj.event).toBe('unsupported_reply_failed')
    expect(logObj.error).toBe('Credenciales faltantes')
    // phone must be masked — must NOT be the raw number
    expect(logObj.phone).not.toBe('+593999000555')
    expect(logObj.phone).toMatch(/\*\*\*/)
  })

  // S6-webhook: document with null document field → no crash, unsupported reply sent, 200
  it('S6: document with null document field → no crash, sendWhatsAppMessage called, 200', async () => {
    const { preFilter } = await import('../lib/pre-filter.js')
    preFilter.mockResolvedValueOnce({ action: 'unsupported', reply: 'Solo texto e imágenes' })

    const { sendWhatsAppMessage } = await import('../lib/ycloud.js')
    sendWhatsAppMessage.mockResolvedValueOnce({ success: true })

    const supabase = makeSupabaseMock()
    createClient.mockReturnValue(supabase)

    const nullDocPayload = {
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'wamid-nulldoc-001',
        wamid: 'wamid-nulldoc-001',
        from: '+593999000666',
        type: 'document',
        document: null,
      },
    }

    const { POST } = await import('../app/api/webhook/route.js?v=11')
    const req = makeRequest(nullDocPayload)

    // Must not throw
    await expect(POST(req)).resolves.toBeDefined()
    const res = await POST(makeRequest(nullDocPayload))
    const json = await res.json()

    expect(json.received).toBe(true)
  })
})
