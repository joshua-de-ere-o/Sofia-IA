import { describe, expect, it } from 'vitest'

import { createManualAppointmentRecord, getManualAppointmentFormOptions, normalizeManualAppointmentPayload } from '@/lib/manual-appointment.js'
import { runCreateManualAppointmentFlow } from '@/app/dashboard/hooks/useCitas'

function makeMockSupabase({ existingPatient = null, slotConflicts = [], insertedCitaId = 'cita-1' } = {}) {
  const state = {
    existingPatient,
    slotConflicts,
    insertedCitaId,
    patientsInserted: [],
    patientsUpdated: [],
    citasInserted: [],
  }

  return {
    state,
    from(table) {
      if (table === 'citas') {
        return {
          select() {
            return {
              eq(_fechaColumn, fecha) {
                return { eq(_horaColumn, hora) { return { not() { return Promise.resolve({ data: state.slotConflicts.filter((row) => row.fecha === fecha && row.hora === hora), error: null }) } } } }
              },
            }
          },
          insert(row) {
            state.citasInserted.push(row)
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: { id: state.insertedCitaId, ...row },
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'pacientes') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: state.existingPatient, error: null })
                  },
                }
              },
            }
          },
          update(payload) {
            state.patientsUpdated.push(payload)
            return {
              eq() {
                return Promise.resolve({ error: null })
              },
            }
          },
          insert(row) {
            state.patientsInserted.push(row)
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: { id: 'paciente-nuevo-1', ...row },
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

const VALID_INPUT = {
  patientName: ' Ana Torres ',
  patientPhone: ' 0999999999 ',
  patientBirthDate: '1990-03-15',
  service: 'alimentario_exclusivo',
  date: '2026-06-10',
  time: '09:00',
  modalidad: 'presencial',
  zona: 'domicilio',
  estado: 'confirmada',
  motivo: ' Seguimiento mensual ',
}

describe('normalizeManualAppointmentPayload', () => {
  it('trims patient and appointment fields before submit', () => {
    expect(normalizeManualAppointmentPayload(VALID_INPUT)).toEqual({
      patientName: 'Ana Torres',
      patientPhone: '0999999999',
      patientBirthDate: '1990-03-15',
      service: 'alimentario_exclusivo',
      date: '2026-06-10',
      time: '09:00',
      modalidad: 'presencial',
      zona: 'domicilio',
      estado: 'confirmada',
      motivo: 'Seguimiento mensual',
    })
  })

  it('preserves an explicit pending-payment status selected by CRM', () => {
    const result = normalizeManualAppointmentPayload({ ...VALID_INPUT, estado: 'pendiente_pago' })

    expect(result.estado).toBe('pendiente_pago')
  })
})

describe('getManualAppointmentFormOptions', () => {
  it('offers only agendable services in the CRM form', () => {
    const result = getManualAppointmentFormOptions('alimentario_exclusivo', 'presencial')

    expect(result.services.some((service) => service.value === 'alimentario_exclusivo')).toBe(true)
    expect(result.services.some((service) => service.value === 'taller_empresarial')).toBe(false)
  })

  it('limits virtual bookings to the virtual zone', () => {
    const result = getManualAppointmentFormOptions('alimentario_exclusivo', 'virtual')

    expect(result.zonas).toEqual([{ value: 'virtual', label: 'Virtual' }])
  })
})

describe('createManualAppointmentRecord', () => {
  it('creates a patient and a manual appointment when the phone is new', async () => {
    const supabase = makeMockSupabase()

    const result = await createManualAppointmentRecord(supabase, VALID_INPUT)

    expect(result).toMatchObject({
      success: true,
      patientId: 'paciente-nuevo-1',
      citaId: 'cita-1',
      patientReused: false,
    })
    expect(supabase.state.patientsInserted).toHaveLength(1)
    expect(supabase.state.patientsInserted[0]).toMatchObject({
      nombre: 'Ana Torres',
      telefono: '0999999999',
      zona: 'domicilio',
    })
    expect(supabase.state.citasInserted[0]).toMatchObject({
      paciente_id: 'paciente-nuevo-1',
      servicio: 'alimentario_exclusivo',
      fecha: '2026-06-10',
      hora: '09:00:00',
      estado: 'confirmada',
      modalidad: 'presencial',
      zona: 'domicilio',
      motivo: 'Seguimiento mensual',
      duracion_min: 60,
      monto_adelanto: 20,
      monto_total: 40,
    })
  })

  it('reuses the existing patient for the same phone instead of inserting a duplicate', async () => {
    const supabase = makeMockSupabase({
      existingPatient: { id: 'paciente-existente-1', nombre: 'Ana', telefono: '0999999999', zona: 'sur' },
    })

    const result = await createManualAppointmentRecord(supabase, {
      ...VALID_INPUT,
      zona: 'sur',
      service: 'alimentario_mensual',
      estado: 'pendiente_pago',
    })

    expect(result).toMatchObject({
      success: true,
      patientId: 'paciente-existente-1',
      patientReused: true,
    })
    expect(supabase.state.patientsInserted).toHaveLength(0)
    expect(supabase.state.patientsUpdated).toHaveLength(1)
    expect(supabase.state.patientsUpdated[0]).toMatchObject({
      nombre: 'Ana Torres',
      fecha_nacimiento: '1990-03-15',
    })
  })

  it('rejects an occupied slot when another active appointment already exists', async () => {
    const supabase = makeMockSupabase({
      slotConflicts: [{ id: 'cita-activa-1', fecha: '2026-06-10', hora: '09:00:00', estado: 'confirmada' }],
    })

    const result = await createManualAppointmentRecord(supabase, VALID_INPUT)

    expect(result).toEqual({ error: 'Ya existe una cita activa en ese horario. Elegí otro turno.' })
    expect(supabase.state.patientsInserted).toHaveLength(0)
    expect(supabase.state.citasInserted).toHaveLength(0)
  })

  it('allows a cancelled slot to be reused for a new manual appointment', async () => {
    const supabase = makeMockSupabase({
      slotConflicts: [{ id: 'cita-cancelada-1', fecha: '2026-06-10', hora: '09:00:00', estado: 'cancelada' }],
    })

    const result = await createManualAppointmentRecord(supabase, VALID_INPUT)

    expect(result.success).toBe(true)
    expect(supabase.state.citasInserted).toHaveLength(1)
  })

  it('allows a no_show slot to be reused for a new manual appointment', async () => {
    const supabase = makeMockSupabase({
      slotConflicts: [{ id: 'cita-no-show-1', fecha: '2026-06-10', hora: '09:00:00', estado: 'no_show' }],
    })

    const fetchSpy = globalThis.fetch
    const fetchCalls = []
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args)
      return { ok: true }
    }

    try {
      const result = await createManualAppointmentRecord(supabase, VALID_INPUT)

      expect(result.success).toBe(true)
      expect(supabase.state.citasInserted).toHaveLength(1)
      expect(fetchCalls).toHaveLength(0)
    } finally {
      globalThis.fetch = fetchSpy
    }
  })
})

