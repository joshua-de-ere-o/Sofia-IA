import { describe, expect, it } from 'vitest'

import {
  importAppointmentsIntoCrm,
  prepareAppointmentImportRows,
} from '@/lib/appointment-import.js'
import { runImportAppointmentsFlow } from '@/app/dashboard/hooks/useCitas'

function makeImportSupabase({ existingAppointments = [], existingPatients = [] } = {}) {
  const state = {
    existingAppointments,
    existingPatients,
    batchInserted: null,
    batchUpdated: [],
    patientsInserted: [],
    citasInserted: [],
    importRowsInserted: [],
  }

  return {
    state,
    from(table) {
      if (table === 'citas') {
        return {
          select() {
            return {
              in(_column, values) {
                return Promise.resolve({
                  data: state.existingAppointments.filter((row) => values.includes(row.fecha)),
                  error: null,
                })
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
                      data: { id: `cita-${state.citasInserted.length}`, ...row },
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
              in(_column, values) {
                return Promise.resolve({
                  data: state.existingPatients.filter((row) => values.includes(row.nombre)),
                  error: null,
                })
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
                      data: { id: `paciente-${state.patientsInserted.length}`, ...row },
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'citas_import_batches') {
        return {
          insert(row) {
            state.batchInserted = row
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: { id: 'batch-1', ...row },
                      error: null,
                    })
                  },
                }
              },
            }
          },
          update(row) {
            state.batchUpdated.push(row)
            return {
              eq() {
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      }

      if (table === 'citas_import_rows') {
        return {
          insert(rows) {
            state.importRowsInserted.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

const DEFAULTS = {
  service: 'alimentario_exclusivo',
  modalidad: 'presencial',
  zona: 'norte',
  estado: 'confirmada',
  motivo: 'Importado desde CRM',
}

describe('prepareAppointmentImportRows', () => {
  it('normalizes valid CSV rows and flags a Día mismatch as warning', () => {
    const csv = ['Nombre,Fecha,Hora,Día', ' Ana   Torres ,10/06/2026,9:00,Jueves'].join('\n')

    const result = prepareAppointmentImportRows(csv, { defaults: DEFAULTS })

    expect(result.imported).toBe(1)
    expect(result.warnings).toBe(1)
    expect(result.rows[0]).toMatchObject({
      patientName: 'Ana Torres',
      patientNameNormalized: 'ana torres',
      date: '2026-06-10',
      time: '09:00:00',
      status: 'ready',
    })
    expect(result.rows[0].warnings).toContain('day_mismatch')
  })

  it('rejects invalid rows and skips exact duplicates inside the same file', () => {
    const csv = [
      'Nombre,Fecha,Hora',
      'Ana Torres,10/06/2026,09:00',
      'Ana Torres,2026-06-10,09:00:00',
      'Sin Hora,2026-06-10,',
    ].join('\n')

    const result = prepareAppointmentImportRows(csv, { defaults: DEFAULTS })

    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(1)
    expect(result.rejected).toBe(1)
    expect(result.rows[1]).toMatchObject({ status: 'duplicate', duplicateScope: 'file' })
    expect(result.rows[2]).toMatchObject({ status: 'rejected', rejectionReason: 'missing_time' })
  })
})

describe('importAppointmentsIntoCrm', () => {
  it('writes imported appointments into live citas and reuses the same placeholder patient within the batch', async () => {
    const supabase = makeImportSupabase({
      existingAppointments: [
        {
          fecha: '2026-06-10',
          hora: '10:00:00',
          patient_name_normalized: 'ana torres',
          paciente: { nombre: 'Ana Torres' },
        },
      ],
    })

    const csv = [
      'Nombre,Fecha,Hora',
      'Ana Torres,10/06/2026,09:00',
      'Ana Torres,10/06/2026,09:30',
      'Ana Torres,10/06/2026,10:00',
    ].join('\n')

    const result = await importAppointmentsIntoCrm(supabase, {
      csvText: csv,
      defaults: DEFAULTS,
      actorUserId: 'user-1',
      sourceFileName: 'citas.csv',
    })

    expect(result).toMatchObject({
      status: 'ok',
      batchId: 'batch-1',
      imported: 2,
      duplicates: 1,
      rejected: 0,
    })
    expect(supabase.state.patientsInserted).toHaveLength(1)
    expect(supabase.state.patientsInserted[0]).toMatchObject({
      nombre: 'Ana Torres',
      telefono: null,
      zona: 'norte',
    })
    expect(supabase.state.citasInserted).toHaveLength(2)
    expect(supabase.state.citasInserted[0]).toMatchObject({
      import_source: 'csv',
      import_batch_id: 'batch-1',
      patient_name_normalized: 'ana torres',
      fecha: '2026-06-10',
      hora: '09:00:00',
    })
    expect(supabase.state.citasInserted[1].paciente_id).toBe('paciente-1')
    expect(supabase.state.importRowsInserted).toHaveLength(3)
  })

  it('marks DB duplicates in the row report without inserting a second cita', async () => {
    const supabase = makeImportSupabase({
      existingAppointments: [
        {
          fecha: '2026-06-10',
          hora: '09:00:00',
          patient_name_normalized: 'ana torres',
          paciente: { nombre: 'Ana Torres' },
        },
      ],
    })

    const result = await importAppointmentsIntoCrm(supabase, {
      csvText: ['Nombre,Fecha,Hora', 'Ana Torres,10/06/2026,09:00'].join('\n'),
      defaults: DEFAULTS,
      actorUserId: 'user-1',
      sourceFileName: 'duplicadas.csv',
    })

    expect(result.imported).toBe(0)
    expect(result.duplicates).toBe(1)
    expect(result.rows[0]).toMatchObject({ status: 'duplicate', duplicateScope: 'database' })
    expect(supabase.state.citasInserted).toHaveLength(0)
  })
})

describe('runImportAppointmentsFlow', () => {
  it('refreshes the CRM agenda and stores the import summary after a successful upload', async () => {
    const actionLoadingCalls = []
    const importErrorCalls = []
    const importResultCalls = []
    const fetchCalls = []

    const result = await runImportAppointmentsFlow({
      formData: new FormData(),
      importAppointmentsCsvAction: async () => ({ status: 'ok', imported: 2, duplicates: 1, warnings: 0, rejected: 0, rows: [] }),
      fetchCitas: async () => {
        fetchCalls.push('refresh')
      },
      setActionLoading: (value) => actionLoadingCalls.push(value),
      setImportError: (value) => importErrorCalls.push(value),
      setImportResult: (value) => importResultCalls.push(value),
    })

    expect(result).toMatchObject({ success: true, imported: 2 })
    expect(fetchCalls).toEqual(['refresh'])
    expect(importResultCalls.at(-1)).toMatchObject({ imported: 2, duplicates: 1 })
    expect(importErrorCalls).toEqual([''])
    expect(actionLoadingCalls).toEqual(['import-csv', null])
  })

  it('returns the action error without refreshing the agenda', async () => {
    const actionLoadingCalls = []
    const importErrorCalls = []
    const fetchCalls = []

    const result = await runImportAppointmentsFlow({
      formData: new FormData(),
      importAppointmentsCsvAction: async () => ({ error: 'Archivo inválido.' }),
      fetchCitas: async () => {
        fetchCalls.push('refresh')
      },
      setActionLoading: (value) => actionLoadingCalls.push(value),
      setImportError: (value) => importErrorCalls.push(value),
      setImportResult: () => {},
    })

    expect(result).toEqual({ error: 'Archivo inválido.' })
    expect(fetchCalls).toEqual([])
    expect(importErrorCalls).toEqual(['', 'Archivo inválido.'])
    expect(actionLoadingCalls).toEqual(['import-csv', null])
  })
})
