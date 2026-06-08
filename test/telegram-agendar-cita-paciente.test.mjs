/**
 * test/telegram-agendar-cita-paciente.test.mjs
 *
 * Vitest unit tests for the patient-scheduling flow in app/api/telegram/route.js:
 *   - agendar_cita_paciente tool → validates, normalizes the phone to +593, and
 *     creates a pending action (preview) — does NOT create the appointment yet
 *   - missing required fields → asks for them, no pending action
 *   - invalid phone → surfaces the validation error, no pending action
 *   - confirming it → creates the patient + cita exactly once (CAS-first INSERT)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const VALID_TOOL_ARGS = {
  nombre: 'Carla Andrea Correa Pazmiño',
  telefono: '0983480029',
  fecha_nacimiento: '2022-08-07',
  servicio: 'alimentario_exclusivo',
  zona: 'domicilio',
  fecha: '2026-06-13',
  hora: '10:30',
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('agendar_cita_paciente — tool (preview)', () => {
  it('normalizes the phone to +593 and creates a pending action with a confirm button', async () => {
    setAdapterResponse({ tool: 'agendar_cita_paciente', args: VALID_TOOL_ARGS })
    mockFrom.mockImplementation((table) =>
      table === 'pending_kelly_actions'
        ? makeBuilder(table, [{ id: 'pending-new' }])
        : makeBuilder(table, []),
    )

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá a Carla el sábado 10:30', chat: { id: 999 } } }))

    const pendingInsert = getInserted()['pending_kelly_actions']?.[0]
    expect(pendingInsert?.action_type).toBe('agendar_cita_paciente')
    expect(pendingInsert.args.patientPhone).toBe('+593983480029')
    expect(pendingInsert.args.estado).toBe('confirmada')
    expect(pendingInsert.args.modalidad).toBe('presencial') // domicilio → presencial

    const sendCall = getCapturedFetches().find(
      (f) => f.url.includes('sendMessage') && f.opts?.body?.includes('Agendar paciente'),
    )
    expect(sendCall).toBeTruthy()
  })

  it('asks for the missing data instead of scheduling when a required field is absent', async () => {
    const { servicio, ...withoutService } = VALID_TOOL_ARGS
    setAdapterResponse({ tool: 'agendar_cita_paciente', args: withoutService })
    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá a Carla', chat: { id: 999 } } }))

    expect(getInserted()['pending_kelly_actions']).toBeUndefined()
    const sendCall = getCapturedFetches().find(
      (f) => f.url.includes('sendMessage') && f.opts?.body?.includes('servicio'),
    )
    expect(sendCall).toBeTruthy()
  })

  it('surfaces a validation error for an invalid phone and does not create a pending action', async () => {
    setAdapterResponse({ tool: 'agendar_cita_paciente', args: { ...VALID_TOOL_ARGS, telefono: '123' } })
    mockFrom.mockImplementation((table) => makeBuilder(table, []))

    const { POST } = await loadRoute()
    await POST(makeRequest({ message: { text: 'agendá a Carla', chat: { id: 999 } } }))

    expect(getInserted()['pending_kelly_actions']).toBeUndefined()
    const sendCall = getCapturedFetches().find(
      (f) => f.url.includes('sendMessage') && f.opts?.body?.includes('celular'),
    )
    expect(sendCall).toBeTruthy()
  })
})

describe('confirming agendar_cita_paciente', () => {
  it('creates the patient and the cita exactly once (confirmed) on confirm', async () => {
    const pending = {
      id: 'pending-1',
      action_type: 'agendar_cita_paciente',
      ejecutada: false,
      expira_at: new Date(Date.now() + 3600_000).toISOString(),
      args: {
        patientName: 'Carla Andrea Correa Pazmiño',
        patientPhone: '+593983480029',
        patientBirthDate: '2022-08-07',
        service: 'alimentario_exclusivo',
        date: '2026-06-13',
        time: '10:30',
        modalidad: 'presencial',
        zona: 'domicilio',
        estado: 'confirmada',
        motivo: 'Agendado por la doctora',
      },
    }

    // Custom builders: pacientes lookup returns null (new patient) but insert returns
    // an id; citas slot-check returns no conflict but insert returns an id. The shared
    // makeBuilder can't serve both reads and inserts from one rows array.
    const makeCitasBuilder = () => {
      const b = {
        select: vi.fn(() => b),
        eq: vi.fn(() => b),
        not: vi.fn(() => b),
        insert: vi.fn((payload) => { (getInserted().citas ||= []).push(payload); return b }),
        single: vi.fn().mockResolvedValue({ data: { id: 'cita-new' }, error: null }),
      }
      Object.defineProperty(b, 'then', { get() { return (resolve) => resolve({ data: [], error: null }) } })
      return b
    }
    const makePacientesBuilder = () => {
      const b = {
        select: vi.fn(() => b),
        eq: vi.fn(() => b),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn((payload) => { (getInserted().pacientes ||= []).push(payload); return b }),
        single: vi.fn().mockResolvedValue({ data: { id: 'pac-new' }, error: null }),
      }
      return b
    }

    mockFrom.mockImplementation((table) => {
      if (table === 'pending_kelly_actions') return makeBuilder(table, [pending])
      if (table === 'citas') return makeCitasBuilder()
      if (table === 'pacientes') return makePacientesBuilder()
      return makeBuilder(table, [])
    })

    const { POST } = await loadRoute()
    await POST(makeRequest({
      callback_query: { id: 'cq', data: 'kelly_confirm_pending-1', message: { message_id: 1, chat: { id: 999 } } },
    }))

    const pacienteInsert = getInserted()['pacientes']?.[0]
    expect(pacienteInsert?.telefono).toBe('+593983480029')

    const citaInsert = getInserted()['citas']?.[0]
    expect(citaInsert?.paciente_id).toBe('pac-new')
    expect(citaInsert.estado).toBe('confirmada')
    expect(citaInsert.fecha).toBe('2026-06-13')
    expect(citaInsert.hora).toBe('10:30:00')
  })
})
