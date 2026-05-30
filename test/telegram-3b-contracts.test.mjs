/**
 * test/telegram-3b-contracts.test.mjs
 *
 * PR 3b — preview/confirm/cancel contract tests for the 3 remaining destructive tools:
 *   - toolCancelarCita    → {kind:'preview', actionType:'cancelar', ...}
 *   - toolCrearBloqueo    → {kind:'preview', actionType:'bloqueo', ...}
 *   - toolAgendarEventoPersonal → {kind:'preview', actionType:'evento_personal', ...}
 *
 * Each tool is tested for:
 *   1. Preview shape: inserts pending action + sends Telegram message with confirm/cancel buttons
 *   2. Confirm path: resolveKellyPending applies the side-effect
 *   3. Cancel path: resolveKellyPending cancels without mutation
 *
 * Uses the shared harness from test/helpers/telegram-mock-builder.mjs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  setAdapterResponse,
} from './helpers/telegram-mock-builder.mjs'

setupTelegramMocks()

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

// ═══════════════════════════════════════════════════════════════════════════════
// 1. toolCancelarCita
// ═══════════════════════════════════════════════════════════════════════════════

describe('toolCancelarCita — preview contract shape', () => {
  it('inserts a cancelar pending action and sends confirm/cancel buttons', async () => {
    setAdapterResponse({
      tool: 'cancelar_cita_kelly',
      args: { nombre_paciente: 'Luis' },
    })

    const paciente = { id: 'p-2', nombre: 'Luis Perez' }
    const cita = { id: 'cita-2', fecha: '2026-06-01', hora: '10:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }
    const pendingRow = { id: 'pending-cancelar-1' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pendingRow])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'cancelá la cita de Luis', chat: { id: 999 } } }))

    // Pending action inserted with correct type
    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('cancelar')
    expect(pendingInsert?.args?.cita_id).toBe('cita-2')
    expect(pendingInsert?.args?.paciente_nombre).toBe('Luis Perez')

    // Confirm/cancel buttons sent
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    const keyboard = body.reply_markup?.inline_keyboard
    expect(keyboard).toBeTruthy()
    const allButtons = keyboard.flat()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_confirm_'))).toBeTruthy()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_cancel_'))).toBeTruthy()
  })

  it('does NOT cancel the cita directly in the tool phase (no citas UPDATE)', async () => {
    setAdapterResponse({
      tool: 'cancelar_cita_kelly',
      args: { nombre_paciente: 'Luis' },
    })

    const paciente = { id: 'p-2', nombre: 'Luis Perez' }
    const cita = { id: 'cita-2', fecha: '2026-06-01', hora: '10:00:00', servicio: 'Consulta', modalidad: 'presencial', estado: 'confirmada' }

    mockFrom.mockImplementation((table) => {
      if (table === 'pacientes') return makeBuilder(table, [paciente])
      if (table === 'citas') return makeBuilder(table, [cita])
      if (table === 'pending_kelly_actions') return makeBuilder(table, [{ id: 'pending-c' }])
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'cancelá la cita de Luis', chat: { id: 999 } } }))

    expect(getUpdated()['citas']).toBeUndefined()
  })
})

describe('toolCancelarCita — confirm path', () => {
  it('confirm → citas estado set to cancelada', async () => {
    const pending = {
      id: 'pending-cancelar-c1',
      action_type: 'cancelar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-3', paciente_nombre: 'Ana', fecha: '2026-06-01', hora: '11:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-cancelar-c1',
        data: `kelly_confirm_pending-cancelar-c1`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const citaUpdate = getUpdated()['citas']?.[0]
    expect(citaUpdate?.payload?.estado).toBe('cancelada')
    expect(citaUpdate?.filters?.id).toBe('cita-3')

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    expect(answerCall).toBeTruthy()
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Aplicado/i)
  })
})

describe('toolCancelarCita — cancel path', () => {
  it('cancel → no citas mutation, status cancelled', async () => {
    const pending = {
      id: 'pending-cancelar-cancel',
      action_type: 'cancelar',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { cita_id: 'cita-4', paciente_nombre: 'Bob', fecha: '2026-06-01', hora: '09:00' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-cancelar-cancel',
        data: `kelly_cancel_pending-cancelar-cancel`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    expect(getUpdated()['citas']).toBeUndefined()
    expect(getInserted()['citas']).toBeUndefined()

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Cancelado/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. toolCrearBloqueo
// ═══════════════════════════════════════════════════════════════════════════════

describe('toolCrearBloqueo — preview contract shape', () => {
  it('inserts a bloqueo pending action and sends confirm/cancel buttons', async () => {
    setAdapterResponse({
      tool: 'crear_bloqueo_agenda',
      args: { fecha: '2026-06-10', hora: '09:00', duracion_min: 60, motivo: 'Capacitación' },
    })

    const pendingRow = { id: 'pending-bloqueo-1' }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pendingRow]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'bloqueá el lunes de 9 a 10', chat: { id: 999 } } }))

    // Pending action inserted with correct type and args
    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('bloqueo')
    expect(pendingInsert?.args?.fecha).toBe('2026-06-10')
    expect(pendingInsert?.args?.hora).toBe('09:00')
    expect(pendingInsert?.args?.duracion_min).toBe(60)
    expect(pendingInsert?.args?.motivo).toBe('Capacitación')

    // Confirm/cancel buttons sent
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    const keyboard = body.reply_markup?.inline_keyboard
    expect(keyboard).toBeTruthy()
    const allButtons = keyboard.flat()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_confirm_'))).toBeTruthy()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_cancel_'))).toBeTruthy()
  })

  it('does NOT insert into citas directly in the tool phase', async () => {
    setAdapterResponse({
      tool: 'crear_bloqueo_agenda',
      args: { fecha: '2026-06-10', hora: '09:00', duracion_min: 60, motivo: 'Reunión' },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [{ id: 'pending-b' }]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'bloqueá el martes de 9 a 10', chat: { id: 999 } } }))

    expect(getInserted()['citas']).toBeUndefined()
  })
})

describe('toolCrearBloqueo — confirm path', () => {
  it('confirm → citas insert with agenda_bloqueada, servicio and modalidad NOT NULL', async () => {
    const pending = {
      id: 'pending-bloqueo-c1',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-10', hora: '09:00', duracion_min: 60, motivo: 'Capacitación' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-c1',
        data: `kelly_confirm_pending-bloqueo-c1`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const citaInsert = getInserted()['citas']?.[0]
    expect(citaInsert?.estado).toBe('agenda_bloqueada')
    expect(citaInsert?.servicio).toBeTruthy()
    expect(citaInsert?.modalidad).toBe('presencial')
    expect(citaInsert?.motivo_bloqueo).toBe('Capacitación')

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Aplicado/i)
  })
})

describe('toolCrearBloqueo — cancel path', () => {
  it('cancel → no citas insert or update, status cancelled', async () => {
    const pending = {
      id: 'pending-bloqueo-cancel',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-10', hora: '09:00', duracion_min: 60, motivo: 'Test' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-bloqueo-cancel',
        data: `kelly_cancel_pending-bloqueo-cancel`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    expect(getInserted()['citas']).toBeUndefined()
    expect(getUpdated()['citas']).toBeUndefined()

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Cancelado/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. toolAgendarEventoPersonal
// ═══════════════════════════════════════════════════════════════════════════════

describe('toolAgendarEventoPersonal — preview contract shape', () => {
  it('inserts an evento_personal pending action and sends confirm/cancel buttons', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Dentista', fecha: '2026-06-15', hora: '15:00' },
    })

    const pendingRow = { id: 'pending-evento-1' }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pendingRow]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá mi cita al dentista el 15/6 a las 15:00', chat: { id: 999 } } }))

    // Pending action inserted with defaults
    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('evento_personal')
    expect(pendingInsert?.args?.motivo).toBe('Dentista')
    expect(pendingInsert?.args?.duracion_min).toBe(60)       // default 60
    expect(pendingInsert?.args?.recordar_min_antes).toBe(30) // default 30

    // Confirm/cancel buttons sent
    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    const body = JSON.parse(sendCall.opts.body)
    const keyboard = body.reply_markup?.inline_keyboard
    expect(keyboard).toBeTruthy()
    const allButtons = keyboard.flat()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_confirm_'))).toBeTruthy()
    expect(allButtons.find((b) => b.callback_data?.includes('kelly_cancel_'))).toBeTruthy()
  })

  it('does NOT insert into citas directly in the tool phase', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Reunión', fecha: '2026-06-15', hora: '10:00' },
    })

    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [{ id: 'pending-ev' }]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá mi reunión', chat: { id: 999 } } }))

    expect(getInserted()['citas']).toBeUndefined()
  })
})

describe('toolAgendarEventoPersonal — confirm path', () => {
  it('confirm with recordar_min_antes=30 → citas insert + tareas insert at correct time', async () => {
    const pending = {
      id: 'pending-evento-c1',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Dentista', recordar_min_antes: 30 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-evento-c1',
        data: `kelly_confirm_pending-evento-c1`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    const citaInsert = getInserted()['citas']?.[0]
    expect(citaInsert?.estado).toBe('agenda_bloqueada')
    expect(citaInsert?.servicio).toBeTruthy()
    expect(citaInsert?.modalidad).toBe('presencial')
    expect(citaInsert?.motivo_bloqueo).toBe('Dentista')

    // 15:00 at -05:00 = 20:00 UTC; minus 30 min = 19:30 UTC
    const tareaInsert = getInserted()['tareas']?.[0]
    expect(tareaInsert?.fecha_hora).toBe('2026-05-30T19:30:00.000Z')

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Aplicado/i)
  })

  it('confirm with recordar_min_antes=0 → citas insert but NO tareas insert', async () => {
    const pending = {
      id: 'pending-evento-c2',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-01', hora: '10:00', duracion_min: 60, motivo: 'Bloqueo', recordar_min_antes: 0 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-evento-c2',
        data: `kelly_confirm_pending-evento-c2`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    expect(getInserted()['citas']?.[0]).toBeTruthy()
    expect(getInserted()['tareas']).toBeUndefined()
  })
})

describe('toolAgendarEventoPersonal — cancel path', () => {
  it('cancel → no citas or tareas insert, status cancelled', async () => {
    const pending = {
      id: 'pending-evento-cancel',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-06-01', hora: '10:00', duracion_min: 60, motivo: 'Test', recordar_min_antes: 30 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: {
        id: 'cq-evento-cancel',
        data: `kelly_cancel_pending-evento-cancel`,
        message: { message_id: 1, chat: { id: 999 } },
      },
    }))

    expect(getInserted()['citas']).toBeUndefined()
    expect(getInserted()['tareas']).toBeUndefined()

    const answerCall = getCapturedFetches().find((f) => f.url.includes('answerCallbackQuery'))
    const body = JSON.parse(answerCall.opts.body)
    expect(body.text).toMatch(/Cancelado/i)
  })
})
