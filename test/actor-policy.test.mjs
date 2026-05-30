/**
 * test/actor-policy.test.mjs
 *
 * Phase 2 — Policy boundary tests.
 *
 * Verifies:
 *   - ActorPolicy factory returns correct actor/channel pairs
 *   - PATIENT_WA_POLICY is strict (defaults-only-never enforced)
 *   - OPERATOR_TELEGRAM_POLICY relaxes time constraints auditably
 *   - isOperator / isPatient helpers classify correctly
 *   - mergeOperatorOverrides does NOT mutate patient policy
 *   - Operator defaults NEVER leak into patient WhatsApp behavior
 */

import { describe, it, expect } from 'vitest'
import {
  PATIENT_WA_POLICY,
  OPERATOR_TELEGRAM_POLICY,
  OPERATOR_CRM_POLICY,
  makePolicy,
  isOperator,
  isPatient,
  mergeOperatorOverrides,
} from '../lib/actor-policy.js'

// ─── Shape tests ──────────────────────────────────────────────────────────────

describe('PATIENT_WA_POLICY', () => {
  it('has actor=patient and channel=whatsapp', () => {
    expect(PATIENT_WA_POLICY.actor).toBe('patient')
    expect(PATIENT_WA_POLICY.channel).toBe('whatsapp')
  })

  it('enforces strict data requirements', () => {
    expect(PATIENT_WA_POLICY.requiresFullData).toBe(true)
  })

  it('enforces 24h minimum advance booking', () => {
    expect(PATIENT_WA_POLICY.minAdvanceHours).toBe(24)
  })

  it('enforces 48h cancellation window', () => {
    expect(PATIENT_WA_POLICY.minCancelHours).toBe(48)
  })

  it('does NOT allow operator defaults', () => {
    expect(PATIENT_WA_POLICY.allowOperatorDefaults).toBe(false)
  })

  it('does NOT allow time window override', () => {
    expect(PATIENT_WA_POLICY.allowTimeWindowOverride).toBe(false)
  })
})

describe('OPERATOR_TELEGRAM_POLICY', () => {
  it('has actor=operator and channel=telegram', () => {
    expect(OPERATOR_TELEGRAM_POLICY.actor).toBe('operator')
    expect(OPERATOR_TELEGRAM_POLICY.channel).toBe('telegram')
  })

  it('allows operator defaults', () => {
    expect(OPERATOR_TELEGRAM_POLICY.allowOperatorDefaults).toBe(true)
  })

  it('allows time window override', () => {
    expect(OPERATOR_TELEGRAM_POLICY.allowTimeWindowOverride).toBe(true)
  })

  it('does NOT enforce 24h advance requirement', () => {
    expect(OPERATOR_TELEGRAM_POLICY.minAdvanceHours).toBe(0)
  })

  it('does NOT enforce 48h cancellation window', () => {
    expect(OPERATOR_TELEGRAM_POLICY.minCancelHours).toBe(0)
  })
})

describe('OPERATOR_CRM_POLICY', () => {
  it('has actor=operator and channel=crm', () => {
    expect(OPERATOR_CRM_POLICY.actor).toBe('operator')
    expect(OPERATOR_CRM_POLICY.channel).toBe('crm')
  })

  it('allows operator defaults', () => {
    expect(OPERATOR_CRM_POLICY.allowOperatorDefaults).toBe(true)
  })
})

// ─── Factory ──────────────────────────────────────────────────────────────────

