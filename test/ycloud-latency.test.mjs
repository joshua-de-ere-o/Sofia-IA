import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('YCloud latency-safe logging', () => {
  let fetchSpy
  let logSpy

  beforeEach(() => {
    process.env.YCLOUD_API_KEY = 'test-key'
    process.env.YCLOUD_PHONE_NUMBER_ID = 'phone-id'
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ id: 'msg-1' }),
    })
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.YCLOUD_API_KEY
    delete process.env.YCLOUD_PHONE_NUMBER_ID
  })

  it('logs masked recipient, status, and duration without plaintext message content', async () => {
    const { sendWhatsAppMessage } = await import('../lib/ycloud.js?latency')

    const result = await sendWhatsAppMessage('+593999000111', 'Paciente Ana Pérez necesita ayuda', { correlationId: 'txt_abc123' })

    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const joinedLogs = logSpy.mock.calls.map(([entry]) => String(entry)).join(' ')
    expect(joinedLogs).toContain('+5939***0111')
    expect(joinedLogs).toContain('202')
    expect(joinedLogs).toContain('txt_abc123')
    expect(joinedLogs).not.toContain('Paciente Ana Pérez necesita ayuda')
  })
})
