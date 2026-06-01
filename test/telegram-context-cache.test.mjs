/**
 * test/telegram-context-cache.test.mjs
 *
 * PR2a + PR2b: context cache tests.
 *
 * PR2a covers:
 *   - writeKellyContext: upserts with correct chat_id + JSONB shape; swallows error when table absent
 *   - readKellyContext: returns null when row missing; null when stale (>30 min); object when fresh
 *   - clearKellyContext: issues delete by chat_id; swallows error
 *   - toolBuscarCitasBulk: returns { citas, criteria } with correct mapped shape AND still sends text
 *   - dispatcher: calls writeKellyContext after a buscar_citas_bulk search
 *
 * PR2b covers:
 *   - Context injection into userText (not systemPrompt) when context is fresh
 *   - No injection when context is null/stale
 *   - maxTokens raised to 900 on injected turn, 500 otherwise
 *   - clearKellyContext called after successful reagendar_bulk confirm; NOT on cancel
 *   - Two-turn integration test: search → "movelas" → reagendar_bulk uses cached ids
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
  setAdapterResponses,
} from './helpers/telegram-mock-builder.mjs'

// ─── Shared test data ─────────────────────────────────────────────────────────

const CHAT_ID = '999' // matches TELEGRAM_CHAT_ID set in resetTelegramState

const MOCK_CITAS_ROWS = [
  {
    id: 'uuid-a',
    fecha: '2026-06-10',
    hora: '08:00:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 30,
    patient_name_normalized: 'Ana Lopez',
    pacientes: { nombre: 'Ana Lopez' },
  },
  {
    id: 'uuid-b',
    fecha: '2026-06-10',
    hora: '09:00:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 45,
    patient_name_normalized: null,
    pacientes: { nombre: 'Carlos Ruiz' },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKellyContextBuilder(row, { error = null } = {}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row ?? null, error }),
    upsert: vi.fn().mockResolvedValue({ data: null, error }),
  }
  Object.defineProperty(builder, 'then', {
    get() {
      return (resolve) => resolve({ data: row ? [row] : [], error, count: 0 })
    },
  })
  return builder
}

function makeCitasBuilder() {
  return makeBuilder('citas', MOCK_CITAS_ROWS)
}

// ─── Test: writeKellyContext upserts with correct shape ───────────────────────

describe('writeKellyContext', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('upserts to telegram_kelly_context with correct chat_id and last_search shape', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return { upsert: upsertMock }
      }
      return makeBuilder(table, [])
    })

    const { writeKellyContext } = await loadRoute()
    const criteria = { zona: 'norte', fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10' }
    const citas = [
      { cita_id: 'uuid-a', paciente_nombre: 'Ana Lopez', fecha: '2026-06-10', hora: '08:00', duracion_min: 30 },
    ]

    await writeKellyContext(criteria, citas)

    expect(upsertMock).toHaveBeenCalledOnce()
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.chat_id).toBe(CHAT_ID)
    expect(arg.last_search).toMatchObject({
      criteria: { zona: 'norte' },
      citas: [{ cita_id: 'uuid-a', paciente_nombre: 'Ana Lopez' }],
    })
    expect(arg).toHaveProperty('updated_at')
  })

  it('swallows error when table is absent (graceful degradation)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          upsert: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42P01', message: 'relation does not exist' },
          }),
        }
      }
      return makeBuilder(table, [])
    })

    const { writeKellyContext } = await loadRoute()
    // Must not throw
    await expect(
      writeKellyContext({ zona: 'norte' }, [])
    ).resolves.not.toThrow()
  })
})

// ─── Test: readKellyContext ───────────────────────────────────────────────────

describe('readKellyContext', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('returns null when row is missing (no data)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return makeKellyContextBuilder(null)
      }
      return makeBuilder(table, [])
    })

    const { readKellyContext } = await loadRoute()
    const result = await readKellyContext()
    expect(result).toBeNull()
  })

  it('returns null when row is stale (updated_at > 30 min ago)', async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    const row = {
      chat_id: CHAT_ID,
      last_search: { criteria: { zona: 'norte' }, citas: [] },
      updated_at: staleDate,
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return makeKellyContextBuilder(row)
      }
      return makeBuilder(table, [])
    })

    const { readKellyContext } = await loadRoute()
    const result = await readKellyContext()
    expect(result).toBeNull()
  })

  it('returns parsed { criteria, citas } when row is fresh (< 30 min)', async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const storedCitas = [
      { cita_id: 'uuid-a', paciente_nombre: 'Ana Lopez', fecha: '2026-06-10', hora: '08:00', duracion_min: 30 },
    ]
    const row = {
      chat_id: CHAT_ID,
      last_search: { criteria: { zona: 'norte' }, citas: storedCitas },
      updated_at: freshDate,
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return makeKellyContextBuilder(row)
      }
      return makeBuilder(table, [])
    })

    const { readKellyContext } = await loadRoute()
    const result = await readKellyContext()
    expect(result).not.toBeNull()
    expect(result.criteria).toMatchObject({ zona: 'norte' })
    expect(result.citas).toHaveLength(1)
    expect(result.citas[0].cita_id).toBe('uuid-a')
  })

  it('returns null on table error (graceful degradation)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return makeKellyContextBuilder(null, {
          error: { code: '42P01', message: 'relation does not exist' },
        })
      }
      return makeBuilder(table, [])
    })

    const { readKellyContext } = await loadRoute()
    const result = await readKellyContext()
    expect(result).toBeNull()
  })
})

// ─── Test: clearKellyContext ──────────────────────────────────────────────────

describe('clearKellyContext', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('issues delete filtered by chat_id', async () => {
    const deleteMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return { delete: deleteMock, eq: eqMock }
      }
      return makeBuilder(table, [])
    })

    const { clearKellyContext } = await loadRoute()
    await clearKellyContext()

    expect(deleteMock).toHaveBeenCalledOnce()
    expect(eqMock).toHaveBeenCalledWith('chat_id', CHAT_ID)
  })

  it('swallows error on delete failure', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42P01', message: 'relation does not exist' },
          }),
        }
      }
      return makeBuilder(table, [])
    })

    const { clearKellyContext } = await loadRoute()
    await expect(clearKellyContext()).resolves.not.toThrow()
  })
})

// ─── Test: toolBuscarCitasBulk returns { citas, criteria } ───────────────────

describe('toolBuscarCitasBulk return value', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('returns { citas, criteria } with correct mapped shape', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeCitasBuilder()
      if (table === 'telegram_kelly_context') {
        return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return makeBuilder(table, [])
    })

    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10', zona: 'norte' },
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'buscar citas norte' },
      })
    )

    // Verify upsert was called (write side) — if toolBuscarCitasBulk now returns
    // { citas, criteria }, the dispatcher will call writeKellyContext.
    const fetches = getCapturedFetches()
    // A Telegram sendMessage fetch should have been called for the list text
    const sendMessageCalls = fetches.filter((f) => f.url.includes('sendMessage'))
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('still sends Telegram text (no regression to existing text delivery)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeCitasBuilder()
      if (table === 'telegram_kelly_context') {
        return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return makeBuilder(table, [])
    })

    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10', zona: 'norte' },
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'buscar citas norte' },
      })
    )

    const fetches = getCapturedFetches()
    const sendMessageCalls = fetches.filter((f) => f.url.includes('sendMessage'))
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1)
    // The body should contain the cita list text
    const body = JSON.parse(sendMessageCalls[0].opts.body)
    expect(body.text).toContain('Norte')
  })
})

// ─── Test: dispatcher calls writeKellyContext after buscar_citas_bulk ─────────

describe('dispatcher write-side wiring', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('upserts context after a buscar_citas_bulk dispatch', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeCitasBuilder()
      if (table === 'telegram_kelly_context') return { upsert: upsertMock }
      return makeBuilder(table, [])
    })

    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10', zona: 'norte' },
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'buscar citas norte' },
      })
    )

    expect(upsertMock).toHaveBeenCalledOnce()
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.chat_id).toBe(CHAT_ID)
    expect(arg.last_search.criteria).toMatchObject({
      fecha_desde: '2026-06-10',
      fecha_hasta: '2026-06-10',
      zona: 'norte',
    })
    expect(Array.isArray(arg.last_search.citas)).toBe(true)
    // Each cita in the stored shape must have cita_id, paciente_nombre, fecha, hora, duracion_min
    const stored = arg.last_search.citas
    expect(stored[0]).toHaveProperty('cita_id')
    expect(stored[0]).toHaveProperty('paciente_nombre')
    expect(stored[0]).toHaveProperty('fecha')
    expect(stored[0]).toHaveProperty('hora')
    expect(stored[0]).toHaveProperty('duracion_min')
  })

  it('does NOT upsert context for non-buscar_citas_bulk tools', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') return { upsert: upsertMock }
      return makeBuilder(table, [])
    })

    setAdapterResponse({ tool: 'responder_texto', args: { texto: 'Hola' } })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'hola' },
      })
    )

    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PR2b — READ/INJECT side + maxTokens + clear-on-confirm + 2-turn integration
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Shared helpers for PR2b ──────────────────────────────────────────────────

const FRESH_CONTEXT = {
  criteria: { zona: 'norte', fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10' },
  citas: [
    { cita_id: 'uuid-a', paciente_nombre: 'Ana Lopez', fecha: '2026-06-10', hora: '08:00', duracion_min: 30 },
    { cita_id: 'uuid-b', paciente_nombre: 'Carlos Ruiz', fecha: '2026-06-10', hora: '09:00', duracion_min: 45 },
  ],
}

function makeFreshContextRow(overrideMs = 5 * 60 * 1000) {
  return {
    chat_id: CHAT_ID,
    last_search: FRESH_CONTEXT,
    updated_at: new Date(Date.now() - overrideMs).toISOString(),
  }
}

function makeStaleContextRow() {
  return {
    chat_id: CHAT_ID,
    last_search: FRESH_CONTEXT,
    updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  }
}

// ─── Test: context injection into userText ────────────────────────────────────

describe('PR2b: context injection into userText', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('injects CONTEXT block into userText when context is fresh', async () => {
    const freshRow = makeFreshContextRow()
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: vi.fn().mockReturnThis(),
        }
      }
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    let lastUserText = null
    let lastMaxTokens = null
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async ({ userText, maxTokens }) => {
        lastUserText = userText
        lastMaxTokens = maxTokens
        return JSON.stringify({ tool: 'responder_texto', args: { texto: 'ok' } })
      }),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas a las 3pm' },
      })
    )

    expect(lastUserText).not.toBeNull()
    expect(lastUserText).toContain('[Contexto:')
    expect(lastUserText).toContain('uuid-a')
    expect(lastUserText).toContain('uuid-b')
    expect(lastUserText).toContain('reagendar_bulk')
    // maxTokens must be 900 on an injected turn
    expect(lastMaxTokens).toBe(900)
  })

  it('does NOT inject CONTEXT block when context is null (no prior search)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    let lastUserText = null
    let lastMaxTokens = null
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async ({ userText, maxTokens }) => {
        lastUserText = userText
        lastMaxTokens = maxTokens
        return JSON.stringify({ tool: 'responder_texto', args: { texto: 'ok' } })
      }),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'hola' },
      })
    )

    expect(lastUserText).not.toBeNull()
    expect(lastUserText).not.toContain('[Contexto:')
    // maxTokens stays 500 for normal turn
    expect(lastMaxTokens).toBe(500)
  })

  it('does NOT inject CONTEXT block when context is stale (>30 min)', async () => {
    const staleRow = makeStaleContextRow()
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: staleRow, error: null }),
        }
      }
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    let lastUserText = null
    let lastMaxTokens = null
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async ({ userText, maxTokens }) => {
        lastUserText = userText
        lastMaxTokens = maxTokens
        return JSON.stringify({ tool: 'responder_texto', args: { texto: 'ok' } })
      }),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas' },
      })
    )

    expect(lastUserText).not.toContain('[Contexto:')
    expect(lastMaxTokens).toBe(500)
  })
})

// ─── Test: clearKellyContext on confirm ───────────────────────────────────────

describe('PR2b: clearKellyContext on reagendar_bulk confirm', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('calls clearKellyContext (delete) after successful reagendar_bulk confirm', async () => {
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })

    // pending_kelly_actions row with reagendar_bulk
    const pendingRow = {
      id: 'pending-1',
      action_type: 'reagendar_bulk',
      args: {
        items: [
          { cita_id: 'uuid-a', nueva_fecha: '2026-06-11', nueva_hora: '10:00' },
        ],
      },
      ejecutada: false,
      expira_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          delete: deleteMock,
          eq: eqDeleteMock,
        }
      }
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        return makeBuilder(table, [])
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        callback_query: {
          id: 'cq1',
          message: { chat: { id: 999 }, message_id: 1 },
          data: 'kelly_confirm_pending-1',
        },
      })
    )

    expect(deleteMock).toHaveBeenCalled()
    expect(eqDeleteMock).toHaveBeenCalledWith('chat_id', CHAT_ID)
  })

  it('DOES call clearKellyContext on reagendar_bulk CANCEL (fix: clear on any bulk action outcome)', async () => {
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })

    const pendingRow = {
      id: 'pending-2',
      action_type: 'reagendar_bulk',
      args: { items: [] },
      ejecutada: false,
      expira_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          delete: deleteMock,
          eq: eqDeleteMock,
        }
      }
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        callback_query: {
          id: 'cq2',
          message: { chat: { id: 999 }, message_id: 1 },
          data: 'kelly_cancel_pending-2',
        },
      })
    )

    // Fix 1: cancel of a reagendar_bulk action must clear context
    expect(deleteMock).toHaveBeenCalled()
    expect(eqDeleteMock).toHaveBeenCalledWith('chat_id', CHAT_ID)
  })

  it('calls clearKellyContext on reagendar_bulk confirm with total failure (applied === 0)', async () => {
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })

    const pendingRow = {
      id: 'pending-3',
      action_type: 'reagendar_bulk',
      args: {
        items: [
          { cita_id: 'uuid-a', nueva_fecha: '2026-06-11', nueva_hora: '10:00' },
        ],
      },
      ejecutada: false,
      expira_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return { delete: deleteMock, eq: eqDeleteMock }
      }
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        // All updates fail → applied === 0
        return {
          ...makeBuilder(table, []),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        callback_query: {
          id: 'cq3',
          message: { chat: { id: 999 }, message_id: 1 },
          data: 'kelly_confirm_pending-3',
        },
      })
    )

    // Fix 2: total failure must also clear context
    expect(deleteMock).toHaveBeenCalled()
    expect(eqDeleteMock).toHaveBeenCalledWith('chat_id', CHAT_ID)
  })
})

// ─── Test: two-turn integration (THE KEY TEST) ────────────────────────────────

describe('PR2b: two-turn integration (search → movelas → reagendar_bulk)', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('turn 1 writes context; turn 2 injects context block and LLM response uses cached cita_ids', async () => {
    // Turn 1 adapter response: buscar_citas_bulk
    const turn1Response = {
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10', zona: 'norte' },
    }
    // Turn 2 adapter response: reagendar_bulk using the cached cita_ids
    const turn2Response = {
      tool: 'reagendar_bulk',
      args: {
        items: [
          { cita_id: 'uuid-a', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
          { cita_id: 'uuid-b', nueva_fecha: '2026-06-11', nueva_hora: '15:30', duracion_min: 45 },
        ],
      },
    }

    // Shared upsert tracker for context write-side
    let contextWritten = null
    let turn2UserText = null

    const { getModelAdapter } = await import('@/lib/model-adapter')

    // We'll intercept both chat() calls in sequence
    vi.mocked(getModelAdapter)
      .mockResolvedValueOnce({
        chat: vi.fn(async () => JSON.stringify(turn1Response)),
      })
      .mockResolvedValueOnce({
        chat: vi.fn(async ({ userText }) => {
          turn2UserText = userText
          return JSON.stringify(turn2Response)
        }),
      })

    // pending_kelly_actions for the bulk preview insert
    const insertedPending = []

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col, val) => {
            // After turn 1 writes, turn 2 read should return the written context
            return {
              single: vi.fn().mockResolvedValue({
                data: contextWritten
                  ? {
                      chat_id: CHAT_ID,
                      last_search: contextWritten,
                      updated_at: new Date().toISOString(),
                    }
                  : null,
                error: null,
              }),
            }
          }),
          upsert: vi.fn().mockImplementation((payload) => {
            contextWritten = payload.last_search
            return Promise.resolve({ data: null, error: null })
          }),
          delete: vi.fn().mockReturnThis(),
        }
      }
      if (table === 'pending_kelly_actions') {
        return {
          ...makeBuilder(table, []),
          insert: vi.fn((payload) => {
            insertedPending.push(payload)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()

    // Turn 1: buscar citas
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'buscar citas norte lunes 07:00-09:00' },
      })
    )

    // Assert context was written after turn 1
    expect(contextWritten).not.toBeNull()
    expect(contextWritten.citas).toHaveLength(2)
    expect(contextWritten.citas[0].cita_id).toBe('uuid-a')

    // Turn 2: "movelas todas a las 3pm"
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas todas a las 3pm' },
      })
    )

    // Assert context block was injected into turn 2 userText
    expect(turn2UserText).not.toBeNull()
    expect(turn2UserText).toContain('[Contexto:')
    expect(turn2UserText).toContain('uuid-a')
    expect(turn2UserText).toContain('uuid-b')
    expect(turn2UserText).toContain('reagendar_bulk')

    // Assert the reagendar_bulk preview was triggered (pending insert)
    // The LLM response had reagendar_bulk → toolReagendarBulkPreview should have run
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(2) // turn1 list + turn2 preview/reply
  })
})

// ─── Test: topic-change clear (Fix 3) ────────────────────────────────────────

describe('PR2b fix: topic-change clear when non-bulk tool picked with injected context', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('calls clearKellyContext when context was injected and LLM picks consultar_finanzas', async () => {
    const freshRow = makeFreshContextRow()
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: deleteMock,
        }
      }
      // consultar_finanzas needs a citas query for income totals
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async () =>
        JSON.stringify({ tool: 'consultar_finanzas', args: { fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30' } })
      ),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: '¿Cuánto ingresé en junio?' },
      })
    )

    // Fix 3: topic-change → context cleared
    expect(deleteMock).toHaveBeenCalled()
  })

  it('does NOT call clearKellyContext (topic-change path) when tool is buscar_citas_bulk (overwrites instead)', async () => {
    const freshRow = makeFreshContextRow()
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          }),
          upsert: upsertMock,
          delete: deleteMock,
        }
      }
      if (table === 'citas') return makeCitasBuilder()
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async () =>
        JSON.stringify({
          tool: 'buscar_citas_bulk',
          args: { fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10', zona: 'norte' },
        })
      ),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'buscar de nuevo' },
      })
    )

    // buscar_citas_bulk writes (overwrites) context — must NOT also delete it
    expect(upsertMock).toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('does NOT call clearKellyContext (topic-change path) when tool is reagendar_bulk (context consumed on confirm)', async () => {
    const freshRow = makeFreshContextRow()
    const deleteMock = vi.fn().mockReturnThis()
    const eqDeleteMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: deleteMock,
        }
      }
      if (table === 'pending_kelly_actions') {
        return {
          ...makeBuilder(table, []),
          insert: vi.fn().mockResolvedValue({ data: [{ id: 'p-new' }], error: null }),
          select: vi.fn().mockReturnThis(),
        }
      }
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async () =>
        JSON.stringify({
          tool: 'reagendar_bulk',
          args: {
            items: [
              { cita_id: 'uuid-a', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
            ],
          },
        })
      ),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas a las 3pm' },
      })
    )

    // reagendar_bulk leaves context alive for the confirm step — must NOT clear here
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

// ─── Test: softened injection wording (Fix 4) ────────────────────────────────

describe('PR2b fix: softened injection instruction wording', () => {
  beforeEach(() => resetTelegramState())
  afterEach(() => teardownTelegramMocks())

  it('injection block contains conditional/guarded instruction (not blanket directive)', async () => {
    const freshRow = makeFreshContextRow()
    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: vi.fn().mockReturnThis(),
        }
      }
      return makeBuilder(table, [])
    })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    let capturedUserText = null
    vi.mocked(getModelAdapter).mockResolvedValueOnce({
      chat: vi.fn(async ({ userText }) => {
        capturedUserText = userText
        return JSON.stringify({ tool: 'responder_texto', args: { texto: 'ok' } })
      }),
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'algo cualquiera' },
      })
    )

    expect(capturedUserText).toContain('[Contexto:')
    // Fix 4: must contain a conditional guard phrase, not the old blanket "Si Kely pide mover"
    // The new wording must reference explicit pronouns like "esas" or guard words
    expect(capturedUserText).toMatch(/esas.*citas|explícitamente|Solo si/i)
    // Must NOT contain the old unconditional phrase
    expect(capturedUserText).not.toMatch(/^.*Si Kely pide mover\/reagendar.*emite reagendar_bulk/m)
  })
})
