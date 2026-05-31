/**
 * test/telegram-s1-rename.test.mjs
 *
 * S1 rename contract — OperatorPreview shape uses `keyboard` (not `changes`).
 *
 * These tests enforce that:
 *   1. The OperatorPreview object returned by every destructive tool carries
 *      a `keyboard` field (inline_keyboard matrix) — REQ-S1-01 / AC-01.
 *   2. No tool returns an object with a `changes` field (the old name).
 *
 * Strategy: we inspect the source text of route.js directly to assert the
 * rename contract. This is the only reliable approach for a pure rename in a
 * module where tool functions are not exported, and it gives an unambiguous
 * RED bar before the rename and GREEN after.
 *
 * Additionally, behavioural integration tests confirm that the dispatcher
 * correctly passes the keyboard matrix to Telegram's sendMessage API for
 * each of the 4 destructive tools.
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

// ═══════════════════════════════════════════════════════════════════════════════
// A-1 (RED→GREEN) — OperatorPreview source-contract assertions
//
// These read the LIVE source text of route.js to enforce the rename contract.
// They FAIL with the old `changes` field and PASS only after the rename.
// ═══════════════════════════════════════════════════════════════════════════════

const routePath = resolve('app/api/telegram/route.js')

describe('S1 rename — OperatorPreview shape contract (source-level)', () => {
  it('OperatorPreview @typedef uses `keyboard` field (not `changes`)', () => {
    const source = readFileSync(routePath, 'utf8')
    // The typedef must declare `keyboard` as a field
    expect(source).toMatch(/\btypedef\b.*OperatorPreview[\s\S]*?\bkeyboard\b/)
  })

  it('OperatorPreview @typedef does NOT contain a `changes` field', () => {
    const source = readFileSync(routePath, 'utf8')
    // Extract the OperatorPreview typedef line and confirm no `changes` token
    const typedefLine = source
      .split('\n')
      .find((l) => l.includes('@typedef') && l.includes('OperatorPreview'))
    expect(typedefLine).toBeTruthy()
    expect(typedefLine).not.toMatch(/\bchanges\b/)
  })

  it('toolReagendarCita returns object with `keyboard` key (not `changes`)', () => {
    const source = readFileSync(routePath, 'utf8')
    // Locate the toolReagendarCita function block and check it uses `keyboard:`
    const fnStart = source.indexOf('async function toolReagendarCita(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)
    expect(fnBody).toMatch(/\bkeyboard\s*:/)
    expect(fnBody).not.toMatch(/\bchanges\s*:/)
  })

  it('toolCancelarCita returns object with `keyboard` key (not `changes`)', () => {
    const source = readFileSync(routePath, 'utf8')
    const fnStart = source.indexOf('async function toolCancelarCita(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)
    expect(fnBody).toMatch(/\bkeyboard\s*:/)
    expect(fnBody).not.toMatch(/\bchanges\s*:/)
  })

  it('toolCrearBloqueo returns object with `keyboard` key (not `changes`)', () => {
    const source = readFileSync(routePath, 'utf8')
    const fnStart = source.indexOf('async function toolCrearBloqueo(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)
    expect(fnBody).toMatch(/\bkeyboard\s*:/)
    expect(fnBody).not.toMatch(/\bchanges\s*:/)
  })

  it('toolAgendarEventoPersonal returns object with `keyboard` key (not `changes`)', () => {
    const source = readFileSync(routePath, 'utf8')
    const fnStart = source.indexOf('async function toolAgendarEventoPersonal(')
    const fnEnd = source.indexOf('\nasync function ', fnStart + 1)
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined)
    expect(fnBody).toMatch(/\bkeyboard\s*:/)
    expect(fnBody).not.toMatch(/\bchanges\s*:/)
  })

  it('dispatcher uses toolResult.keyboard (not toolResult.changes)', () => {
    const source = readFileSync(routePath, 'utf8')
    // The dispatcher block (around sendToKelyWithButtons call) must reference .keyboard
    expect(source).toMatch(/toolResult\.keyboard/)
    expect(source).not.toMatch(/toolResult\.changes/)
  })

  it('zero remaining .changes references in the OperatorPreview context', () => {
    const source = readFileSync(routePath, 'utf8')
    // Count occurrences of `changes:` in return objects (object key pattern)
    const changesKeys = [...source.matchAll(/\bchanges\s*:/g)]
    expect(changesKeys).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Behavioural integration — dispatcher passes keyboard matrix to Telegram API
// These are GREEN before and after the rename (they test final Telegram output).
// ═══════════════════════════════════════════════════════════════════════════════

describe('S1 rename — behavioural: dispatcher sends inline_keyboard for all 4 tools', () => {
  it('toolReagendarCita — Telegram API receives inline_keyboard', async () => {
    setAdapterResponse({
      tool: 'reagendar_cita_kelly',
      args: { nombre_paciente: 'Marta', nueva_fecha: '2026-07-01', nueva_hora: '09:00' },
    })
    const paciente = { id: 'p-marta', nombre: 'Marta Salazar' }
    const cita = { id: 'cita-marta-1', fecha: '2026-06-20', hora: '08:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pending = { id: 'pend-s1-r' }
    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      return makeBuilder(table, [])
    })
    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagendá', chat: { id: 999 } } }))
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
    expect(Array.isArray(body.reply_markup.inline_keyboard)).toBe(true)
  })

  it('toolCancelarCita — Telegram API receives inline_keyboard', async () => {
    setAdapterResponse({
      tool: 'cancelar_cita_kelly',
      args: { nombre_paciente: 'Carlos' },
    })
    const paciente = { id: 'p-carlos', nombre: 'Carlos Vera' }
    const cita = { id: 'cita-carlos-1', fecha: '2026-06-25', hora: '10:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pending = { id: 'pend-s1-c' }
    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      return makeBuilder(table, [])
    })
    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'cancelá a Carlos', chat: { id: 999 } } }))
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })

  it('toolCrearBloqueo — Telegram API receives inline_keyboard', async () => {
    setAdapterResponse({
      tool: 'crear_bloqueo_agenda',
      args: { fecha: '2026-07-05', hora: '07:00', duracion_min: 60, motivo: 'Pausa' },
    })
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pend-s1-b' }])
        : makeBuilder(table, []),
    )
    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'bloqueo', chat: { id: 999 } } }))
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })

  it('toolAgendarEventoPersonal — Telegram API receives inline_keyboard', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Reunión', fecha: '2026-07-10', hora: '15:00' },
    })
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pend-s1-e' }])
        : makeBuilder(table, []),
    )
    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reunión', chat: { id: 999 } } }))
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })
})