describe('makePolicy()', () => {
  it('returns patient/whatsapp policy', () => {
    const p = makePolicy('patient', 'whatsapp')
    expect(p.actor).toBe('patient')
    expect(p.channel).toBe('whatsapp')
    expect(p.allowOperatorDefaults).toBe(false)
  })

  it('returns operator/telegram policy', () => {
    const p = makePolicy('operator', 'telegram')
    expect(p.actor).toBe('operator')
    expect(p.channel).toBe('telegram')
    expect(p.allowOperatorDefaults).toBe(true)
  })

  it('returns operator/crm policy', () => {
    const p = makePolicy('operator', 'crm')
    expect(p.actor).toBe('operator')
    expect(p.channel).toBe('crm')
    expect(p.allowOperatorDefaults).toBe(true)
  })

  it('throws on unknown actor+channel combination', () => {
    expect(() => makePolicy('unknown', 'whatsapp')).toThrow()
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

describe('isOperator()', () => {
  it('returns true for operator/telegram', () => {
    expect(isOperator(OPERATOR_TELEGRAM_POLICY)).toBe(true)
  })

  it('returns true for operator/crm', () => {
    expect(isOperator(OPERATOR_CRM_POLICY)).toBe(true)
  })

  it('returns false for patient/whatsapp', () => {
    expect(isOperator(PATIENT_WA_POLICY)).toBe(false)
  })
})

describe('isPatient()', () => {
  it('returns true for patient/whatsapp', () => {
    expect(isPatient(PATIENT_WA_POLICY)).toBe(true)
  })

  it('returns false for operator/telegram', () => {
    expect(isPatient(OPERATOR_TELEGRAM_POLICY)).toBe(false)
  })
})

// ─── Isolation guarantee ──────────────────────────────────────────────────────

describe('mergeOperatorOverrides() — isolation guarantee', () => {
  it('returns enriched args for operator policy', () => {
    const args = { servicio_id: 'alimentario_mensual', fecha: '2026-06-01', hora: '08:00' }
    const result = mergeOperatorOverrides(OPERATOR_TELEGRAM_POLICY, args, { zona: 'sur' })
    expect(result.zona).toBe('sur')
    expect(result.servicio_id).toBe('alimentario_mensual')
  })

  it('returns original args unchanged for patient policy (no defaults applied)', () => {
    const args = { servicio_id: 'alimentario_mensual', fecha: '2026-06-01', hora: '08:00' }
    const original = { ...args }
    const result = mergeOperatorOverrides(PATIENT_WA_POLICY, args, { zona: 'sur' })
    // Patient args are NOT modified by operator defaults
    expect(result).toEqual(original)
    expect(result.zona).toBeUndefined()
  })

  it('does NOT mutate the original args object', () => {
    const args = { servicio_id: 'alimentario_mensual' }
    const frozen = Object.freeze({ ...args })
    // Should not throw even though the object is frozen (no mutation)
    expect(() => mergeOperatorOverrides(OPERATOR_TELEGRAM_POLICY, frozen, { zona: 'norte' })).not.toThrow()
  })

  it('patient args are unaffected even after operator merges run', () => {
    const patientArgs = { servicio_id: 'alimentario_mensual', fecha: '2026-06-01', hora: '09:00' }
    // Run an operator merge
    mergeOperatorOverrides(OPERATOR_TELEGRAM_POLICY, { servicio_id: 'x' }, { zona: 'domicilio', minAdvanceHours: 0 })
    // Patient args must remain strict — no leakage
    const result = mergeOperatorOverrides(PATIENT_WA_POLICY, patientArgs, { zona: 'domicilio' })
    expect(result.zona).toBeUndefined()
    expect(PATIENT_WA_POLICY.minAdvanceHours).toBe(24)
    expect(PATIENT_WA_POLICY.allowOperatorDefaults).toBe(false)
  })
})

// ─── Regression: constants are frozen (immutable) ─────────────────────────────

describe('policy constants are immutable', () => {
  it('PATIENT_WA_POLICY is frozen', () => {
    expect(Object.isFrozen(PATIENT_WA_POLICY)).toBe(true)
  })

  it('OPERATOR_TELEGRAM_POLICY is frozen', () => {
    expect(Object.isFrozen(OPERATOR_TELEGRAM_POLICY)).toBe(true)
  })

  it('mutation attempt on PATIENT_WA_POLICY is silently ignored in sloppy mode / throws in strict', () => {
    const before = PATIENT_WA_POLICY.minAdvanceHours
    try { PATIENT_WA_POLICY.minAdvanceHours = 0 } catch (_) { /* strict mode throws — that's fine */ }
    expect(PATIENT_WA_POLICY.minAdvanceHours).toBe(before)
  })
})
