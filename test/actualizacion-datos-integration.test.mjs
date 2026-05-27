/**
 * test/actualizacion-datos-integration.test.mjs
 *
 * Integration tests covering spec acceptance scenarios S1, S2, S3, S5, S6, S7.
 *
 * Strategy: exercise the lib/* modules end-to-end with realistic mocked Supabase.
 * Telegram notifications are out of scope for PR 2 (PR 3 surface) — the tests
 * assert that escalation_required=true is returned correctly so PR 3 can act.
 *
 * S1 — Happy path: patient without existing phone
 * S2 — Natural-language trigger: same data flow as S1 after iniciar_actualizacion_datos
 * S3 — Conflict path: Dra. Kely approval pending (request_approval)
 * S5 — Zero matches with 2 retries → escalate (match:'none')
 * S6 — Multiple matches → immediate escalate (match:'multiple')
 * S7 — Birth date parse failure × 3 → escalate (parse_appointment_date returns ok:false)
 */

import { describe, it, expect, vi } from 'vitest'
import { parseSpanishDate } from '../lib/parse-spanish-date.js'
import { applyMatchDecision, verificarDatosPaciente } from '../lib/verificar-datos-paciente.js'
import { confirmarActualizacionDatos } from '../lib/confirmar-actualizacion-datos.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeRpcMock(rows) {
  return { rpc: vi.fn(async () => ({ data: rows, error: null })) }
}

function makeSupabaseMock({ collisionRow = null, insertData = { id: 'hist-uuid-1' } } = {}) {
  const insertedRows = []
  const updatedRows = []

  const makeBuilder = (table) => ({
    _table: table,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    update: vi.fn((vals) => { updatedRows.push({ table, vals }); return makeBuilder(table) }),
    insert: vi.fn((vals) => { insertedRows.push({ table, vals }); return makeBuilder(table) }),
    maybeSingle: vi.fn(async () => ({ data: collisionRow, error: null })),
    single: vi.fn(async () => ({ data: insertData, error: null })),
  })

  return {
    supabase: { from: vi.fn((t) => makeBuilder(t)) },
    insertedRows,
    updatedRows,
  }
}

// ─── S1: Happy path — patient without existing phone ───────────────────────

describe('S1 — happy path, no existing phone', () => {
  it('full flow: parse dates → verify → confirm auto_update', async () => {
    // 1. Parse appointment date
    const dateResult = parseSpanishDate('15/06/2026', '2026-05-27')
    expect(dateResult).toEqual({ ok: true, date: '2026-06-15' })

    // 2. Verify patient — RPC returns 1 unique match with null phone
    const rpcRows = [{ id: 'pac-uuid-s1', nombre: 'María García López', telefono: null, score: 0.93 }]
    const supabaseRpc = makeRpcMock(rpcRows)
    const verifyResult = await verificarDatosPaciente(
      { nombre_completo: 'María García López', fecha_cita: '2026-06-15', fecha_nacimiento: '1985-03-20', from_number: '+593987654321' },
      supabaseRpc
    )
    expect(verifyResult.match).toBe('unique')
    expect(verifyResult.mode_suggested).toBe('auto_update')
    expect(verifyResult.paciente_id).toBe('pac-uuid-s1')

    // 3. Confirm — auto_update
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({ collisionRow: null })
    const confirmResult = await confirmarActualizacionDatos(
      { paciente_id: 'pac-uuid-s1', from_number: '+593987654321', telefono_nuevo: '+593987654321', fecha_nacimiento: '1985-03-20', mode: 'auto_update' },
      supabase
    )
    const parsed = JSON.parse(confirmResult)

    expect(parsed.status).toBe('updated')
    expect(parsed.escalation_required).toBe(false)
    // Closure message present
    expect(parsed.mensaje_sofia).toContain('Dra. Kely')
    expect(parsed.mensaje_sofia).toContain('recordatorio')

    // DB writes
    const pacUpdate = updatedRows.find((r) => r.table === 'pacientes')
    expect(pacUpdate.vals.telefono).toBe('+593987654321')
    const histInsert = insertedRows.find((r) => r.table === 'pacientes_telefono_historial')
    expect(histInsert.vals.estado).toBe('aprobado')
    expect(histInsert.vals.aprobado_por).toBe('sistema')
  })
})

// ─── S2: Natural-language trigger (same data flow after iniciar) ───────────

