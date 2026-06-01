/**
 * test/telegram-bulk-confirm.test.mjs
 *
 * PR-C tests — reagendar_bulk confirm path (resolveKellyPending bulk branch).
 *
 * Covers:
 *   C-2a: Happy-path — all N items applied, row marked ejecutada, ✅ N reagendadas
 *   C-2b: Partial failure — 1 item errors → N-1 applied + per-item report
 *   C-2b-z: All items fail — ⚠️ message, no ✅ 0
 *   C-2c: Double-tap CAS reject — second confirm rejected (already ejecutada)
 *   C-2d: Expired TTL — confirm rejected, no mutation
 *   C-2e: Non-existent row — confirm rejected, no mutation
 *   C-2f: Patient lane regression — no bulk confirm reachable from patient flow
 *   C-2g: Work-first verify — UPDATE returns 0 rows → status failed, ejecutada NOT set
 *   C-2h: Ordering — ejecutada set only AFTER successful UPDATE
 *   C-2i: Single-action dedup — bloqueo/evento_personal duplicate tap does NOT insert twice
 *
 * REQ-S3-03, REQ-S3-04 (best-effort), REQ-S4-01, REQ-S4-02, REQ-S5-01 / AC-05, AC-06, AC-08
 * BUG-FIX: work-first + rows-affected verify for UPDATE actions; CAS-first preserved for INSERTs
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

  it('does NOT rollback applied items when a later item fails — exactly N-1 updates applied', async () => {
    // 3 items: items 1 and 3 succeed, item 2 fails.
    // After the run: exactly 2 cita updates must be recorded (the non-failing ones),
    // and none of those updates should be a compensating revert (no segunda pasada).
    const items = [makeBulkItem(1), makeBulkItem(2), makeBulkItem(3)]
    const pendingRow = makePendingBulkRow({ items })

    let citaUpdateCallCount = 0
    // Track what was actually applied: collect successful (nueva_fecha, nueva_hora) payloads
    const appliedPayloads = []

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        citaUpdateCallCount++
        const callNumber = citaUpdateCallCount
        if (callNumber === 2) {
          // Item 2 fails
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
          b.update = vi.fn((payload) => {
            // failing item — do NOT push to appliedPayloads
            return failBuilder
          })
          return b
        }
        // Items 1 and 3 succeed — capture their payloads
        const b = makeBuilder(table, [{ id: 'ok' }])
        const origUpdate = b.update.bind(b)
        b.update = vi.fn((payload) => {
          appliedPayloads.push(payload)
          return origUpdate(payload)
        })
        return b
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

    // All 3 items were attempted (best-effort loop iterates all)
    expect(citaUpdateCallCount).toBe(3)

    // Exactly N-1 = 2 updates were successfully applied (items 1 and 3)
    expect(appliedPayloads).toHaveLength(2)

    // The applied payloads carry the new schedule (nueva_fecha/nueva_hora) —
    // not a revert back to fecha_original/hora_original
    expect(appliedPayloads[0]).toMatchObject({ fecha: makeBulkItem(1).nueva_fecha, hora: makeBulkItem(1).nueva_hora })
    expect(appliedPayloads[1]).toMatchObject({ fecha: makeBulkItem(3).nueva_fecha, hora: makeBulkItem(3).nueva_hora })

    // The DB record count reflects 3 attempts (not 4 or 5 from rollback compensations)
    const citaUpdates = getUpdated()['citas']
    expect(citaUpdates).toBeTruthy()
    // getUpdated() tracks ALL update payloads; with no rollback, it must be exactly 2
    // (the 2 successful ones — the failed builder doesn't reach getUpdated)
    expect(citaUpdates.length).toBe(2)
  })
})

// ─── C-2b-z: All items fail — zero-applied message (FIX 3) ──────────────────

describe('C-2b-z resolveKellyPending(reagendar_bulk) — all items fail: ⚠️ message, no ✅ 0', () => {
  it('returns ⚠️ no se pudo reagendar ninguna (not ✅ 0) when all items fail', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2)]
    const pendingRow = makePendingBulkRow({ items })

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pendingRow])
      }
      if (table === 'citas') {
        // Every cita update fails
        const b = makeBuilder(table, [])
        const failBuilder = {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
        }
        Object.defineProperty(failBuilder, 'then', {
          get() {
            return (resolve) => resolve({ data: null, error: { message: 'DB down' }, count: 0 })
          },
        })
        b.update = vi.fn(() => failBuilder)
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-zero',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text

    // Must NOT show "✅ 0" (confusing success icon with zero applied)
    expect(text).not.toMatch(/✅\s*0/)

    // Must show the clear "no se pudo reagendar ninguna" warning message
    expect(text).toMatch(/⚠️/)
    expect(text).toMatch(/ninguna/i)

    // Must still include the per-item failure list
    expect(text).toMatch(/cita-1/)
    expect(text).toMatch(/cita-2/)
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
      // citas returns a row so the work-first UPDATE appears to succeed
      return makeBuilder(table, [{ id: 'ok' }])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-006',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // NOTE (work-first fix): reagendar_bulk is an idempotent UPDATE.
    // With work-first, the cita UPDATE runs BEFORE the CAS flip. When the CAS
    // returns count:0 (another tap already won), the function returns "ya fue
    // aplicada" — the idempotent UPDATE is harmless, no damage done.
    // The critical safety guarantee is NOT "citas untouched" but "no ✅ Aplicado
    // reported twice". Verify the result is "already", not "applied".
    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text
    // Must be "already" status — NOT "✅ N reagendadas"
    expect(text).not.toMatch(/✅\s+\d+/)
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

// ─── C-2g: Work-first verify — 0 rows affected = failed (BUG-FIX) ────────────
//
// These tests cover the core fix: UPDATE returns 0 rows → status must be 'failed',
// the message must NOT claim success, and ejecutada must NOT be set to true for bulk.
//
// With the old CAS-first code, ejecutada was set BEFORE the UPDATE, so a 0-row
// UPDATE would still leave ejecutada=true and return ✅ — a FALSE SUCCESS.

describe('C-2g work-first verify — reagendar_bulk UPDATE returning 0 rows is a failure', () => {
  it('item UPDATE returning count:0 is counted as failed, not applied', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2)]
    const pendingRow = makePendingBulkRow({ items })

    // citas UPDATE returns count:0 (no rows matched — e.g. cita already moved/deleted)
    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      if (table === 'citas') {
        return makeBuilder(table, [], { updateData: { data: [], error: null, count: 0 } })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-0rows',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(toastCalls[0].opts.body).text

    // Must NOT show success icon — both items returned 0 rows
    expect(text).not.toMatch(/✅/)
    expect(text).toMatch(/⚠️/)
    expect(text).toMatch(/ninguna/i)
  })

  it('item UPDATE returning count:0 does NOT set ejecutada=true (no false-success lock)', async () => {
    const items = [makeBulkItem(1)]
    const pendingRow = makePendingBulkRow({ items })

    // Track which update payloads reached pending_kelly_actions
    const pendingUpdatePayloads = []

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        const b = makeBuilder(table, [pendingRow])
        const origUpdate = b.update.bind(b)
        b.update = vi.fn((payload) => {
          pendingUpdatePayloads.push(payload)
          return origUpdate(payload)
        })
        return b
      }
      if (table === 'citas') {
        // UPDATE returns 0 rows
        return makeBuilder(table, [], { updateData: { data: [], error: null, count: 0 } })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-nolock',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // ejecutada must NOT have been set to true — work failed, so the lock is not taken
    const executedFlip = pendingUpdatePayloads.find((p) => p.ejecutada === true)
    expect(executedFlip).toBeFalsy()
  })

  it('mix: 1 item UPDATE returns count:1 (applied), 1 returns count:0 (failed) → partial report', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2)]
    const pendingRow = makePendingBulkRow({ items })

    let citaCallCount = 0
    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      if (table === 'citas') {
        citaCallCount++
        const n = citaCallCount
        if (n === 1) {
          // First item: 1 row affected → success
          return makeBuilder(table, [{ id: 'ok' }])
        }
        // Second item: 0 rows affected → failure
        return makeBuilder(table, [], { updateData: { data: [], error: null, count: 0 } })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-mix',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    const toastCalls = getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))
    const text = JSON.parse(toastCalls[0].opts.body).text

    // 1 applied, 1 failed → partial message with both ✅ and ⚠️
    expect(text).toMatch(/✅/)
    expect(text).toMatch(/⚠️/)
    expect(text).toMatch(/1/)
  })
})

// ─── C-2h: Ordering — ejecutada set AFTER successful work (work-first) ────────
//
// Verifies the fix ordering: citas UPDATE happens first, ejecutada flip happens
// only if (and after) the work succeeded. This prevents the false-success
// scenario where the lock is taken but the side-effect is never completed.

describe('C-2h work-first ordering — ejecutada is set only after UPDATE succeeds', () => {
  it('citas UPDATE is called before the pending_kelly_actions ejecutada flip', async () => {
    const items = [makeBulkItem(1)]
    const pendingRow = makePendingBulkRow({ items })

    const callOrder = []

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        const b = makeBuilder(table, [pendingRow])
        const origUpdate = b.update.bind(b)
        b.update = vi.fn((payload) => {
          if (payload.ejecutada === true) callOrder.push('lock_ejecutada')
          return origUpdate(payload)
        })
        return b
      }
      if (table === 'citas') {
        const b = makeBuilder(table, [{ id: 'ok' }])
        const origUpdate = b.update.bind(b)
        b.update = vi.fn((payload) => {
          callOrder.push('cita_update')
          return origUpdate(payload)
        })
        return b
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-order',
        data: 'kelly_confirm_pending-bulk-001',
        message: { chat: { id: 999 }, message_id: 42 },
      },
    }))

    // cita_update must appear before lock_ejecutada in the call sequence
    const citaIdx = callOrder.indexOf('cita_update')
    const lockIdx = callOrder.indexOf('lock_ejecutada')
    expect(citaIdx).toBeGreaterThanOrEqual(0)
    expect(lockIdx).toBeGreaterThanOrEqual(0)
    expect(citaIdx).toBeLessThan(lockIdx)
  })
})

// ─── C-2i: INSERT dedup — bloqueo/evento_personal CAS-first preserved ─────────
//
// INSERTs are NOT idempotent (running twice creates duplicate rows).
// For these action types the CAS lock must still be taken BEFORE the INSERT.
// A duplicate Telegram delivery (second tap) must be rejected by the CAS
// without a second INSERT.

describe('C-2i INSERT dedup — bloqueo and evento_personal: duplicate delivery does NOT insert twice', () => {
  it('bloqueo: second tap (CAS count:0) does NOT produce a second citas insert', async () => {
    const pending = {
      id: 'pending-bloqueo-dedup',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-10', hora: '08:00', duracion_min: 60, motivo: 'Reunión' },
    }

    // CAS UPDATE returns count:0 → second tap lost the lock
    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pending], { updateData: { data: null, error: null, count: 0 } })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-dedup',
        data: 'kelly_confirm_pending-bloqueo-dedup',
        message: { chat: { id: 999 }, message_id: 1 },
      },
    }))

    // No citas insert should have happened — CAS rejected before any side-effect
    expect(getInserted()['citas']).toBeUndefined()
  })

  it('evento_personal: second tap (CAS count:0) does NOT insert a duplicate citas or tareas row', async () => {
    const pending = {
      id: 'pending-evento-dedup',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-10', hora: '09:00', duracion_min: 45, motivo: 'Control médico', recordar_min_antes: 30 },
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') {
        return makeBuilder(table, [pending], { updateData: { data: null, error: null, count: 0 } })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-evento-dedup',
        data: 'kelly_confirm_pending-evento-dedup',
        message: { chat: { id: 999 }, message_id: 1 },
      },
    }))

    // Neither citas nor tareas should have been inserted — CAS blocked the side-effect
    expect(getInserted()['citas']).toBeUndefined()
    expect(getInserted()['tareas']).toBeUndefined()
  })

  it('bloqueo: first tap (CAS count:1) still runs the citas insert', async () => {
    const pending = {
      id: 'pending-bloqueo-first',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-10', hora: '08:00', duracion_min: 60, motivo: 'Reunión' },
    }

    // CAS UPDATE returns count:1 → first tap wins the lock
    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-first',
        data: 'kelly_confirm_pending-bloqueo-first',
        message: { chat: { id: 999 }, message_id: 1 },
      },
    }))

    const citasInserts = getInserted()['citas'] ?? []
    expect(citasInserts.length).toBeGreaterThan(0)
  })
})

// ─── C-2j: cancelar — already-cancelled cita reports "ya estaba", not false ✅ ──

describe('C-2j resolveKellyPending(cancelar) — honest status on already-cancelled', () => {
  it('reports "ya estaba cancelada" (not ✅ Aplicado) when the cita is already cancelled', async () => {
    const pending = {
      id: 'pending-cancel-1',
      action_type: 'cancelar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-already-cancelled' },
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      if (table === 'citas') {
        // The .neq('estado','cancelada') UPDATE affects 0 rows (already cancelled);
        // the follow-up SELECT (maybeSingle) returns the cita with estado cancelada.
        return makeBuilder(table, [{ id: 'cita-already-cancelled', estado: 'cancelada' }], {
          updateData: { data: [], error: null, count: 0 },
        })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-cancel-1',
        data: 'kelly_confirm_pending-cancel-1',
        message: { chat: { id: 999 }, message_id: 7 },
      },
    }))

    const toast = JSON.parse(getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))[0].opts.body).text
    expect(toast).toMatch(/ya estaba cancelada/i)
    expect(toast).not.toMatch(/✅ Aplicado/i)

    // ejecutada must NOT be flipped: nothing real happened.
    const pendingUpdates = getUpdated()['pending_kelly_actions'] ?? []
    const casFlip = pendingUpdates.find((u) => u.payload?.ejecutada === true)
    expect(casFlip).toBeFalsy()
  })

  it('reports ✅ when the cita was active and gets cancelled (rows affected)', async () => {
    const pending = {
      id: 'pending-cancel-2',
      action_type: 'cancelar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-active' },
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      if (table === 'citas') {
        // UPDATE affects 1 row (was active, now cancelled).
        return makeBuilder(table, [{ id: 'cita-active' }], {
          updateData: { data: [{ id: 'cita-active' }], error: null, count: 1 },
        })
      }
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-cancel-2',
        data: 'kelly_confirm_pending-cancel-2',
        message: { chat: { id: 999 }, message_id: 8 },
      },
    }))

    const toast = JSON.parse(getCapturedFetches().filter((f) => f.url.includes('answerCallbackQuery'))[0].opts.body).text
    expect(toast).toMatch(/✅/)
  })
})
