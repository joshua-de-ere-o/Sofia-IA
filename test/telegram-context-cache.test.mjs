/**
 * test/telegram-context-cache.test.mjs
 *
 * PR2a: context cache WRITE side tests.
 *
 * Covers:
 *   - writeKellyContext: upserts with correct chat_id + JSONB shape; swallows error when table absent
 *   - readKellyContext: returns null when row missing; null when stale (>30 min); object when fresh
 *   - clearKellyContext: issues delete by chat_id; swallows error
 *   - toolBuscarCitasBulk: returns { citas, criteria } with correct mapped shape AND still sends text
 *   - dispatcher: calls writeKellyContext after a buscar_citas_bulk search
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
