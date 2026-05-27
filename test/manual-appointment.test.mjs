import { describe, expect, it } from 'vitest'

import { createManualAppointmentRecord, getManualAppointmentFormOptions, normalizeManualAppointmentPayload } from '@/lib/manual-appointment.js'

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
})

describe('getManualAppointmentFormOptions', () => {
  it('offers only agendable services in the CRM form', () => {
    const result = getManualAppointmentFormOptions('alimentario_exclusivo', 'presencial')

    expect(result.services.some((service) => service.value === 'alimentario_exclusivo')).toBe(true)
    expect(result.services.some((service) => service.value === 'taller_empresarial')).toBe(false)
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
})
