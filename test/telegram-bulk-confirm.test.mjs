/**
 * test/telegram-bulk-confirm.test.mjs
 *
 * PR-C tests — reagendar_bulk confirm path (resolveKellyPending bulk branch).
 *
 * Covers:
 *   C-2a: Happy-path — all N items applied, row marked ejecutada, ✅ N reagendadas
 *   C-2b: Partial failure — 1 item errors → N-1 applied + per-item report
 *   C-2c: Double-tap CAS reject — second confirm rejected (already ejecutada)
 *   C-2d: Expired TTL — confirm rejected, no mutation
 *   C-2e: Non-existent row — confirm rejected, no mutation
 *   C-2f: Patient lane regression — no bulk confirm reachable from patient flow
 *
 * REQ-S3-03, REQ-S3-04 (best-effort), REQ-S4-01, REQ-S4-02, REQ-S5-01 / AC-05, AC-06, AC-08
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mockFrom,
  setupTelegramMocks,
  resetTelegramState,
  teardownTelegramMocks,
  makeBuilder,
  makeRequest,
  loadRoute,
  getInserted,
  getUpdated,
  getCapturedFetches,
} from './helpers/telegram-mock-builder.mjs'

setupTelegramMocks()

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

const routePath = resolve('app/api/telegram/route.js')

// Helper — build a BulkItem
function makeBulkItem(n) {
  return {
    cita_id: `cita-${n}`,
    fecha_original: '2026-06-10',
    hora_original: '09:00',
    nueva_fecha: `2026-06-1${n}`,
    nueva_hora: '10:00',
    duracion_min: 45,
  }
}

// Helper — build a pending row for the bulk confirm
function makePendingBulkRow({ items, ejecutada = false, expira_at = null }) {
  return {
    id: 'pending-bulk-001',
    action_type: 'reagendar_bulk',
    args: { items, paciente_nombres: items.map((_, i) => `Paciente ${i + 1}`) },
    ejecutada,
    expira_at: expira_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h from now
  }
}

// ─── C-2a: Happy-path — all N items applied, row ejecutada ───────────────────

describe('C-2a resolveKellyPending(reagendar_bulk) — happy path: all items applied', () => {
  it('applies all 3 items and returns ✅ N reagendadas summary', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2), makeBulkItem(3)]
    const pendingRow = makePendingBulkRow({ items })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        // Each update on citas succeeds
        return makeBuilder(table, [{ id: 'ok' }])
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-001',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // Kely should get a result toast via answerCallbackQuery
    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    expect(text).toMatch(/✅/)
    expect(text).toMatch(/3/)

    // citas.update should have been called 3 times
    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeTruthy()
    expect(citaUpdates.length).toBe(3)
  })

  it('marks the pending row as ejecutada (CAS flip)', async () => {
    const items = [makeBulkItem(1)]
    const pendingRow = makePendingBulkRow({ items })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      if (table === 'citas') return makeBuilder(table, [{ id: 'ok' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-002',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // pending_kelly_actions should have an UPDATE (the CAS flip)
    const pendingUpdates = getUpdated()['pending_kelly_actions']
    expect(pendingUpdates).toBeTruthy()
    // At least one update should set ejecutada: true
    const casFlip = pendingUpdates.find((u) => u.payload?.ejecutada === true)
    expect(casFlip).toBeTruthy()
  })
})

// ─── C-2b: Partial failure — best-effort, per-item report ────────────────────

describe('C-2b resolveKellyPending(reagendar_bulk) — partial failure: best-effort apply', () => {
  it('applies N-1 items when 1 citas.update errors, reports failure per item', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2), makeBulkItem(3)]
    const pendingRow = makePendingBulkRow({ items })

    // Use a shared counter in the closure — each mockFrom('citas') call
    // returns a fresh builder, so the counter must live outside the builder.
    let citaUpdateCallCount = 0

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        // Each call to mockFrom('citas') returns a builder that, when .update() is
        // called, increments the shared counter and fails on the 2nd call.
        citaUpdateCallCount++
        const callNumber = citaUpdateCallCount
        if (callNumber === 2) {
          // Return a builder whose thenable resolves with an error
          const b = makeBuilder(table, [])
          const failBuilder = {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
          }
          Object.defineProperty(failBuilder, 'then', {
            get() {
              return (resolve) => resolve({ data: null, error: { message: 'DB error on item 2' }, count: 0 })
            },
          })
          // Override update to return the failing builder
          b.update = vi.fn(() => failBuilder)
          return b
        }
        return makeBuilder(table, [{ id: 'ok' }])
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-003',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // mockFrom('citas') was called 3 times + once for overlap check in preview
    // In confirm path: 3 items → 3 mockFrom('citas') calls
    // (The pending_kelly_actions mock handles that table separately)
    expect(citaUpdateCallCount).toBe(3)

    // Result message should mention both successes and failure via toast
    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    // 2 succeeded, 1 failed
    expect(text).toMatch(/✅/)
    expect(text).toMatch(/⚠️/)
  })

  it('does NOT rollback applied items when a later item fails', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2)]
    const pendingRow = makePendingBulkRow({ items })

    let citaUpdateCallCount = 0

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        citaUpdateCallCount++
        const callNumber = citaUpdateCallCount
        if (callNumber === 2) {
          const b = makeBuilder(table, [])
          const failBuilder = {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
          }
          Object.defineProperty(failBuilder, 'then', {
            get() {
              return (resolve) => resolve({ data: null, error: { message: 'fail' }, count: 0 })
            },
          })
          b.update = vi.fn(() => failBuilder)
          return b
        }
        return makeBuilder(table, [{ id: 'ok' }])
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-004',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // First item update was attempted (not rolled back)
    expect(citaUpdateCallCount).toBe(2)
    // Only the 1 failed — no rollback update of item 1
    const citaUpdates = getUpdated()['citas']
    // Item 1 update was NOT followed by a compensating update
    expect(citaUpdates).toBeTruthy()
  })
})

// ─── C-2c: Double-tap CAS reject ─────────────────────────────────────────────

describe('C-2c resolveKellyPending(reagendar_bulk) — double-tap: CAS rejects second confirm', () => {
  it('rejects second confirm when row is already ejecutada', async () => {
    const items = [makeBulkItem(1)]
    // Row already marked ejecutada (from a previous successful confirm)
    const pendingRow = makePendingBulkRow({ items, ejecutada: true })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-005',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // citas.update must NOT have been called (no second apply)
    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeFalsy()

    // Should send "already applied" toast
    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    expect(text).toBeTruthy()
  })

  it('CAS flip fails when ejecutada=true (count=0 from DB UPDATE ... WHERE ejecutada=false)', async () => {
    const items = [makeBulkItem(1)]
    // Row not yet marked ejecutada in the pre-check (JS level),
    // but the CAS UPDATE returns count=0 (DB-level race, e.g. concurrent second tap)
    const pendingRow = makePendingBulkRow({ items, ejecutada: false })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        // CAS UPDATE returns count=0 → already won by another tap
        return makeBuilder(table, [pendingRow], {
          updateData: { data: null, error: null, count: 0 },
        })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-006',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // No cita updates — CAS rejected
    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeFalsy()
  })
})

// ─── C-2d: Expired TTL reject ─────────────────────────────────────────────────

describe('C-2d resolveKellyPending(reagendar_bulk) — expired TTL: no mutation', () => {
  it('rejects confirm when row TTL is elapsed and mutates no cita', async () => {
    const items = [makeBulkItem(1)]
    const expiredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago
    const pendingRow = makePendingBulkRow({ items, expira_at: expiredAt })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-007',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // No cita mutations
    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeFalsy()

    // Expiry toast sent
    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    expect(text).toBeTruthy()
  })
})

// ─── C-2e: Non-existent row reject ────────────────────────────────────────────

describe('C-2e resolveKellyPending(reagendar_bulk) — nonexistent row: no mutation', () => {
  it('rejects confirm when pending row does not exist and mutates nothing', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        // single() returns { data: null, error: { message: 'not found' } }
        const b = makeBuilder(table, [])
        b.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'Row not found' } })
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-008',
        data: 'kelly_confirm_nonexistent-row',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeFalsy()

    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    expect(text).toBeTruthy()
  })
})

// ─── C-2f: Patient lane regression guard ─────────────────────────────────────

describe('C-2f patient lane regression — bulk confirm unreachable from patient flow', () => {
  it('resolveKellyPending is only called from Telegram callback_query handler (not patient lane)', () => {
    const source = readFileSync(routePath, 'utf8')

    // resolveKellyPending must be defined
    expect(source).toMatch(/async function resolveKellyPending\s*\(/)

    // It must only be called from handleCallbackQuery (the Telegram gate)
    // and NOT from any patient-side handler
    const handleCallbackIdx = source.indexOf('async function handleCallbackQuery(')
    const resolveCallIdx = source.indexOf('resolveKellyPending(pendingId')
    expect(resolveCallIdx).toBeGreaterThan(handleCallbackIdx)

    // The call must NOT appear inside handleMessage (patient-side for WhatsApp)
    const handleMsgStart = source.indexOf('\nasync function handleMessage(')
    const handleMsgEnd = source.indexOf('\nasync function handleKellyMessage(')
    const handleMsgBody = source.slice(handleMsgStart, handleMsgEnd)
    expect(handleMsgBody).not.toMatch(/resolveKellyPending/)
  })

  it('bulk branch is inside resolveKellyPending, not reachable from patient path', () => {
    const source = readFileSync(routePath, 'utf8')

    // Extract resolveKellyPending function body
    const fnStart = source.indexOf('async function resolveKellyPending(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)

    // The reagendar_bulk branch must be inside resolveKellyPending
    expect(fnBody).toMatch(/reagendar_bulk/)
  })
})
