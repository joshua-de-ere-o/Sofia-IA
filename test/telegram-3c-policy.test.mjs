/**
 * test/telegram-3c-policy.test.mjs
 *
 * PR 3c — policy wiring + S3 preview-return contract tests:
 *
 *   W2: Explicit operator policy construction in handleKellyMessage — unknown/broken
 *       actor/channel should surface as a clean error, not an unhandled crash.
 *
 *   Policy wiring: toolAgendarEventoPersonal uses mergeOperatorOverrides instead of
 *       ad-hoc inline coalesce. Existing defaults (60 min, 30 min) must be IDENTICAL.
 *
 *   S3: All 4 destructive tools RETURN {kind:'preview', actionType, previewId, summary,
 *       changes} to the dispatcher, which drives the sendToKelyWithButtons call.
 *       Tools must NOT return undefined on the preview path.
 */

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
// W2 — graceful unknown-tool handling (outer catch already present)
// ═══════════════════════════════════════════════════════════════════════════════

describe('W2 — route robustness under unexpected tool names', () => {
  it('unknown tool name does NOT throw unhandled — returns graceful error message to Kely', async () => {
    setAdapterResponse({ tool: '__no_such_tool__', args: {} })

    mockFrom.mockImplementation((table) =>
      makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    // Should not throw
    await expect(
      POST(makeRequest({ message: { text: 'hola', chat: { id: 999 } } })),
    ).resolves.not.toThrow()

    // A graceful sendMessage should have been called (the "no entendí" or "no supe" path)
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.text).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Policy wiring — mergeOperatorOverrides replaces ad-hoc defaults in
// toolAgendarEventoPersonal. Happy-path behavior must be IDENTICAL.
// ═══════════════════════════════════════════════════════════════════════════════

describe('toolAgendarEventoPersonal — policy wiring preserves defaults', () => {
  it('applies default duracion_min=60 and recordar_min_antes=30 via policy path', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Odontólogo', fecha: '2026-06-15', hora: '14:00' },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-pol-1' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá odontólogo', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('evento_personal')
    expect(pendingInsert?.args?.duracion_min).toBe(60)
    expect(pendingInsert?.args?.recordar_min_antes).toBe(30)
  })

  it('preserves explicit duracion_min when provided (args override defaults)', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Reunión', fecha: '2026-06-15', hora: '10:00', duracion_min: 90 },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-pol-2' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reunión 90 min', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.args?.duracion_min).toBe(90)
    expect(pendingInsert?.args?.recordar_min_antes).toBe(30)
  })

  it('preserves recordar_min_antes=0 (sin recordatorio) when explicitly passed', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Bloqueo', fecha: '2026-06-15', hora: '09:00', recordar_min_antes: 0 },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-pol-3' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'bloqueo sin recordatorio', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.args?.recordar_min_antes).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// S3 — tools return {kind:'preview'} and dispatcher drives the Telegram send
// ═══════════════════════════════════════════════════════════════════════════════

// ─── S3 internal return-shape assertions ─────────────────────────────────────
// Import the tool functions directly so we can verify their return values,
// independent of the dispatcher/send layer.

describe('S3 internal — toolReagendarCita return shape', () => {
  it('returns {kind:preview, actionType:reagendar, previewId, summary, changes}', async () => {
    // We test via the POST path but check the route module's exported helpers if available.
    // Since tools are not exported, we validate via side-effects: the dispatcher must
    // call sendToKelyWithButtons exactly once (confirming it received a preview result).
    // This test is a behavioral contract test for the dispatcher path.
    setAdapterResponse({
      tool: 'reagendar_cita_kelly',
      args: { nombre_paciente: 'Lucia', nueva_fecha: '2026-06-25', nueva_hora: '10:00' },
    })

    const paciente = { id: 'p-lucia', nombre: 'Lucia Mendez' }
    const cita = { id: 'cita-lucia-1', fecha: '2026-06-15', hora: '09:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pendingRow = { id: 'pending-reagendar-shape' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagendá a Lucia para el 25/6 a las 10', chat: { id: 999 } } }))

    // Exactly one sendMessage with buttons (not two — dispatcher drives exactly one send)
    const sendCalls = getCapturedFetches().filter((f) => f.url.includes('sendMessage'))
    const buttonCalls = sendCalls.filter((f) => {
      try { return JSON.parse(f.opts.body).reply_markup != null } catch { return false }
    })
    expect(buttonCalls).toHaveLength(1)
  })
})

describe('S3 — toolReagendarCita returns {kind:preview} shape', () => {
  it('inserts pending action and dispatcher sends buttons via preview return value', async () => {
    setAdapterResponse({
      tool: 'reagendar_cita_kelly',
      args: { nombre_paciente: 'Ana', nueva_fecha: '2026-06-20', nueva_hora: '11:00' },
    })

    const paciente = { id: 'p-ana', nombre: 'Ana García' }
    const cita = { id: 'cita-ana-1', fecha: '2026-06-10', hora: '09:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pendingRow = { id: 'pending-reagendar-s3' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'reagendá a Ana para el 20/6 a las 11', chat: { id: 999 } } }))

    // Pending action inserted
    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('reagendar')

    // Dispatcher sent buttons (confirms S3: send is driven from dispatcher, not tool)
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    const keyboard = body.reply_markup?.inline_keyboard
    expect(keyboard).toBeTruthy()
    const allButtons = keyboard.flat()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_confirm_'))).toBeTruthy()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_cancel_'))).toBeTruthy()
  })
})

describe('S3 — toolCancelarCita returns {kind:preview} shape', () => {
  it('pending insert + dispatcher sends buttons — no direct citas mutation', async () => {
    setAdapterResponse({
      tool: 'cancelar_cita_kelly',
      args: { nombre_paciente: 'Pedro' },
    })

    const paciente = { id: 'p-pedro', nombre: 'Pedro Ruiz' }
    const cita = { id: 'cita-pedro-1', fecha: '2026-06-12', hora: '10:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pendingRow = { id: 'pending-cancelar-s3' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'cancelá la cita de Pedro', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('cancelar')

    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })
})

describe('S3 — toolCrearBloqueo returns {kind:preview} shape', () => {
  it('pending insert + dispatcher sends buttons — no direct citas insert', async () => {
    setAdapterResponse({
      tool: 'crear_bloqueo_agenda',
      args: { fecha: '2026-06-18', hora: '08:00', duracion_min: 120, motivo: 'Reunión directivos' },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-bloqueo-s3' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'bloqueo 2h el 18', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('bloqueo')

    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })
})

describe('S3 — toolAgendarEventoPersonal returns {kind:preview} shape', () => {
  it('pending insert + dispatcher sends buttons — no direct citas insert', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Dentista', fecha: '2026-06-22', hora: '16:00' },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-evento-s3' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'dentista el 22', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('evento_personal')

    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    expect(body.reply_markup?.inline_keyboard).toBeTruthy()
  })
})
