/**
 * test/telegram-evento-personal.test.mjs
 *
 * Vitest unit tests for the personal-event flow in app/api/telegram/route.js:
 *   - agendar_evento_personal tool → creates a pending action with defaults
 *   - confirming it → inserts an agenda block (NOT NULL servicio/modalidad respected)
 *     AND a reminder row in `tareas` at (event time − recordar_min_antes)
 *   - recordar_min_antes = 0 → no reminder
 *   - bug fix: crear_bloqueo_agenda now inserts servicio + modalidad
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
  getCapturedFetches,
  setAdapterResponse,
} from './helpers/telegram-mock-builder.mjs'

setupTelegramMocks() // no-op; mocks declared at module level in helper

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

// ═══════════════════════════════════════════════════════════════════════════════

describe('agendar_evento_personal — tool', () => {
  it('creates a pending action with default 60 min duration and 30 min reminder', async () => {
    setAdapterResponse({
      tool: 'agendar_evento_personal',
      args: { motivo: 'Odontólogo', fecha: '2026-05-30', hora: '15:00' },
    })
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-new' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá mi visita al odontólogo mañana 15:00', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('evento_personal')
    expect(pendingInsert.args.duracion_min).toBe(60)
    expect(pendingInsert.args.recordar_min_antes).toBe(30)

    const sendCall = getCapturedFetches().find((f) => f.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
  })
})

describe('confirming evento_personal', () => {
  it('inserts an agenda block with servicio + modalidad and a reminder 30 min before', async () => {
    const pending = {
      id: 'pending-1',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Odontólogo', recordar_min_antes: 30 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_pending-1', message: { message_id: 1, chat: { id: 999 } } },
    }))

    const citaInsert = getInserted()['citas']?.[0]
    expect(citaInsert?.estado).toBe('agenda_bloqueada')
    expect(citaInsert.servicio).toBeTruthy() // NOT NULL respected
    expect(citaInsert.modalidad).toBe('presencial') // NOT NULL respected
    expect(citaInsert.motivo_bloqueo).toBe('Odontólogo')

    const tareaInsert = getInserted()['tareas']?.[0]
    // 15:00 at -05:00 = 20:00 UTC; minus 30 min = 19:30 UTC
    expect(tareaInsert?.fecha_hora).toBe('2026-05-30T19:30:00.000Z')
  })

  it('does NOT create a reminder when recordar_min_antes is 0', async () => {
    const pending = {
      id: 'p2',
      action_type: 'evento_personal',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '15:00', duracion_min: 60, motivo: 'Bloqueo', recordar_min_antes: 0 },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_p2', message: { message_id: 1, chat: { id: 999 } } },
    }))

    expect(getInserted()['citas']?.[0]).toBeTruthy()
    expect(getInserted()['tareas']).toBeUndefined()
  })
})

describe('crear_bloqueo_agenda — bug fix', () => {
  it('inserts servicio and modalidad so the NOT NULL constraint is satisfied', async () => {
    const pending = {
      id: 'p3',
      action_type: 'bloqueo',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: { fecha: '2026-05-30', hora: '09:00', duracion_min: 30, motivo: 'Reunión' },
    }
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions' ? makeBuilder(table, [pending]) : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_p3', message: { message_id: 1, chat: { id: 999 } } },
    }))

    const citaInsert = getInserted()['citas']?.[0]
    expect(citaInsert?.servicio).toBeTruthy()
    expect(citaInsert.modalidad).toBe('presencial')
    expect(citaInsert.estado).toBe('agenda_bloqueada')
  })
})
