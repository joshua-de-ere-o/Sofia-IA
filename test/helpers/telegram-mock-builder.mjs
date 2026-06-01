/**
 * test/helpers/telegram-mock-builder.mjs
 *
 * Shared Vitest test harness for app/api/telegram/route.js tests.
 * Extracted from telegram-contrato.test.mjs and telegram-evento-personal.test.mjs
 * to eliminate ~120 lines of duplication.
 *
 * Usage:
 *   import {
 *     mockFrom, setupTelegramMocks, teardownTelegramMocks,
 *     makeBuilder, makeRequest, loadRoute,
 *     getInserted, getUpdated, getCapturedFetches,
 *   } from '../helpers/telegram-mock-builder.mjs'
 *
 *   // In your test file — call once at module level:
 *   setupTelegramMocks()
 *
 *   // In beforeEach:
 *   beforeEach(() => { resetTelegramState() })
 *   afterEach(() => { teardownTelegramMocks() })
 */

import { vi } from 'vitest'

// ─── Module-level shared state ────────────────────────────────────────────────

export const mockFrom = vi.fn()
export const mockSupabase = { from: mockFrom }

// Per-test mutable state (reset in resetTelegramState)
let _inserted = {}
let _updated = {}
let _capturedFetches = []
let _originalFetch = null

export function getInserted() { return _inserted }
export function getUpdated()  { return _updated }
export function getCapturedFetches() { return _capturedFetches }

// ─── Adapter response (controllable per-test) ─────────────────────────────────

export let mockAdapterResponse = '{"tool":"responder_texto","args":{"texto":"ok"}}'

// Multi-response queue. null = use static mockAdapterResponse (backward-compat).
let _responseQueue = null

/**
 * Override the LLM adapter response for the current test.
 * The same value is returned on every chat() call (static mode).
 */
export function setAdapterResponse(json) {
  mockAdapterResponse = typeof json === 'string' ? json : JSON.stringify(json)
  _responseQueue = null // clear any queue so static mode takes over
}

/**
 * Queue multiple sequential LLM responses.
 * Each adapter.chat() call dequeues the next item.
 * Throws if the queue is empty (underflow) — fails loudly rather than silently.
 * setAdapterResponse (single) remains backward-compatible.
 *
 * @param {Array<string|object>} responses - Responses in dequeue order.
 */
export function setAdapterResponses(responses) {
  _responseQueue = responses.map((r) =>
    typeof r === 'string' ? r : JSON.stringify(r)
  )
}

// ─── Module-level vi.mock declarations ───────────────────────────────────────
// These MUST be at module level so Vitest's hoisting picks them up correctly.
// Importing this helper is sufficient — no need to call setupTelegramMocks().

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/model-adapter', () => ({
  getModelAdapter: vi.fn(() =>
    Promise.resolve({
      chat: vi.fn(async () => {
        if (_responseQueue !== null) {
          if (_responseQueue.length === 0) {
            throw new Error(
              'setAdapterResponses queue is empty (underflow) — ' +
              'test issued more chat() calls than queued responses'
            )
          }
          return _responseQueue.shift()
        }
        return mockAdapterResponse
      }),
    })
  ),
}))

vi.mock('../lib/ycloud.js', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}))

// ─── setupTelegramMocks (kept for backward-compat, now a no-op) ───────────────
/** @deprecated No-op — mocks are declared at module level above. */
export function setupTelegramMocks() {
  // intentionally empty — vi.mock calls above are hoisted automatically
}

// ─── resetTelegramState ───────────────────────────────────────────────────────
// Call in beforeEach.

export function resetTelegramState() {
  _inserted = {}
  _updated = {}
  _capturedFetches = []
  _responseQueue = null
  _originalFetch = globalThis.fetch
  globalThis.fetch = _mockFetch
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_CHAT_ID = '999'
  vi.clearAllMocks()
  // Re-apply fetch after clearAllMocks (clearAllMocks resets vi.fn state but not globalThis)
  globalThis.fetch = _mockFetch
}

// ─── teardownTelegramMocks ────────────────────────────────────────────────────
// Call in afterEach.

export function teardownTelegramMocks() {
  if (_originalFetch !== null) {
    globalThis.fetch = _originalFetch
    _originalFetch = null
  }
}

// ─── Internal fetch mock ──────────────────────────────────────────────────────

function _mockFetch(url, opts) {
  _capturedFetches.push({ url, opts })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
}

// ─── makeRequest ──────────────────────────────────────────────────────────────

export function makeRequest(body) {
  return { json: () => Promise.resolve(body) }
}

// ─── loadRoute ────────────────────────────────────────────────────────────────
// Each test file keeps its own module reference to avoid cross-file caching.

let _routeModule
export async function loadRoute() {
  if (!_routeModule) _routeModule = await import('../../app/api/telegram/route.js?' + Date.now())
  return _routeModule
}

// ─── Column allow-list (per-table) ───────────────────────────────────────────
// Opt-in: only tables listed here are validated. Other tables are unrestricted.
// Catches wrong column names (e.g. phantom `paciente_nombre`) early in tests
// before they silently no-op against the real DB.

const ALLOWED_COLUMNS = {
  citas: new Set([
    'id', 'zona', 'fecha', 'hora', 'estado', 'duracion_min',
    'patient_name_normalized', 'pacientes', 'paciente_id',
  ]),
  telegram_kelly_context: new Set([
    'chat_id', 'last_search', 'updated_at',
  ]),
}

/**
 * Assert that `col` is in the allow-list for `table`.
 * Only enforced for tables in ALLOWED_COLUMNS; all others pass through.
 */
function assertColumn(table, col) {
  const allowed = ALLOWED_COLUMNS[table]
  if (!allowed) return // table not under validation
  if (!allowed.has(col)) {
    throw new Error(
      `[mock] unknown column "${col}" queried on table "${table}". ` +
      `Allowed: ${[...allowed].join(', ')}`
    )
  }
}

// ─── makeBuilder ─────────────────────────────────────────────────────────────
/**
 * Build a chainable Supabase mock for `table`.
 *
 * @param {string} table          - Table name (used as key in inserted/updated maps).
 * @param {Array}  rows           - Rows returned by .single() and the thenable.
 * @param {object} [opts]
 * @param {object} [opts.updateData] - Override what the UPDATE chain resolves with.
 *   Default count is 1 (lock won). Pass `{ data: null, error: null, count: 0 }` to
 *   simulate a lost CAS lock (TOCTOU second-tap scenario).
 */
export function makeBuilder(table, rows, { updateData } = {}) {
  const eqFilters = {}

  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((col, val) => {
      assertColumn(table, col)
      eqFilters[col] = val
      return builder
    }),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn((col, val) => {
      assertColumn(table, col)
      return builder
    }),
    lte: vi.fn((col, val) => {
      assertColumn(table, col)
      return builder
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows?.[0] ?? null, error: null }),
    insert: vi.fn((payload) => {
      ;(_inserted[table] ||= []).push(payload)
      return builder
    }),
    update: vi.fn((payload) => {
      const updateFilters = {}
      const entry = { payload, filters: updateFilters }
      ;(_updated[table] ||= []).push(entry)

      const resolvedUpdateData = updateData ?? { data: rows ?? [], error: null, count: 1 }

      const updateBuilder = {
        eq: vi.fn((col, val) => {
          updateFilters[col] = val
          return updateBuilder
        }),
        select: vi.fn(() => updateBuilder),
        single: vi.fn().mockResolvedValue(
          updateData ?? { data: rows?.[0] ?? null, error: null }
        ),
      }
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