describe('S2 — natural language trigger', () => {
  it('iniciar_actualizacion_datos returns correct shape for known patient', async () => {
    // The iniciar executor just returns metadata — no DB.
    // This simulates what happens after the LLM calls the tool on natural-language input.
    const { iniciarActualizacionDatos } = await import('../lib/iniciar-actualizacion-datos.js')
    const result = iniciarActualizacionDatos({ trigger: 'llm_intent', paciente_id: 'pac-uuid-s2', from_number: '+593987654322' })

    expect(result.ok).toBe(true)
    expect(result.datos_requeridos).toContain('nombre_completo')
    expect(result.datos_requeridos).toContain('fecha_nacimiento')
    expect(result.datos_requeridos).toContain('fecha_proxima_o_ultima_cita')
    expect(result.paciente_conocido).toBe(true)
  })

  it('iniciar_actualizacion_datos returns paciente_conocido=false for unknown sender', async () => {
    const { iniciarActualizacionDatos } = await import('../lib/iniciar-actualizacion-datos.js')
    const result = iniciarActualizacionDatos({ trigger: 'llm_intent', paciente_id: null, from_number: '+593000000000' })
    expect(result.paciente_conocido).toBe(false)
  })
})

// ─── S3: Conflict path — request_approval (pending Dra. Kely) ─────────────

describe('S3 — conflict path, request_approval', () => {
  it('inserts pendiente historial and signals escalation without updating pacientes', async () => {
    const { supabase, insertedRows, updatedRows } = makeSupabaseMock({ collisionRow: null })

    const result = await confirmarActualizacionDatos(
      {
        paciente_id: 'pac-uuid-s3',
        from_number: '+593999000002',
        telefono_nuevo: '+593999000002',
        fecha_nacimiento: '1975-07-10',
        mode: 'request_approval',
        existing_telefono: '+593999000099',
      },
      supabase
    )
    const parsed = JSON.parse(result)

    expect(parsed.status).toBe('pending_approval')
    expect(parsed.escalation_required).toBe(true)
    expect(parsed.historial_id).toBeDefined()
    expect(parsed.mensaje_sofia).toContain('Dra. Kely')

    // No UPDATE to pacientes
    expect(updatedRows.find((r) => r.table === 'pacientes')).toBeUndefined()

    // INSERT pendiente
    const hist = insertedRows.find((r) => r.table === 'pacientes_telefono_historial')
    expect(hist.vals.estado).toBe('pendiente')
    expect(hist.vals.expira_at).toBeDefined()
  })
})

// ─── S5: Zero matches × 2 retries → match:'none' ─────────────────────────

describe('S5 — zero matches with retries', () => {
  it('verificarDatosPaciente returns match:none when RPC returns 0 rows', async () => {
    const supabase = makeRpcMock([])
    const result = await verificarDatosPaciente(
      { nombre_completo: 'Nobody', fecha_cita: '2026-06-01', fecha_nacimiento: '1990-01-01', from_number: '+593000000001' },
      supabase
    )
    // The retry logic is handled by the LLM (counting its own history).
    // This module always returns match:'none' for 0 rows — the LLM escalates after 2.
    expect(result.match).toBe('none')
  })
})

// ─── S6: Multiple matches → immediate escalation ─────────────────────────

describe('S6 — multiple matches', () => {
  it('returns match:multiple immediately for 2+ rows', async () => {
    const rows = [
      { id: 'uuid-a', nombre: 'Ana López', telefono: null, score: 0.91 },
      { id: 'uuid-b', nombre: 'Ana Lopez', telefono: null, score: 0.87 },
    ]
    const result = applyMatchDecision(rows, '+593999000001')
    expect(result.match).toBe('multiple')
    expect(result.candidates).toHaveLength(2)
    // No retry — LLM escalates immediately on multiple
  })
})

// ─── S7: Birth date parse failure × 3 ────────────────────────────────────

describe('S7 — birth date parse failure', () => {
  const TODAY = '2026-05-27'

  it('rejects "enero del 95" (ambiguous format)', () => {
    expect(parseSpanishDate('enero del 95', TODAY).ok).toBe(false)
  })

  it('rejects "01-01-95" (2-digit year)', () => {
    expect(parseSpanishDate('01-01-95', TODAY).ok).toBe(false)
  })

  it('rejects bare month name "junio"', () => {
    expect(parseSpanishDate('junio', TODAY).ok).toBe(false)
  })

  it('all 3 failures signal Sofía to escalate (ok:false × 3)', () => {
    // The 3-failure escalation is enforced by the SYSTEM_PROMPT / LLM counting.
    // This test validates that the parser correctly returns ok:false for all 3
    // ambiguous inputs a patient might try.
    const attempts = [
      parseSpanishDate('enero del 95', TODAY),
      parseSpanishDate('1 de enero del 95', TODAY),
      parseSpanishDate('hace unos años', TODAY),
    ]
    for (const r of attempts) {
      expect(r.ok).toBe(false)
    }
  })
})
