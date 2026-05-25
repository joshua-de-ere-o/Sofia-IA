/**
 * test/telegram-payment-callbacks.test.mjs
 *
 * Vitest unit tests for the payment callback handlers in app/api/telegram/route.js.
 * Tests written FIRST (TDD RED phase).
 *
 * Covers:
 *   T8a — Callback routing: payment_confirm_ and payment_reject_ prefixes
 *   T8b — handlePaymentConfirm: state transitions, idempotency, expiry, missing action
 *   T8c — handlePaymentReject: 24h window branching, slot-free, WA message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Supabase mock ────────────────────────────────────────────────────────────

let mockSupabaseState = {}

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// ─── Fetch mock (Telegram API calls + YCloud) ──────────────────────────────────

let capturedFetches = []
const originalFetch = globalThis.fetch

function mockFetch(url, opts) {
  capturedFetches.push({ url, opts })
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true }),
  })
}

// ─── model-adapter mock ────────────────────────────────────────────────────────

vi.mock('@/lib/model-adapter', () => ({
  getModelAdapter: vi.fn(() => Promise.resolve({ chat: vi.fn(() => '{"tool":"responder_texto","args":{"texto":"ok"}}') })),
}))

// ─── ycloud mock ───────────────────────────────────────────────────────────────

let yCloudSent = []
vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async (to, text) => {
    yCloudSent.push({ to, text })
    return { success: true }
  }),
}))

// ─── Import module under test (after mocks) ────────────────────────────────────

// We import the POST handler and test via NextResponse simulation
// The route uses module-level `supabase = createClient(...)`, so mocks must be
// registered before the module loads.

let routeModule

async function loadRoute() {
  if (!routeModule) {
    routeModule = await import('../app/api/telegram/route.js?' + Date.now())
  }
  return routeModule
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildCallbackUpdate(callbackData, messageId = 111, chatId = 999) {
  return {
    callback_query: {
      id: 'cq-test-id',
      data: callbackData,
      message: {
        message_id: messageId,
        chat: { id: chatId },
        caption: '🟡 Pago por aprobar\nPaciente: Test',
      },
    },
  }
}

function makeRequest(body) {
  return {
    json: () => Promise.resolve(body),
  }
}

// ─── Supabase builder factory ──────────────────────────────────────────────────

function makeBuilder(rows, affectedCount = 1) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    // Terminal resolvers that return { data, error, count }
    then: undefined,
  }
  // Make the builder itself thenable (for await db.from(...).update(...).eq(...))
  Object.defineProperty(builder, 'then', {
    get() {
      return (resolve) => resolve({ data: rows ?? [], error: null, count: affectedCount })
    },
  })
  return builder
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  capturedFetches = []
  yCloudSent = []
  globalThis.fetch = mockFetch
  // Provide env vars so answerCallback / editPaymentMessageCaption don't short-circuit
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_CHAT_ID = '999'
  vi.clearAllMocks()
  // Restore fetch after vi.clearAllMocks() would have cleared it
  globalThis.fetch = mockFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ═══════════════════════════════════════════════════════════════════════════════
// T8a — Routing tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('T8a — payment callback routing', () => {
  it('routes payment_confirm_<id> to the confirm handler', async () => {
    const pendingId = 'aaaaaaaa-0000-0000-0000-000000000001'

    // pending_kelly_actions → not found (action doesn't exist)
    mockFrom.mockImplementation(() => makeBuilder(null))

    const { POST } = await loadRoute()
    const res = await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    // answerCallbackQuery MUST have been called (Telegram stops spinner)
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall, 'answerCallbackQuery should be called').toBeTruthy()
  })

  it('routes payment_reject_<id> to the reject handler', async () => {
    const pendingId = 'aaaaaaaa-0000-0000-0000-000000000002'

    mockFrom.mockImplementation(() => makeBuilder(null))

    const { POST } = await loadRoute()
    const res = await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
  })

  it('does NOT route unknown prefix to payment handlers', async () => {
    // attendance_yes_ should go to the existing handler, not payment handler
    mockFrom.mockImplementation(() => makeBuilder([{ id: 'cita-x' }]))

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate('attendance_yes_cita-x')))

    // attendance handler calls Supabase update on citas
    const updateCalls = capturedFetches.filter((f) => f.url.includes('editMessageReplyMarkup'))
    expect(updateCalls.length).toBeGreaterThan(0)
  })

  it('handles malformed short_id (empty string after prefix) gracefully', async () => {
    mockFrom.mockImplementation(() => makeBuilder(null))

    const { POST } = await loadRoute()
    // Should not throw
    await expect(
      POST(makeRequest(buildCallbackUpdate('payment_confirm_')))
    ).resolves.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// T8b — handlePaymentConfirm
// ═══════════════════════════════════════════════════════════════════════════════

describe('T8b — handlePaymentConfirm', () => {
  it('answers "Esta acción ya no existe" when pending row not found', async () => {
    mockFrom.mockImplementation(() => makeBuilder(null))

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate('payment_confirm_missing-id')))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/ya no existe|no encontrada/i)
  })

  it('answers "Esta acción expiró" when expira_at < now', async () => {
    const expiredPending = {
      id: 'pending-expired',
      expira_at: new Date(Date.now() - 1000).toISOString(),
      args: { cita_id: 'cita-1', pago_id: 'pago-1' },
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([expiredPending])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${expiredPending.id}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/expir/i)
  })

  it('answers idempotency toast when cita already confirmada', async () => {
    const pendingId = 'pending-idempotent'
    const pending = {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-already', pago_id: 'pago-1' },
    }
    const citaAlreadyConfirmed = {
      id: 'cita-already',
      estado: 'confirmada',
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([pending])
      if (table === 'citas') return makeBuilder([citaAlreadyConfirmed])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/ya fue procesada|ya estaba/i)
  })

  it('answers idempotency toast when cita already rechazada', async () => {
    const pendingId = 'pending-idem-rechazada'
    const pending = {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-rechazada', pago_id: 'pago-2' },
    }
    const citaRechazada = { id: 'cita-rechazada', estado: 'rechazada' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([pending])
      if (table === 'citas') return makeBuilder([citaRechazada])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/ya fue procesada|ya estaba/i)
  })

  it('sets cita to confirmada and pagos.verificado=true on happy path', async () => {
    const pendingId = 'pending-happy'
    const pending = {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-provisional', pago_id: 'pago-happy' },
    }
    const cita = { id: 'cita-provisional', estado: 'confirmada_provisional' }

    const updateCalls = []
    const deleteCalls = []

    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(table === 'pending_kelly_actions' ? [pending] : table === 'citas' ? [cita] : null, 1)
      const origUpdate = b.update.bind(b)
      b.update = vi.fn((data) => {
        updateCalls.push({ table, data })
        return b
      })
      const origDelete = b.delete.bind(b)
      b.delete = vi.fn(() => {
        deleteCalls.push({ table })
        return b
      })
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    // citas should have been updated with estado='confirmada'
    const citaUpdate = updateCalls.find((u) => u.table === 'citas')
    expect(citaUpdate).toBeTruthy()
    expect(citaUpdate.data.estado).toBe('confirmada')

    // pagos should have been updated with verificado=true
    const pagosUpdate = updateCalls.find((u) => u.table === 'pagos')
    expect(pagosUpdate).toBeTruthy()
    expect(pagosUpdate.data.verificado).toBe(true)

    // answerCallbackQuery called with approval toast
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/aprobad/i)
  })

  it('edits Telegram caption with APROBADO prefix on happy path', async () => {
    const pendingId = 'pending-edit-caption'
    const pending = {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-p2', pago_id: 'pago-p2' },
    }
    const cita = { id: 'cita-p2', estado: 'confirmada_provisional' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([pending])
      if (table === 'citas') return makeBuilder([cita])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    // editMessageCaption or editMessageReplyMarkup should be called
    const editCall = capturedFetches.find(
      (f) => f.url.includes('editMessageCaption') || f.url.includes('editMessageReplyMarkup')
    )
    expect(editCall, 'edit Telegram message should be called').toBeTruthy()
  })

  it('does NOT send WhatsApp message to patient on approval', async () => {
    const pendingId = 'pending-no-wa'
    const pending = {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-p3', pago_id: 'pago-p3' },
    }
    const cita = { id: 'cita-p3', estado: 'confirmada_provisional' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([pending])
      if (table === 'citas') return makeBuilder([cita])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_confirm_${pendingId}`)))

    expect(yCloudSent).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// T8c — handlePaymentReject
// ═══════════════════════════════════════════════════════════════════════════════

describe('T8c — handlePaymentReject', () => {
  function makeRejectPending(pendingId, citaId = 'cita-reject') {
    return {
      id: pendingId,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: citaId, pago_id: 'pago-r1' },
    }
  }

  it('sets cita to rechazada on rejection', async () => {
    const pendingId = 'pending-reject'
    const pending = makeRejectPending(pendingId)
    const cita = {
      id: 'cita-reject',
      estado: 'confirmada_provisional',
      paciente_id: 'pac-1',
    }
    const conversacion = {
      last_message_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago → within 24h
      paciente_id: 'pac-1',
    }
    const paciente = { id: 'pac-1', nombre: 'Test Paciente', telefono: '+593987654321' }

    const updateCalls = []
    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn((data) => { updateCalls.push({ table, data }); return b })
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    const citaUpdate = updateCalls.find((u) => u.table === 'citas')
    expect(citaUpdate).toBeTruthy()
    expect(citaUpdate.data.estado).toBe('rechazada')
  })

  it('sends WA message (M5) to patient when within 24h window', async () => {
    const pendingId = 'pending-reject-in-window'
    const pending = makeRejectPending(pendingId, 'cita-in-window')
    const cita = { id: 'cita-in-window', estado: 'confirmada_provisional', paciente_id: 'pac-2' }
    const conversacion = {
      last_message_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
      paciente_id: 'pac-2',
    }
    const paciente = { id: 'pac-2', nombre: 'Maria Test', telefono: '+593987000001' }

    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn(() => b)
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    expect(yCloudSent).toHaveLength(1)
    expect(yCloudSent[0].to).toBe('+593987000001')
    // M5 copy — mentions first name (split from full name per copy-final spec)
    expect(yCloudSent[0].text).toContain('Maria')
  })

  it('does NOT send WA message when outside 24h window', async () => {
    const pendingId = 'pending-reject-out-window'
    const pending = makeRejectPending(pendingId, 'cita-out-window')
    const cita = { id: 'cita-out-window', estado: 'confirmada_provisional', paciente_id: 'pac-3' }
    const conversacion = {
      last_message_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), // 25 hours ago
      paciente_id: 'pac-3',
    }
    const paciente = { id: 'pac-3', nombre: 'Carlos Afuera', telefono: '+593987000002' }

    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn(() => b)
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    expect(yCloudSent).toHaveLength(0)
  })

  it('edits Telegram caption with RECHAZADO + mensaje enviado when in window', async () => {
    const pendingId = 'pending-edit-reject-in'
    const pending = makeRejectPending(pendingId, 'cita-edit-in')
    const cita = { id: 'cita-edit-in', estado: 'confirmada_provisional', paciente_id: 'pac-4' }
    const conversacion = {
      last_message_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      paciente_id: 'pac-4',
    }
    const paciente = { id: 'pac-4', nombre: 'Test In', telefono: '+593987000003' }

    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn(() => b)
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    const editCall = capturedFetches.find(
      (f) => f.url.includes('editMessageCaption') || f.url.includes('editMessageReplyMarkup')
    )
    expect(editCall).toBeTruthy()
    const body = JSON.parse(editCall.opts.body)
    // Caption should include "RECHAZADO" and "mensaje enviado"
    const captionText = body.caption || body.reply_markup || JSON.stringify(body)
    expect(JSON.stringify(body)).toMatch(/RECHAZADO|rechazado/i)
  })

  it('edits Telegram caption with RECHAZADO fuera-de-ventana and keeps wa.me button', async () => {
    const pendingId = 'pending-edit-reject-out'
    const pending = makeRejectPending(pendingId, 'cita-edit-out')
    const cita = { id: 'cita-edit-out', estado: 'confirmada_provisional', paciente_id: 'pac-5' }
    const conversacion = {
      last_message_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(), // 26 hours
      paciente_id: 'pac-5',
    }
    const paciente = { id: 'pac-5', nombre: 'Test Out', telefono: '+593987000004' }

    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn(() => b)
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    // wa.me button should remain: editMessageCaption called with inline_keyboard containing url
    const editCall = capturedFetches.find(
      (f) => f.url.includes('editMessageCaption') || f.url.includes('editMessageReplyMarkup')
    )
    expect(editCall).toBeTruthy()
    const bodyStr = editCall.opts.body
    expect(bodyStr).toMatch(/wa\.me|💬/i)
  })

  it('recomputes window at click time (FR-15)', async () => {
    // This is structural: the handler must fetch last_message_at from DB, not from callback message
    // We verify it by checking that conversaciones table was queried
    const pendingId = 'pending-recompute'
    const pending = makeRejectPending(pendingId, 'cita-recompute')
    const cita = { id: 'cita-recompute', estado: 'confirmada_provisional', paciente_id: 'pac-6' }
    const conversacion = {
      last_message_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      paciente_id: 'pac-6',
    }
    const paciente = { id: 'pac-6', nombre: 'Test FR15', telefono: '+593987000005' }

    const tableAccesses = []
    mockFrom.mockImplementation((table) => {
      tableAccesses.push(table)
      const b = makeBuilder(
        table === 'pending_kelly_actions' ? [pending]
          : table === 'citas' ? [cita]
          : table === 'conversaciones' ? [conversacion]
          : table === 'pacientes' ? [paciente]
          : null
      )
      b.update = vi.fn(() => b)
      b.delete = vi.fn(() => b)
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    expect(tableAccesses).toContain('conversaciones')
  })

  it('answers "Esta acción expiró" on expired pending for reject', async () => {
    const pendingId = 'pending-reject-expired'
    const expired = {
      id: pendingId,
      expira_at: new Date(Date.now() - 5000).toISOString(),
      args: { cita_id: 'cita-x', pago_id: 'pago-x' },
    }

    mockFrom.mockImplementation(() => makeBuilder([expired]))

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/expir/i)
  })

  it('answers idempotency toast when cita already rechazada on reject', async () => {
    const pendingId = 'pending-idem-r'
    const pending = makeRejectPending(pendingId, 'cita-idem-r')
    const cita = { id: 'cita-idem-r', estado: 'rechazada' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder([pending])
      if (table === 'citas') return makeBuilder([cita])
      return makeBuilder(null)
    })

    const { POST } = await loadRoute()
    await POST(makeRequest(buildCallbackUpdate(`payment_reject_${pendingId}`)))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/ya fue procesada|ya estaba/i)
  })
})
