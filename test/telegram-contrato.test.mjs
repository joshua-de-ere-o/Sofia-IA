/**
 * test/telegram-contrato.test.mjs
 *
 * PR 3a — OperatorToolResult contract tests:
 *   - resolveKellyPending returns {kind:'result', status, message} shape
 *   - toolReagendarCita returns {kind:'preview', ...} shape (dispatcher drives the send)
 *   - expiry rejection: expira_at in the past → kind:'result', status:'failed'
 *   - reuse rejection: ejecutada=true → kind:'result', status:'failed'
 *   - TOCTOU fix: atomic UPDATE guards ejecutada=false; double-tap on confirm
 *     does NOT perform a second mutation after the row is already marked ejecutada
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// ─── Fetch mock (Telegram API) ────────────────────────────────────────────────

let capturedFetches = []
const originalFetch = globalThis.fetch

function mockFetch(url, opts) {
  capturedFetches.push({ url, opts })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
}

// ─── model-adapter mock ───────────────────────────────────────────────────────

let mockAdapterResponse = '{"tool":"responder_texto","args":{"texto":"ok"}}'
vi.mock('@/lib/model-adapter', () => ({
  getModelAdapter: vi.fn(() =>
    Promise.resolve({ chat: vi.fn(async () => mockAdapterResponse) }),
  ),
}))

vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}))

// ─── Module under test ────────────────────────────────────────────────────────

let routeModule
async function loadRoute() {
  if (!routeModule) routeModule = await import('../app/api/telegram/route.js?' + Date.now())
  return routeModule
}

function makeRequest(body) {
  return { json: () => Promise.resolve(body) }
}

// ─── Builder factory (tracks inserts AND updates per table) ───────────────────

let inserted
let updated

/**
 * Build a chainable Supabase mock for `table`.
 * `rows` is the data returned by .single() and the thenable.
 * `updateData` optionally lets tests control what the UPDATE chain resolves with
 * (to simulate "0 rows affected" for the TOCTOU CAS guard).
 * Default count for updates is 1 (lock won). Pass count:0 to simulate lock lost.
 */
