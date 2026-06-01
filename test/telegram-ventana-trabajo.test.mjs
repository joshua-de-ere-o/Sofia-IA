/**
 * test/telegram-ventana-trabajo.test.mjs
 *
 * PR3 tests — planificar_ventana_trabajo tool + anti-hallucination cita_id guard.
 *
 * Covers:
 *   VT-1: planificar_ventana_trabajo dispatches hora-filtered query, persists context,
 *         sends list to Kely, does NOT write to pending_kelly_actions.
 *   VT-2: planificar_ventana_trabajo is excluded from the topic-change clear guard
 *         (writes context, must not be cleared same turn).
 *   VT-3: anti-hallucination guard in toolReagendarBulkPreview — some ids stale:
 *         preview proceeds with survivors, dropped count surfaced in summary.
 *   VT-4: anti-hallucination guard — zero valid ids: sendToKely clarification,
 *         NO INSERT into pending_kelly_actions.
 *   VT-5: anti-hallucination guard — all ids valid: preview proceeds with all items.
 *   VT-6: anti-hallucination guard uses BULK_EXCLUDED_STATES (excluded-state cita is dropped).
 *   VT-7: planificar_ventana_trabajo with telegram_kelly_context table absent →
 *         graceful degradation, no thrown error.
 *   VT-8: source contract — toolPlanificarVentanaTrabajo function defined in route.js.
 *   VT-9: source contract — KELLY_SYSTEM_PROMPT includes planificar_ventana_trabajo.
 *   VT-10: source contract — dispatcher switch includes planificar_ventana_trabajo case.
 *
 * REQ-3.1, REQ-3.2, REQ-3.3, REQ-3.4, REQ-3.5, REQ-2.5, REQ-X.3
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mockFrom,
  resetTelegramState,
  teardownTelegramMocks,
  makeBuilder,
  makeRequest,
  loadRoute,
  getInserted,
  getCapturedFetches,
  setAdapterResponse,
} from './helpers/telegram-mock-builder.mjs'

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

const routePath = resolve('app/api/telegram/route.js')

// ─── Shared test data ─────────────────────────────────────────────────────────

const CHAT_ID = '999'

const MOCK_CITAS_ROWS = [
  {
    id: 'uuid-v1',
    fecha: '2026-06-02',
    hora: '07:30:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 30,
    patient_name_normalized: 'Ana Lopez',
    pacientes: { nombre: 'Ana Lopez' },
  },
  {
    id: 'uuid-v2',
    fecha: '2026-06-02',
    hora: '08:00:00',
    zona: 'norte',
    estado: 'confirmada',
    duracion_min: 45,
    patient_name_normalized: null,
    pacientes: { nombre: 'Carlos Ruiz' },
  },
]

// Build a fresh context-write mock that can also handle reads.
// Returns a mock builder for telegram_kelly_context table.
function makeKellyCtxWriteOnly() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    delete: vi.fn().mockReturnThis(),
  }
}

// ─── VT-8/9/10: Source contracts ──────────────────────────────────────────────

describe('VT-8/9/10 source contracts — planificar_ventana_trabajo in route.js', () => {
  it('toolPlanificarVentanaTrabajo function is defined', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/async function toolPlanificarVentanaTrabajo\s*\(/)
  })

  it('KELLY_SYSTEM_PROMPT includes planificar_ventana_trabajo tool entry', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/planificar_ventana_trabajo/)
  })

  it('dispatcher switch includes planificar_ventana_trabajo case', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/case\s+'planificar_ventana_trabajo'/)
  })
})

// ─── VT-1: planificar_ventana_trabajo dispatches query, persists context, sends list ─

describe('VT-1: planificar_ventana_trabajo — query + context persist + sendToKely (no pending INSERT)', () => {
  it('dispatches hora-filtered query, writes context, sends list, does NOT insert into pending_kelly_actions', async () => {
    setAdapterResponse({
      tool: 'planificar_ventana_trabajo',
      args: { zona: 'norte', fecha: '2026-06-02', hora_desde: '07:00', hora_hasta: '09:00' },
    })

    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      if (table === 'telegram_kelly_context') {
        return {
          ...makeKellyCtxWriteOnly(),
          upsert: upsertMock,
        }
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'el lunes voy al norte de 7 a 9' },
      })
    )

    // Must NOT write to pending_kelly_actions (tool is query-only)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // Must upsert context (write context cache)
    expect(upsertMock).toHaveBeenCalledOnce()
    const upsertArg = upsertMock.mock.calls[0][0]
    expect(upsertArg.chat_id).toBe(CHAT_ID)
    expect(upsertArg.last_search).toMatchObject({
      criteria: expect.objectContaining({ zona: 'norte' }),
      citas: expect.arrayContaining([
        expect.objectContaining({ cita_id: 'uuid-v1' }),
      ]),
    })

    // Must send a list to Kely (sendMessage fetch)
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sends[0].opts.body)
    // Message must contain patient names from the search results
    expect(body.text).toMatch(/Ana Lopez/)
  })

  it('sends a follow-up prompt asking Kely to state the move target', async () => {
    setAdapterResponse({
      tool: 'planificar_ventana_trabajo',
      args: { zona: 'norte', fecha: '2026-06-02', hora_desde: '07:00', hora_hasta: '09:00' },
    })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      if (table === 'telegram_kelly_context') return makeKellyCtxWriteOnly()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'el martes en norte 7-9' },
      })
    )

    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    // At least one message should prompt Kely to specify the target hour
    const allText = sends.map((s) => {
      try { return JSON.parse(s.opts.body).text || '' } catch { return '' }
    }).join('\n')
    // Should mention moving/scheduling — a prompt to Kely asking what time to move to
    expect(allText).toMatch(/hora|muevo|mover|reagendar/i)
  })

  it('citas context shape has cita_id, paciente_nombre, fecha, hora, duracion_min', async () => {
    setAdapterResponse({
      tool: 'planificar_ventana_trabajo',
      args: { zona: 'norte', fecha: '2026-06-02', hora_desde: '07:00', hora_hasta: '09:00' },
    })

    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      if (table === 'telegram_kelly_context') {
        return { ...makeKellyCtxWriteOnly(), upsert: upsertMock }
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'ventana norte 7-9' },
      })
    )

    expect(upsertMock).toHaveBeenCalledOnce()
    const stored = upsertMock.mock.calls[0][0].last_search.citas
    expect(stored[0]).toHaveProperty('cita_id')
    expect(stored[0]).toHaveProperty('paciente_nombre')
    expect(stored[0]).toHaveProperty('fecha')
    expect(stored[0]).toHaveProperty('hora')
    expect(stored[0]).toHaveProperty('duracion_min')
  })
})

// ─── VT-2: planificar_ventana_trabajo excluded from topic-change clear ───────

describe('VT-2: planificar_ventana_trabajo — excluded from topic-change clear guard', () => {
  it('does NOT call clearKellyContext when context existed and tool is planificar_ventana_trabajo', async () => {
    // Set up a fresh context row (simulates prior buscar_citas_bulk search)
    const freshRow = {
      chat_id: CHAT_ID,
      last_search: {
        criteria: { zona: 'norte', fecha_desde: '2026-06-02', fecha_hasta: '2026-06-02' },
        citas: [
          { cita_id: 'uuid-v1', paciente_nombre: 'Ana Lopez', fecha: '2026-06-02', hora: '07:30', duracion_min: 30 },
        ],
      },
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }

    setAdapterResponse({
      tool: 'planificar_ventana_trabajo',
      args: { zona: 'norte', fecha: '2026-06-02', hora_desde: '07:00', hora_hasta: '09:00' },
    })

    const deleteMock = vi.fn().mockReturnThis()
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: freshRow, error: null }),
          upsert: upsertMock,
          delete: deleteMock,
        }
      }
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'el lunes en norte 7-9' },
      })
    )

    // planificar_ventana_trabajo writes (overwrites) context — must NOT also delete it
    expect(upsertMock).toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

// ─── VT-3: guard — some ids stale: proceed with survivors ────────────────────

describe('VT-3: anti-hallucination guard — some ids stale, preview proceeds with survivors', () => {
  it('drops stale id D, proceeds with [A, B], dropped count visible in summary', async () => {
    // Items: A(uuid-a), B(uuid-b), D(stale-uuid-d — not in live DB)
    const items = [
      { cita_id: 'uuid-a', fecha_original: '2026-06-10', hora_original: '09:00', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
      { cita_id: 'uuid-b', fecha_original: '2026-06-10', hora_original: '10:00', nueva_fecha: '2026-06-11', nueva_hora: '15:30', duracion_min: 45 },
      { cita_id: 'stale-uuid-d', fecha_original: '2026-06-10', hora_original: '11:00', nueva_fecha: '2026-06-11', nueva_hora: '16:00', duracion_min: 30 },
    ]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // Live citas DB: only uuid-a and uuid-b are active (stale-uuid-d is absent / excluded)
    const liveCitas = [
      { id: 'uuid-a', estado: 'confirmada', fecha: '2026-06-11', hora: '08:00:00', duracion_min: 30 },
      { id: 'uuid-b', estado: 'confirmada', fecha: '2026-06-11', hora: '08:30:00', duracion_min: 45 },
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, liveCitas)
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'pending-guard-test' }])
      if (table === 'telegram_kelly_context') return makeKellyCtxWriteOnly()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas a las 3pm' },
      })
    )

    // Preview MUST proceed (pending row inserted with valid items only)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeTruthy()
    expect(pendingInserts).toHaveLength(1)
    expect(pendingInserts[0].action_type).toBe('reagendar_bulk')

    // Only uuid-a and uuid-b should be in the surviving items
    const survivingItems = pendingInserts[0].args.items
    expect(survivingItems).toHaveLength(2)
    const ids = survivingItems.map((i) => i.cita_id)
    expect(ids).toContain('uuid-a')
    expect(ids).toContain('uuid-b')
    expect(ids).not.toContain('stale-uuid-d')

    // Summary must mention the dropped count
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    const previewSend = sends.find((s) => {
      try {
        const body = JSON.parse(s.opts.body)
        return body.reply_markup?.inline_keyboard
      } catch { return false }
    })
    expect(previewSend).toBeDefined()
    const previewText = JSON.parse(previewSend.opts.body).text
    expect(previewText).toMatch(/1.*eliminad|1.*descartad|1.*ignorad|dropped|1.*no\s+activ|removid/i)
  })
})

// ─── VT-4: guard — zero valid ids: clarification message, no INSERT ───────────

describe('VT-4: anti-hallucination guard — zero valid ids: clarification, NO pending INSERT', () => {
  it('sends clarification and does NOT insert pending row when all ids are invalid', async () => {
    const items = [
      { cita_id: 'ghost-1', fecha_original: '2026-06-10', hora_original: '09:00', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
      { cita_id: 'ghost-2', fecha_original: '2026-06-10', hora_original: '10:00', nueva_fecha: '2026-06-11', nueva_hora: '15:30', duracion_min: 45 },
    ]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // Live DB returns empty — none of the ids are found/active
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'telegram_kelly_context') return makeKellyCtxWriteOnly()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas a las 3pm' },
      })
    )

    // Must NOT insert a pending row
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // Must send a clarification message (no inline_keyboard)
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sends[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeFalsy()
    // Message must indicate the citas are no longer active
    expect(body.text).toMatch(/ya no\s+están|no existen|volvé|buscalas|búscalas|activas/i)
  })
})

// ─── VT-5: guard — all ids valid: preview proceeds with all items ──────────

describe('VT-5: anti-hallucination guard — all ids valid: preview proceeds normally', () => {
  it('proceeds with all items when all cita_ids are found in DB and active', async () => {
    const items = [
      { cita_id: 'uuid-x1', fecha_original: '2026-06-10', hora_original: '09:00', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
      { cita_id: 'uuid-x2', fecha_original: '2026-06-10', hora_original: '10:00', nueva_fecha: '2026-06-11', nueva_hora: '15:30', duracion_min: 45 },
    ]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // Live DB returns both ids as active
    const liveCitas = [
      { id: 'uuid-x1', estado: 'confirmada', fecha: '2026-06-11', hora: '08:00:00', duracion_min: 30 },
      { id: 'uuid-x2', estado: 'confirmada', fecha: '2026-06-11', hora: '08:30:00', duracion_min: 45 },
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, liveCitas)
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'pending-all-valid' }])
      if (table === 'telegram_kelly_context') return makeKellyCtxWriteOnly()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas' },
      })
    )

    // All items should be in the pending row
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeTruthy()
    expect(pendingInserts).toHaveLength(1)
    const insertedItems = pendingInserts[0].args.items
    expect(insertedItems).toHaveLength(2)
    expect(insertedItems.map((i) => i.cita_id)).toEqual(
      expect.arrayContaining(['uuid-x1', 'uuid-x2'])
    )
  })
})

// ─── VT-6: guard uses BULK_EXCLUDED_STATES — excluded-state cita is dropped ──

describe('VT-6: anti-hallucination guard uses BULK_EXCLUDED_STATES (excluded-state cita dropped)', () => {
  it('drops a cita whose estado is in BULK_EXCLUDED_STATES (cancelada)', async () => {
    const items = [
      { cita_id: 'uuid-ok', fecha_original: '2026-06-10', hora_original: '09:00', nueva_fecha: '2026-06-11', nueva_hora: '15:00', duracion_min: 30 },
      { cita_id: 'uuid-cancelled', fecha_original: '2026-06-10', hora_original: '10:00', nueva_fecha: '2026-06-11', nueva_hora: '15:30', duracion_min: 45 },
    ]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // The guard query uses .not('estado','in','(cancelada,no_show,rechazada)') so the
    // mock returns only uuid-ok (cancelada id is excluded by the NOT filter at DB level).
    // We simulate this by returning only the active cita from the mock.
    const liveCitas = [
      { id: 'uuid-ok', estado: 'confirmada', fecha: '2026-06-11', hora: '08:00:00', duracion_min: 30 },
      // uuid-cancelled intentionally absent (excluded by .not filter)
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, liveCitas)
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'pending-excl-test' }])
      if (table === 'telegram_kelly_context') return makeKellyCtxWriteOnly()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(
      makeRequest({
        message: { chat: { id: 999 }, from: { id: 999 }, text: 'movelas' },
      })
    )

    // Preview must proceed (one valid item survived)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeTruthy()
    const survivingItems = pendingInserts[0].args.items
    expect(survivingItems).toHaveLength(1)
    expect(survivingItems[0].cita_id).toBe('uuid-ok')
  })
})

// ─── VT-7: planificar_ventana_trabajo with table absent → graceful degradation ─

describe('VT-7: planificar_ventana_trabajo — telegram_kelly_context table absent: graceful degradation', () => {
  it('completes without throwing when context table is absent (42P01-equivalent)', async () => {
    setAdapterResponse({
      tool: 'planificar_ventana_trabajo',
      args: { zona: 'norte', fecha: '2026-06-02', hora_desde: '07:00', hora_hasta: '09:00' },
    })

    mockFrom.mockImplementation((table) => {
      if (table === 'telegram_kelly_context') {
        // Simulate table absent: upsert returns a 42P01-like error
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42P01', message: 'relation "telegram_kelly_context" does not exist' },
          }),
          upsert: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42P01', message: 'relation "telegram_kelly_context" does not exist' },
          }),
          delete: vi.fn().mockReturnThis(),
        }
      }
      if (table === 'citas') return makeBuilder(table, MOCK_CITAS_ROWS)
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()

    // Must not throw
    await expect(
      POST(
        makeRequest({
          message: { chat: { id: 999 }, from: { id: 999 }, text: 'el lunes en norte 7-9' },
        })
      )
    ).resolves.toBeDefined()

    // No pending insert (not a reagendar_bulk tool)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // Should still send the list (tool ran despite context error)
    const sends = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sends.length).toBeGreaterThanOrEqual(1)
  })
})
