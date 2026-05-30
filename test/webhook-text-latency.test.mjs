import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('../lib/payments.js', () => ({
  uploadComprobante: vi.fn(),
}))

vi.mock('../lib/pre-filter.js', () => ({
  preFilter: vi.fn(async () => ({ action: 'pass', context: { from_prefilter: true } })),
}))

vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}))

import { createClient } from '@supabase/supabase-js'

function makeRequest(body, headers = {}) {
  const rawBody = JSON.stringify(body)
  return {
    text: async () => rawBody,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
  }
}

function textPayload(senderNumber, text = 'mi nombre es Ana Pérez') {
  return {
    type: 'whatsapp.inbound_message.received',
    whatsappInboundMessage: {
      id: 'wamid-text-001',
      wamid: 'wamid-text-001',
      from: senderNumber,
      type: 'text',
      text: { body: text },
    },
  }
}

function makeSupabaseMock({ latest = true } = {}) {
  return {
    from(table) {
      if (table === 'conversaciones') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: latest
                    ? { last_message_at: '2026-05-29T10:00:00.000Z' }
                    : { last_message_at: '2026-05-29T10:00:01.000Z' },
                  error: null,
                })),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('Webhook text latency path', () => {
  let fetchSpy
  let logSpy

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.NODE_ENV = 'test'
    delete process.env.YCLOUD_WEBHOOK_SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.TEXT_DEBOUNCE_MS = '0'
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 })
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.setSystemTime(new Date('2026-05-29T10:00:00.000Z'))
  })

  afterEach(() => {
    delete process.env.TEXT_DEBOUNCE_MS
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('dispatches text replies with correlationId and masked latency logs', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ latest: true }))

    const { POST } = await import('../app/api/webhook/route.js?text-success')
    const pending = POST(makeRequest(textPayload('+593999000111')))
    await vi.runAllTimersAsync()
    const response = await pending
    const json = await response.json()

    expect(json.received).toBe(true)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain('agent-runner')

    const body = JSON.parse(init.body)
    expect(body.senderNumber).toBe('+593999000111')
    expect(body.context.from_prefilter).toBe(true)
    expect(body.correlationId).toMatch(/^txt_/)

    const latencyLogs = logSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => typeof entry === 'string' && entry.includes('text_path_stage'))

    expect(latencyLogs.length).toBeGreaterThan(0)
    expect(latencyLogs.join(' ')).toContain('+5939***0111')
    expect(latencyLogs.join(' ')).not.toContain('mi nombre es Ana Pérez')
  })

  it('returns debounced=true and skips agent dispatch when a newer text wins', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ latest: false }))

    const { POST } = await import('../app/api/webhook/route.js?text-debounced')
    const pending = POST(makeRequest(textPayload('+593999000222', 'hola hola')))
    await vi.runAllTimersAsync()
    const response = await pending
    const json = await response.json()

    expect(json).toMatchObject({ received: true, debounced: true })
    expect(fetchSpy).not.toHaveBeenCalled()

    const stageLogs = logSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => typeof entry === 'string' && entry.includes('text_path_stage'))
      .map((entry) => JSON.parse(entry))

    expect(stageLogs).toEqual([
      expect.objectContaining({ stage: 'prefilter', action: 'pass' }),
      expect.objectContaining({ stage: 'debounce', ok: false, debounce_ms: 0 }),
    ])

    const hotspotLog = logSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => typeof entry === 'string' && entry.includes('text_path_hotspot'))
      .map((entry) => JSON.parse(entry))

    expect(hotspotLog).toHaveLength(1)
    expect(hotspotLog[0]).toMatchObject({
      outcome: 'debounced',
      stage_count: 2,
      phone: '+5939***0222',
    })
    expect(JSON.stringify(hotspotLog[0])).not.toContain('hola hola')
  })
})
