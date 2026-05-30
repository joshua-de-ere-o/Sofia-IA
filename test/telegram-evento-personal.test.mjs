/**
 * test/telegram-evento-personal.test.mjs
 *
 * Vitest unit tests for the personal-event flow in app/api/telegram/route.js:
 *   - agendar_evento_personal tool → creates a pending action with defaults
 *   - confirming it → inserts an agenda block (NOT NULL servicio/modalidad respected)
 *     AND a reminder row in `tareas` at (event time − recordar_min_antes)
 *   - recordar_min_antes = 0 → no reminder
 *   - bug fix: crear_bloqueo_agenda now inserts servicio + modalidad
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// ─── Fetch mock (Telegram API) ──────────────────────────────────────────────────

let capturedFetches = []
const originalFetch = globalThis.fetch

function mockFetch(url, opts) {
  capturedFetches.push({ url, opts })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
}

// ─── model-adapter mock (controllable per test) ──────────────────────────────────

let mockAdapterResponse = '{"tool":"responder_texto","args":{"texto":"ok"}}'
vi.mock('@/lib/model-adapter', () => ({
  getModelAdapter: vi.fn(() =>
    Promise.resolve({ chat: vi.fn(async () => mockAdapterResponse) }),
  ),
}))

vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}))

// ─── Module under test ──────────────────────────────────────────────────────────

let routeModule
async function loadRoute() {
  if (!routeModule) routeModule = await import('../app/api/telegram/route.js?' + Date.now())
  return routeModule
}

function makeRequest(body) {
  return { json: () => Promise.resolve(body) }
}

// ─── Builder that records inserts per table ──────────────────────────────────────

let inserted

function makeBuilder(table, rows) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
    insert: vi.fn((payload) => {
      (inserted[table] ||= []).push(payload)
      return builder
    }),
    // update() returns its own chainable builder that resolves count:1
    // (simulates winning the optimistic lock / CAS on pending_kelly_actions)
    update: vi.fn(() => {
      const updateBuilder = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
      }
      Object.defineProperty(updateBuilder, 'then', {
        get() {
          return (resolve) => resolve({ data: rows ?? [], error: null, count: 1 })
        },
      })
      // Make eq() and select() return updateBuilder so chaining keeps working
      updateBuilder.eq = vi.fn(() => updateBuilder)
      updateBuilder.select = vi.fn(() => updateBuilder)
      return updateBuilder
    }),
  }
  Object.defineProperty(builder, 'then', {
    get() {
      return (resolve) => resolve({ data: rows ?? [], error: null, count: 0 })
    },
  })
  return builder
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  inserted = {}
  capturedFetches = []
  globalThis.fetch = mockFetch
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_CHAT_ID = '999'
  vi.clearAllMocks()
  globalThis.fetch = mockFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ═══════════════════════════════════════════════════════════════════════════════

describe('agendar_evento_personal — tool', () => {
  it('creates a pending action with default 60 min duration and 30 min reminder', async () => {
    mockAdapterResponse = JSON.stringify({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Odontólogo', fecha: '2026-05-30', hora: '15:00' },
    })
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-new' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá mi visita al odontólogo mañana 15:00', chat: { id: 999 } } }))

    const pendingInsert = inserted['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('evento_personal')
    expect(pendingInsert.args.duracion_min).toBe(60)
    expect(pendingInsert.args.recordar_min_antes).toBe(30)

    // Confirmation message with buttons was sent
    const sendCall = capturedFetches.find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
  })
})

describe('confirming evento_personal', () => {
  it('inserts an agenda block with servicio + modalidad and a reminder 30 min before', async () => {
    const pending = {
      id: 'pending-1',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Odontólogo', recordar_min_antes: 30 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_pending-1', message: { message_id: 1, chat: { id: 999 } } },
    }))

    const citaInsert = inserted['citas']?.[0]
    expect(citaInsert?.estado).toBe('agenda_bloqueada')
    expect(citaInsert.servicio).toBeTruthy() // NOT NULL respected
    expect(citaInsert.modalidad).toBe('presencial') // NOT NULL respected
    expect(citaInsert.motivo_bloqueo).toBe('Odontólogo')

    const tareaInsert = inserted['tareas']?.[0]
    // 15:00 at -05:00 = 20:00 UTC; minus 30 min = 19:30 UTC
    expect(tareaInsert?.fecha_hora).toBe('2026-05-30T19:30:00.000Z')
  })

  it('does NOT create a reminder when recordar_min_antes is 0', async () => {
    const pending = {
      id: 'p2',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Bloqueo', recordar_min_antes: 0 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_p2', message: { message_id: 1, chat: { id: 999 } } },
    }))

    expect(inserted['citas']?.[0]).toBeTruthy()
    expect(inserted['tareas']).toBeUndefined()
  })
})

describe('crear_bloqueo_agenda — bug fix', () => {
  it('inserts servicio and modalidad so the NOT NULL constraint is satisfied', async () => {
    const pending = {
      id: 'p3',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '09:00', duracion_min: 30, motivo: 'Reunión' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_p3', message: { message_id: 1, chat: { id: 999 } } },
    }))

    const citaInsert = inserted['citas']?.[0]
    expect(citaInsert?.servicio).toBeTruthy()
    expect(citaInsert.modalidad).toBe('presencial')
    expect(citaInsert.estado).toBe('agenda_bloqueada')
  })
})
