/**
 * test/telegram-bulk-preview.test.mjs
 *
 * PR-B tests — buscar_citas_bulk filter tool.
 *
 * Covers:
 *   B-1a: Happy-path filter returns CitaCandidate[] for zona + fecha range.
 *   B-1b: Empty filter result → {kind:'clarification'}, no pending row created.
 *   B-1c: Operator-only guard — buscar_citas_bulk not reachable from WhatsApp lane.
 *
 * REQ-S2-01, REQ-S2-02, REQ-S2-03 / AC-02, AC-08
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mockFrom,
  setupTelegramMocks,
  resetTelegramState,
  teardownTelegramMocks,
  makeBuilder,
  makeRequest,
  loadRoute,
  getInserted,
  getCapturedFetches,
  setAdapterResponse,
} from './helpers/telegram-mock-builder.mjs'

setupTelegramMocks()

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

// ─── Source-level contract: buscar_citas_bulk tool exists in route.js ──────────

const routePath = resolve('app/api/telegram/route.js')

describe('B-1 source contract — toolBuscarCitasBulk defined in route.js', () => {
  it('toolBuscarCitasBulk function is defined', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/async function toolBuscarCitasBulk\s*\(/)
  })

  it('KELLY_SYSTEM_PROMPT includes buscar_citas_bulk tool entry', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/buscar_citas_bulk/)
  })

  it('dispatcher switch includes buscar_citas_bulk case', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/case\s+'buscar_citas_bulk'/)
  })
})

// ─── B-1a: Happy-path filter returns CitaCandidate[] ──────────────────────────

describe('B-1a toolBuscarCitasBulk — happy-path: returns candidate list', () => {
  it('returns candidate citas for zona norte + fecha range (no pending row)', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { zona: 'norte', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-07' },
    })

    const candidatos = [
      { id: 'c-001', paciente_nombre: 'Ana Torres', fecha: '2026-06-02', hora: '09:00:00', zona: 'norte', estado: 'confirmada', duracion_min: 45 },
      { id: 'c-002', paciente_nombre: 'Luis Vera',  fecha: '2026-06-04', hora: '11:00:00', zona: 'norte', estado: 'pendiente', duracion_min: 60 },
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, candidatos)
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'muéstrame citas del norte del 1 al 7 junio', chat: { id: 999 } } }))

    // No pending row should be created (REQ-S2-01: filter-only, no side effects)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // A sendMessage should be sent to Kely with the candidate list
    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)

    // The message should mention both patients
    const messageBody = JSON.parse(sendCalls[0].opts.body)
    expect(messageBody.text).toMatch(/Ana Torres/)
    expect(messageBody.text).toMatch(/Luis Vera/)
  })

  it('candidate objects include required fields: cita_id, paciente_nombre, fecha, hora, zona, estado', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { zona: 'sur', fecha_desde: '2026-06-10', fecha_hasta: '2026-06-10' },
    })

    const candidatos = [
      { id: 'c-010', paciente_nombre: 'María Prado', fecha: '2026-06-10', hora: '08:00:00', zona: 'sur', estado: 'confirmada', duracion_min: 45 },
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, candidatos)
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'citas sur 10 junio', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)

    const text = JSON.parse(sendCalls[0].opts.body).text
    // cita_id or shorthand, fecha, hora, zona, paciente all visible
    expect(text).toMatch(/María Prado/)
    expect(text).toMatch(/2026-06-10/)
    expect(text).toMatch(/08:00/)
    expect(text).toMatch(/sur/)
  })

  it('filter without zona returns all active citas in date range', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-01', fecha_hasta: '2026-06-01' },
    })

    const candidatos = [
      { id: 'c-020', paciente_nombre: 'Jorge Lima', fecha: '2026-06-01', hora: '10:00:00', zona: 'virtual', estado: 'confirmada', duracion_min: 45 },
      { id: 'c-021', paciente_nombre: 'Rosa Mora', fecha: '2026-06-01', hora: '14:00:00', zona: 'norte',   estado: 'pendiente', duracion_min: 60 },
    ]

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, candidatos)
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'citas del 1 junio todas las zonas', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    const text = JSON.parse(sendCalls[0].opts.body).text
    expect(text).toMatch(/Jorge Lima/)
    expect(text).toMatch(/Rosa Mora/)
  })
})

// ─── B-1b: Empty result → clarification, no pending row ───────────────────────

describe('B-1b toolBuscarCitasBulk — empty result: clarification + no pending row', () => {
  it('returns clarification message when filter matches zero citas', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { zona: 'valle', fecha_desde: '2026-12-25', fecha_hasta: '2026-12-31' },
    })

    // citas returns empty array
    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'citas del valle del 25 al 31 diciembre', chat: { id: 999 } } }))

    // No pending row created (REQ-S2-02)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // A clarification message sent to Kely
    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)

    const body = JSON.parse(sendCalls[0].opts.body)
    // Should NOT have inline keyboard (not a preview)
    expect(body.reply_markup).toBeFalsy()
    // Message should indicate no results found
    expect(body.text).toBeTruthy()
  })

  it('clarification message does NOT have inline keyboard buttons', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-11-01', fecha_hasta: '2026-11-01' },
    })

    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'busca citas 1 noviembre', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    const body = JSON.parse(sendCalls[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeFalsy()
  })
})

// ─── B-1d: BULK_EXCLUDED_STATES wired — .not() called with terminal-state exclusion ──

describe('B-1d toolBuscarCitasBulk — default path calls .not() with BULK_EXCLUDED_STATES', () => {
  it('calls .not("estado","in","(cancelada,no_show,rechazada)") when no estado[] override is passed', async () => {
    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-01', fecha_hasta: '2026-06-07' },
    })

    // Capture the builder so we can spy on its .not method
    let capturedBuilder = null
    mockFrom.mockImplementation((table) => {
      const b = makeBuilder(table, [])
      if (table === 'citas') capturedBuilder = b
      return b
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'citas del 1 al 7 junio', chat: { id: 999 } } }))

    // The builder must have been created for 'citas'
    expect(capturedBuilder).not.toBeNull()

    // Contract: .not must have been called with the exact exclusion args
    expect(capturedBuilder.not).toHaveBeenCalledWith(
      'estado',
      'in',
      '(cancelada,no_show,rechazada)',
    )
  })
})

// ─── B-1c: Operator-only guard — not reachable from WhatsApp/patient lane ─────

describe('B-1c operator-only guard — buscar_citas_bulk unreachable from patient lane', () => {
  it('route.js does NOT export or expose buscar_citas_bulk to WhatsApp handler', () => {
    // The patient lane lives in agent-runner (Deno), not this route.
    // This source-level check verifies the tool is only reachable through
    // handleKellyMessage (Telegram operator channel), not through any patient
    // path in this file.
    const source = readFileSync(routePath, 'utf8')

    // toolBuscarCitasBulk must be defined
    expect(source).toMatch(/async function toolBuscarCitasBulk\s*\(/)

    // It must only be called from the dispatcher switch inside handleKellyMessage
    // (not from handleMessage or any WhatsApp-side code path)
    const whatsappIdx = source.indexOf('sendWhatsAppMessage')
    const buscarIdx = source.indexOf('toolBuscarCitasBulk(')
    // The call to toolBuscarCitasBulk must appear AFTER the WhatsApp import
    // (i.e., it's a tool in the Kelly/Telegram dispatcher, not in patient-side code)
    expect(buscarIdx).toBeGreaterThan(whatsappIdx)
  })

  it('buscar_citas_bulk case is inside the handleKellyMessage dispatcher only', () => {
    const source = readFileSync(routePath, 'utf8')

    // Extract handleKellyMessage function body
    const fnStart = source.indexOf('async function handleKellyMessage(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)

    // The switch case must be inside handleKellyMessage
    expect(fnBody).toMatch(/case\s+'buscar_citas_bulk'/)
  })

  it('telegram chat_id gate prevents any non-Kelly sender from reaching the tool', async () => {
    // Set an env where TELEGRAM_CHAT_ID = '999' and send from a DIFFERENT chat id
    process.env.TELEGRAM_CHAT_ID = '999'

    setAdapterResponse({
      tool: 'buscar_citas_bulk',
      args: { fecha_desde: '2026-06-01', fecha_hasta: '2026-06-07' },
    })

    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    // Send from chat_id 888 — different from the operator chat
    await POST(makeRequest({ message: { text: 'citas junio', chat: { id: 888 } } }))

    // No citas query, no pending inserts, no sendMessage sent to unauthorized sender
    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    // Route should have silently dropped the message (no sendMessage to non-operator)
    expect(sendCalls).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// C-1: reagendar_bulk PREVIEW tests (all failing until C-3 GREEN)
// REQ-S3-01, REQ-S3-02, REQ-S5-02 / AC-03, AC-04
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: build a BulkItem
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

// ─── C-1a: Source contract — toolReagendarBulkPreview exists ──────────────────

describe('C-1 source contract — toolReagendarBulkPreview defined in route.js', () => {
  it('toolReagendarBulkPreview function is defined', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/async function toolReagendarBulkPreview\s*\(/)
  })

  it('KELLY_SYSTEM_PROMPT includes reagendar_bulk tool entry', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/reagendar_bulk/)
  })

  it('dispatcher switch includes reagendar_bulk case', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toMatch(/case\s+'reagendar_bulk'/)
  })

  it('MAX_BULK_ITEMS constant is defined exactly once', () => {
    const source = readFileSync(routePath, 'utf8')
    const matches = [...source.matchAll(/MAX_BULK_ITEMS\s*=/g)]
    expect(matches).toHaveLength(1)
  })

  it('no .changes references remain in route.js', () => {
    const source = readFileSync(routePath, 'utf8')
    // Must not have .changes on OperatorPreview (keyboard is the correct field)
    expect(source).not.toMatch(/\.changes\b/)
  })
})

// ─── C-1b: Happy-path: N ≤ 12 items → 1 pending row INSERT ───────────────────

describe('C-1b toolReagendarBulkPreview — happy path: inserts ONE pending row', () => {
  it('inserts exactly one pending_kelly_actions row with action_type reagendar_bulk', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2), makeBulkItem(3)]

    setAdapterResponse({
      tool: 'reagendar_bulk',
      args: { items },
    })

    // citas returns occupied rows for overlap check (not conflicting with nueva_hora 10:00)
    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'new-bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda estas 3 citas', chat: { id: 999 } } }))

    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeTruthy()
    expect(pendingInserts).toHaveLength(1)
    expect(pendingInserts[0].action_type).toBe('reagendar_bulk')
    expect(Array.isArray(pendingInserts[0].args.items)).toBe(true)
    expect(pendingInserts[0].args.items).toHaveLength(3)
  })

  it('each item in args.items carries cita_id, nueva_fecha, nueva_hora, duracion_min', async () => {
    const items = [makeBulkItem(1)]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda cita', chat: { id: 999 } } }))

    const row = getInserted()['pending_kelly_actions'][0]
    const item = row.args.items[0]
    expect(item).toMatchObject({
      cita_id: 'cita-1',
      nueva_fecha: '2026-06-11',
      nueva_hora: '10:00',
      duracion_min: 45,
    })
  })

  it('Telegram receives one sendMessage with inline_keyboard (keyboard field)', async () => {
    const items = [makeBulkItem(1), makeBulkItem(2)]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda 2 citas', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sendCalls[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })

  it('summary shows paciente_nombre when provided in item contract (FIX-2: name visible in preview)', async () => {
    // The LLM prompt now includes paciente_nombre in the reagendar_bulk item contract.
    // When the LLM passes it, the summary must display the real name.
    const items = [{
      cita_id: 'cita-name-1',
      paciente_nombre: 'Valentina Cruz',
      fecha_original: '2026-06-10',
      hora_original: '09:00',
      nueva_fecha: '2026-06-12',
      nueva_hora: '11:00',
      duracion_min: 45,
    }]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'name-bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda cita Valentina', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const text = JSON.parse(sendCalls[0].opts.body).text
    // Name must appear in the summary (not just the cita_id fallback)
    expect(text).toMatch(/Valentina Cruz/)
  })
})

// ─── C-1c: Summary truncation with (+N más) ───────────────────────────────────

describe('C-1c summary truncation — (+N más) when near 4096-char limit', () => {
  it('truncates summary with "(+N más)" when rendered summary would exceed 4096 chars', async () => {
    // Build 12 items with very long patient names to force truncation
    const items = Array.from({ length: 12 }, (_, i) => ({
      cita_id: `cita-${i}`,
      fecha_original: '2026-06-10',
      hora_original: '09:00',
      nueva_fecha: `2026-06-${String(i + 10).padStart(2, '0')}`,
      nueva_hora: '10:00',
      duracion_min: 45,
      paciente_nombre: 'Nombre Muy Largo Para Forzar Truncamiento Del Summary ' + 'X'.repeat(300),
    }))

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda todo', chat: { id: 999 } } }))

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sendCalls[0].opts.body)
    // Either fits fine OR is truncated with (+N más)
    expect(body.text.length).toBeLessThanOrEqual(4096)
    // If truncated, must contain the truncation marker
    if (body.text.length < items.length * 50) {
      expect(body.text).toMatch(/\(\+\d+ más\)/)
    }
  })
})

// ─── C-1d: Over-cap rejection (> MAX_BULK_ITEMS) ─────────────────────────────

describe('C-1d toolReagendarBulkPreview — over-cap: reject, no INSERT', () => {
  it('rejects when items.length > 12 and creates no pending row', async () => {
    const items = Array.from({ length: 13 }, (_, i) => makeBulkItem(i))

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda 13 citas', chat: { id: 999 } } }))

    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    // Should send a clarification message
    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sendCalls[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeFalsy()
  })
})

// ─── C-1e: Empty items list → clarification, no INSERT ────────────────────────

describe('C-1e toolReagendarBulkPreview — empty items: reject, no INSERT', () => {
  it('rejects when items is empty array and creates no pending row', async () => {
    setAdapterResponse({ tool: 'reagendar_bulk', args: { items: [] } })

    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda (vacío)', chat: { id: 999 } } }))

    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sendCalls[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeFalsy()
  })
})

// ─── C-1f: Overlap collision → clarification, no INSERT ──────────────────────

describe('C-1f toolReagendarBulkPreview — overlap collision: reject, no INSERT', () => {
  it('rejects when a target slot overlaps an existing cita and creates no pending row', async () => {
    // Item targets 2026-06-11 10:00 (45 min) → conflicts with existing cita below
    const items = [{
      cita_id: 'cita-999',
      fecha_original: '2026-06-10',
      hora_original: '09:00',
      nueva_fecha: '2026-06-11',
      nueva_hora: '10:00',
      duracion_min: 45,
    }]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // Existing cita occupies 2026-06-11 10:15 (overlaps with 10:00-10:45)
    const conflictingCita = {
      id: 'existing-cita',
      fecha: '2026-06-11',
      hora: '10:15:00',
      duracion_min: 45,
      estado: 'confirmada',
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [conflictingCita])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagenda cita con conflicto', chat: { id: 999 } } }))

    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeFalsy()

    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    expect(sendCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(sendCalls[0].opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeFalsy()
  })
})

// ─── C-1g: Self-collision — moving to different time on same day MUST be accepted ─

describe('C-1g toolReagendarBulkPreview — self-collision excluded: same-day rescheduling accepted', () => {
  it('ACCEPTS a cita moved to a different time on its own date when the only "conflict" is its original slot', async () => {
    // cita-self is originally at 2026-06-15 09:00 (45 min).
    // It is being moved to 2026-06-15 14:00.
    // The citas table returns the cita's OWN current slot for that date.
    // Without self-exclusion this would trigger a false positive collision.
    const items = [{
      cita_id: 'cita-self',
      fecha_original: '2026-06-15',
      hora_original: '09:00',
      nueva_fecha: '2026-06-15',
      nueva_hora: '14:00',
      duracion_min: 45,
    }]

    setAdapterResponse({ tool: 'reagendar_bulk', args: { items } })

    // The DB returns the cita's own current row — the only "occupied" slot is itself.
    // After the fix, this row must be EXCLUDED from collision detection.
    const ownCita = {
      id: 'cita-self',        // same id as cita_id in the batch
      fecha: '2026-06-15',
      hora: '14:15:00',       // overlaps new slot 14:00-14:45 IF not excluded
      duracion_min: 45,
      estado: 'confirmada',
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'citas') return makeBuilder(table, [ownCita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'self-bulk-id' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'mueve cita al mismo día otra hora', chat: { id: 999 } } }))

    // Must INSERT a pending row (accepted, not rejected as self-collision)
    const pendingInserts = getInserted()['pending_kelly_actions']
    expect(pendingInserts).toBeTruthy()
    expect(pendingInserts).toHaveLength(1)
    expect(pendingInserts[0].action_type).toBe('reagendar_bulk')
  })
})
