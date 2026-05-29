/**
 * test/confirmar-actualizacion-datos.test.mjs
 *
 * Vitest unit tests for confirmarActualizacionDatos logic.
 *
 * TDD RED phase: tests written before implementation.
 *
 * Import target: lib/confirmar-actualizacion-datos.js
 *
 * Covers:
 *   - auto_update path: UPDATE pacientes + INSERT historial estado='aprobado'
 *   - request_approval path: INSERT historial estado='pendiente', escalation_required=true
 *   - UNIQUE collision path: from_number belongs to DIFFERENT paciente_id → INSERT pendiente + escalate
 *   - already_up_to_date: from_number matches existing telefono → no writes, success message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirmarActualizacionDatos } from '../lib/confirmar-actualizacion-datos.js'

// ─── Supabase mock builder ──────────────────────────────────────────────────

function makeSelectResult(data) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data, error: null })),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  }
}

function makeInsertResult(data = { id: 'hist-uuid-1' }) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data, error: null })),
  }
}

function makeUpdateResult() {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn(async (cb) => cb({ data: {}, error: null })),
  }
}

/**
 * Builds a supabase mock with controllable per-table behavior.
 * selectResults: { tableName: rowData|null }
 */
function makeSupabaseMock({ selectResults = {}, insertData = { id: 'hist-uuid-1' } } = {}) {
  const insertedRows = []
  const updatedRows = []

  const fromMock = vi.fn((table) => {
    const builder = {
      _table: table,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      update: vi.fn((vals) => {
        updatedRows.push({ table, vals })
        return builder
      }),
      insert: vi.fn((vals) => {
        insertedRows.push({ table, vals })
        return builder
      }),
      maybeSingle: vi.fn(async () => ({
        data: selectResults[table] ?? null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: table === 'pacientes_telefono_historial' && insertedRows.length > 0
          ? insertData
          : (selectResults[table] ?? null),
        error: null,
      })),
    }
    return builder
  })

  return {
    supabase: { from: fromMock },
    insertedRows,
    updatedRows,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('confirmarActualizacionDatos — auto_update path', () => {
  it('updates pacientes and inserts historial with estado=aprobado', async () => {
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({
      // No collision: no other paciente with that phone
      selectResults: { pacientes: null },
    })

    const args = {
      paciente_id: 'pac-uuid-1',
      from_number: '+593999000001',
      telefono_nuevo: '+593999000001',
      fecha_nacimiento: '1990-03-15',
      mode: 'auto_update',
    }

    const result = await confirmarActualizacionDatos(args, supabase)
    const parsed = JSON.parse(result)

    expect(parsed.status).toBe('updated')
    expect(parsed.escalation_required).toBeFalsy()

    // Should have updated pacientes
    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate).toBeDefined()
    expect(pacUpdate.vals.telefono).toBe('+593999000001')
    expect(pacUpdate.vals.fecha_nacimiento).toBe('1990-03-15')

    // Should have inserted historial with estado=aprobado
    const histInsert = insertedRows.find((r) => r.table === 'pacientes_telefono_historial')
    expect(histInsert).toBeDefined()
    expect(histInsert.vals.estado).toBe('aprobado')
    expect(histInsert.vals.aprobado_por).toBe('sistema')
    expect(histInsert.vals.paciente_id).toBe('pac-uuid-1')
  })

  it('stores the inbound WhatsApp number safely even if telefono_nuevo differs', async () => {
    const { supabase, updatedRows } = makeSupabaseMock({
      selectResults: { pacientes: null },
    })

    await confirmarActualizacionDatos(
      {
        paciente_id: 'pac-uuid-1',
        from_number: '+593999000777',
        telefono_nuevo: '+593111111111',
        mode: 'auto_update',
      },
      supabase
    )

    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate.vals.telefono).toBe('+593999000777')
  })

  it('does not overwrite birth date when it was not provided', async () => {
    const { supabase, updatedRows } = makeSupabaseMock({
      selectResults: { pacientes: null },
    })

    await confirmarActualizacionDatos(
      {
        paciente_id: 'pac-uuid-1',
        from_number: '+593999000001',
        telefono_nuevo: '+593999000001',
        mode: 'auto_update',
      },
      supabase
    )

    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate.vals).toEqual({ telefono: '+593999000001' })
  })
})

describe('confirmarActualizacionDatos — request_approval path', () => {
  it('inserts pendiente historial and returns escalation_required=true', async () => {
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({
      selectResults: { pacientes: null }, // No collision with other patient
    })

    const args = {
      paciente_id: 'pac-uuid-2',
      from_number: '+593999000002',
      telefono_nuevo: '+593999000002',
      fecha_nacimiento: '1985-07-20',
      mode: 'request_approval',
      existing_telefono: '+593999000099',
    }

    const result = await confirmarActualizacionDatos(args, supabase)
    const parsed = JSON.parse(result)

    expect(parsed.status).toBe('pending_approval')
    expect(parsed.escalation_required).toBe(true)
    expect(parsed.historial_id).toBeDefined()

    // Must NOT update pacientes
    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate).toBeUndefined()

    // Must insert pendiente historial
    const histInsert = insertedRows.find((r) => r.table === 'pacientes_telefono_historial')
    expect(histInsert).toBeDefined()
    expect(histInsert.vals.estado).toBe('pendiente')
    expect(histInsert.vals.paciente_id).toBe('pac-uuid-2')
    expect(histInsert.vals.expira_at).toBeDefined()
  })
})

describe('confirmarActualizacionDatos — UNIQUE collision path', () => {
  it('detects collision and returns escalation_required=true without any UPDATE', async () => {
    // Simulate: another paciente with id 'other-pac' already has this phone
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({
      selectResults: {
        // pacientes query for collision check returns a DIFFERENT patient
        pacientes: { id: 'other-pac-uuid' },
      },
    })

    const args = {
      paciente_id: 'pac-uuid-3',
      from_number: '+593999000003',
      telefono_nuevo: '+593999000003',
      fecha_nacimiento: '1992-11-05',
      mode: 'auto_update',
    }

    const result = await confirmarActualizacionDatos(args, supabase)
    const parsed = JSON.parse(result)

    expect(parsed.status).toBe('collision_detected')
    expect(parsed.escalation_required).toBe(true)

    // Must NOT update pacientes
    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate).toBeUndefined()

    // Should insert pendiente historial for the collision
    const histInsert = insertedRows.find((r) => r.table === 'pacientes_telefono_historial')
    expect(histInsert).toBeDefined()
    expect(histInsert.vals.estado).toBe('pendiente')
  })
})

describe('confirmarActualizacionDatos — already_up_to_date', () => {
  it('returns success with no DB writes when from_number matches existing telefono', async () => {
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({
      selectResults: { pacientes: null },
    })

    const args = {
      paciente_id: 'pac-uuid-4',
      from_number: '+593999000004',
      telefono_nuevo: '+593999000004',
      fecha_nacimiento: '1975-01-30',
      mode: 'auto_update',
      existing_telefono: '+593999000004', // same as from_number
    }

    const result = await confirmarActualizacionDatos(args, supabase)
    const parsed = JSON.parse(result)

    expect(parsed.status).toBe('already_up_to_date')
    expect(updatedRows).toHaveLength(0)
    expect(insertedRows).toHaveLength(0)
  })
})