describe('runCreateManualAppointmentFlow', () => {
  it('refreshes the agenda after a successful manual save', async () => {
    const actionLoadingCalls = []
    const manualErrorCalls = []
    const fetchCalls = []

    const result = await runCreateManualAppointmentFlow({
      payload: VALID_INPUT,
      createManualAppointmentAction: async () => ({ success: true }),
      fetchCitas: async () => {
        fetchCalls.push('refresh')
      },
      setActionLoading: (value) => actionLoadingCalls.push(value),
      setManualError: (value) => manualErrorCalls.push(value),
    })

    expect(result).toEqual({ success: true, date: '2026-06-10' })
    expect(fetchCalls).toEqual(['refresh'])
    expect(actionLoadingCalls).toEqual(['manual-create', null])
    expect(manualErrorCalls).toEqual([''])
  })

  it('keeps the CRM error local and skips agenda refresh when the manual save fails', async () => {
    const actionLoadingCalls = []
    const manualErrorCalls = []
    const fetchCalls = []

    const result = await runCreateManualAppointmentFlow({
      payload: VALID_INPUT,
      createManualAppointmentAction: async () => ({ error: 'Ya existe una cita activa en ese horario. Elegí otro turno.' }),
      fetchCitas: async () => {
        fetchCalls.push('refresh')
      },
      setActionLoading: (value) => actionLoadingCalls.push(value),
      setManualError: (value) => manualErrorCalls.push(value),
    })

    expect(result).toEqual({ error: 'Ya existe una cita activa en ese horario. Elegí otro turno.' })
    expect(fetchCalls).toEqual([])
    expect(actionLoadingCalls).toEqual(['manual-create', null])
    expect(manualErrorCalls).toEqual(['', 'Ya existe una cita activa en ese horario. Elegí otro turno.'])
  })
})