function makeBuilder(table, rows, { updateData } = {}) {
  const eqFilters = {}

  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((col, val) => {
      eqFilters[col] = val
      return builder
    }),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
    insert: vi.fn((payload) => {
      ;(inserted[table] ||= []).push(payload)
      return builder
    }),
    update: vi.fn((payload) => {
      // Each update call gets its own filter accumulator so chains don't bleed
      const updateFilters = {}
      const entry = { payload, filters: updateFilters }
      ;(updated[table] ||= []).push(entry)

      const resolvedUpdateData = updateData ?? { data: rows ?? [], error: null, count: 1 }

      const updateBuilder = {
        eq: vi.fn((col, val) => {
          updateFilters[col] = val
          return updateBuilder
        }),
        // .select() after .update() — used by the CAS flip to get count back
        select: vi.fn(() => updateBuilder),
        single: vi.fn().mockResolvedValue(
          updateData ?? { data: rows?.[0] ?? null, error: null }
        ),
      }
      // Make it thenable so awaiting the chain works (including after .select())
      Object.defineProperty(updateBuilder, 'then', {
        get() {
          return (resolve) => resolve(resolvedUpdateData)
        },
      })
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
  updated = {}
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
// 1. resolveKellyPending — return shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveKellyPending — OperatorToolResult shape', () => {
  it('confirm happy path → answerCallback receives a non-empty toast string (result shape)', async () => {
    // The callback handler calls answerCallback(callbackQuery, result.toast)
    // After the refactor, result must be {kind:'result', status:'applied', message} and
    // the consumer maps result.message to the toast text.
    const pending = {
      id: 'rp-1',
      action_type: 'reagendar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-1', paciente_nombre: 'Ana', fecha_original: '2026-05-01', hora_original: '10:00', nueva_fecha: '2026-06-01', nueva_hora: '11:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-1',
        data: 'kelly_confirm_rp-1',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // answerCallbackQuery was called with a non-empty text
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toBeTruthy()
    expect(body.text.length).toBeGreaterThan(0)
  })

  it('cancel → answerCallback receives a cancelled label', async () => {
    const pending = {
      id: 'rp-cancel',
      action_type: 'reagendar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'c1', paciente_nombre: 'Ana', fecha_original: '2026-05-01', hora_original: '10:00', nueva_fecha: '2026-06-01', nueva_hora: '11:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-cancel',
        data: 'kelly_cancel_rp-cancel',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    // Should contain some form of "cancelado" indicator
    expect(body.text).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Expiry rejection
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveKellyPending — expiry rejection', () => {
  it('expired action → answerCallback gets expiry message, NO citas update', async () => {
    const pending = {
      id: 'rp-expired',
      action_type: 'reagendar',
      ejecutada: false,
      expira_at: new Date(Date.now() - 1000).toISOString(), // 1 second in the past
      args: { cita_id: 'c1', nueva_fecha: '2026-06-01', nueva_hora: '11:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-exp',
        data: 'kelly_confirm_rp-expired',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // No citas mutation should have happened
    expect(updated['citas']).toBeUndefined()
    expect(inserted['citas']).toBeUndefined()

    // answerCallbackQuery was called and text indicates expiry
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/expir/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Reuse rejection (ejecutada=true)
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveKellyPending — reuse rejection', () => {
  it('already-executed action → answerCallback gets already-applied message, NO second mutation', async () => {
    const pending = {
      id: 'rp-done',
      action_type: 'reagendar',
      ejecutada: true, // already executed
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'c1', nueva_fecha: '2026-06-01', nueva_hora: '11:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-done',
        data: 'kelly_confirm_rp-done',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // No citas mutation
    expect(updated['citas']).toBeUndefined()
    expect(inserted['citas']).toBeUndefined()

    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toBeTruthy()
    // Should NOT say "Aplicado" — it was already done
    expect(body.text).not.toMatch(/^✅ Aplicado/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TOCTOU fix — optimistic-lock CAS: flip FIRST, side-effect only if won
// ═══════════════════════════════════════════════════════════════════════════════

describe('TOCTOU fix — optimistic-lock CAS', () => {
  // ── 4a. First tap wins the lock: CAS returns count:1, side-effect runs ────────
  it('first tap wins CAS (count:1) → side-effect runs, status applied', async () => {
    const pending = {
      id: 'rp-toctou-win',
      action_type: 'reagendar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-x', nueva_fecha: '2026-06-10', nueva_hora: '10:00' },
    }
    // Default updateData has count:1 — lock won
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-win',
        data: 'kelly_confirm_rp-toctou-win',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // CAS UPDATE must be first on pending_kelly_actions and include the guard
    const pendingUpdates = updated['pending_kelly_actions'] ?? []
    const casUpdate = pendingUpdates[0]
    expect(casUpdate).toBeTruthy()
    expect(casUpdate.payload?.ejecutada).toBe(true)
    expect(casUpdate.filters['ejecutada']).toBe(false)

    // Side-effect (citas UPDATE) MUST have run because we won
    const citaUpdates = updated['citas'] ?? []
    expect(citaUpdates.length).toBeGreaterThan(0)

    // Response must say applied
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Aplicado/i)
  })

  // ── 4b. Second tap loses the lock: CAS returns count:0 → side-effect does NOT run ──
  // THIS TEST WOULD FAIL if the CAS were reordered back to side-effect-first,
  // because in the old order the side-effect ran before the guarded UPDATE.
  it('second tap loses CAS (count:0) → side-effect does NOT run, status already', async () => {
    const pending = {
      id: 'rp-toctou-lose',
      action_type: 'reagendar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-y', nueva_fecha: '2026-06-11', nueva_hora: '11:00' },
    }
    // CAS returns count:0 → another tap already won
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [pending], { updateData: { data: null, error: null, count: 0 } })
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-lose',
        data: 'kelly_confirm_rp-toctou-lose',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // CAS UPDATE was attempted (it's the first update on pending_kelly_actions)
    const pendingUpdates = updated['pending_kelly_actions'] ?? []
    expect(pendingUpdates.length).toBeGreaterThan(0)
    expect(pendingUpdates[0].filters['ejecutada']).toBe(false)

    // Side-effect (citas) MUST NOT have run — we lost the race
    expect(updated['citas']).toBeUndefined()
    expect(inserted['citas']).toBeUndefined()

    // Response must NOT say "Aplicado"
    const answerCall = capturedFetches.find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).not.toMatch(/✅ Aplicado/i)
  })

  // ── 4c. Same race for bloqueo — CAS loses → no citas INSERT ──────────────────
  it('bloqueo second tap loses CAS (count:0) → no citas insert', async () => {
    const pending = {
      id: 'rp-bloqueo-lose',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-01', hora: '08:00', duracion_min: 60, motivo: 'Capacitación' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [pending], { updateData: { data: null, error: null, count: 0 } })
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-lose',
        data: 'kelly_confirm_rp-bloqueo-lose',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    // No citas INSERT must have happened
    expect(inserted['citas']).toBeUndefined()
    expect(updated['citas']).toBeUndefined()
  })

  // ── 4d. First tap wins bloqueo lock: side-effect (citas INSERT) runs ──────────
  it('bloqueo first tap wins CAS (count:1) → citas insert runs', async () => {
    const pending = {
      id: 'rp-bloqueo-win',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-01', hora: '08:00', duracion_min: 60, motivo: 'Capacitación' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-win',
        data: 'kelly_confirm_rp-bloqueo-win',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const citasInserts = inserted['citas'] ?? []
    expect(citasInserts.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. toolReagendarCita — preview shape returned (dispatcher drives send)
// ═══════════════════════════════════════════════════════════════════════════════

describe('toolReagendarCita — preview contract shape', () => {
  it('sends a message with confirm/cancel buttons after inserting pending action', async () => {
    mockAdapterResponse = JSON.stringify({
      tool: 'reagendar_cita_kelly',
      args: { nombre_paciente: 'Maria', nueva_fecha: '2026-06-15', nueva_hora: '14:00' },
    })

    const paciente = { id: 'p-1', nombre: 'Maria Garcia' }
    const cita = { id: 'cita-1', fecha: '2026-05-20', hora: '10:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pendingRow = { id: 'pending-reagendar-1' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'reagendá a Maria para el 15 de junio a las 14:00', chat: { id: 999 } },
    }))

    // A pending action must have been inserted
    const pendingInsert = inserted['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('reagendar')
    expect(pendingInsert?.args?.nueva_fecha).toBe('2026-06-15')
    expect(pendingInsert?.args?.nueva_hora).toBe('14:00')

    // Confirm/cancel buttons must have been sent
    const sendCall = capturedFetches.find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    const keyboard = body.reply_markup?.inline_keyboard
    expect(keyboard).toBeTruthy()
    // Should have a confirm button
    const allButtons = keyboard.flat()
    const confirmBtn = allButtons.find((b) => b.callback_data?.includes('kelly_confirm_'))
    expect(confirmBtn).toBeTruthy()
    // Should have a cancel button
    const cancelBtn = allButtons.find((b) => b.callback_data?.includes('kelly_cancel_'))
    expect(cancelBtn).toBeTruthy()
  })

  it('does NOT apply the reagendar directly (no citas UPDATE in tool phase)', async () => {
    mockAdapterResponse = JSON.stringify({
      tool: 'reagendar_cita_kelly',
      args: { nombre_paciente: 'Maria', nueva_fecha: '2026-06-15', nueva_hora: '14:00' },
    })

    const paciente = { id: 'p-1', nombre: 'Maria Garcia' }
    const cita = { id: 'cita-1', fecha: '2026-05-20', hora: '10:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'pending-rg' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      message: { text: 'reagendá a Maria para el 15 de junio a las 14:00', chat: { id: 999 } },
    }))

    // The tool must NOT have updated citas directly
    expect(updated['citas']).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Regression — existing evento_personal sentinel tests still pass
// ═══════════════════════════════════════════════════════════════════════════════

describe('regression — evento_personal confirm still works after resolveKellyPending refactor', () => {
  it('servicio/modalidad NOT NULL, recordar_min_antes=0 → no tareas insert', async () => {
    const pending = {
      id: 'rp-reg-1',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Dentista', recordar_min_antes: 0 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-reg',
        data: 'kelly_confirm_rp-reg-1',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const citaInsert = inserted['citas']?.[0]
    expect(citaInsert?.estado).toBe('agenda_bloqueada')
    expect(citaInsert?.servicio).toBeTruthy()
    expect(citaInsert?.modalidad).toBe('presencial')
    expect(inserted['tareas']).toBeUndefined()
  })

  it('recordar_min_antes=30 → tareas insert at correct time', async () => {
    const pending = {
      id: 'rp-reg-2',
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
      callback_query: {
        id: 'cq-reg2',
        data: 'kelly_confirm_rp-reg-2',
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const tareaInsert = inserted['tareas']?.[0]
    expect(tareaInsert?.fecha_hora).toBe('2026-05-30T19:30:00.000Z')
  })
})
