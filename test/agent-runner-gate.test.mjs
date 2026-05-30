/**
 * test/agent-runner-gate.test.mjs
 *
 * Unit tests para decideAgentResponse — el gate puro que decide si Sofía
 * responde, dado el switch global y el modo per-conversación.
 */

import { describe, it, expect } from 'vitest'
import { decideAgentResponse } from '../supabase/functions/agent-runner/agent-gate.ts'

const NOW = new Date('2026-05-30T12:00:00Z')

describe('decideAgentResponse', () => {
  it('responde en el caso default (auto)', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'auto', now: NOW })
    expect(d.respond).toBe(true)
    expect(d.reason).toBe('auto')
  })

  it('responde cuando no hay flag global (columna inexistente pre-migración)', () => {
    expect(decideAgentResponse({ agenteActivoGlobal: undefined, mode: null, now: NOW }).respond).toBe(true)
    expect(decideAgentResponse({ agenteActivoGlobal: null, mode: 'auto', now: NOW }).respond).toBe(true)
  })

  it('NO responde si el switch global está apagado', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: false, mode: 'auto', now: NOW })
    expect(d.respond).toBe(false)
    expect(d.reason).toBe('paused_global')
  })

  it('global apagado tiene prioridad incluso sobre modo manual', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: false, mode: 'manual', manualUntil: null, now: NOW })
    expect(d.respond).toBe(false)
    expect(d.reason).toBe('paused_global')
  })

  it('NO responde en modo manual vigente (sin manual_until)', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'manual', manualUntil: null, now: NOW })
    expect(d.respond).toBe(false)
    expect(d.reason).toBe('paused_manual')
  })

  it('NO responde en modo manual con manual_until en el futuro', () => {
    const future = new Date('2026-05-30T18:00:00Z').toISOString()
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'manual', manualUntil: future, now: NOW })
    expect(d.respond).toBe(false)
    expect(d.reason).toBe('paused_manual')
  })

  it('SÍ responde si el modo manual ya expiró', () => {
    const past = new Date('2026-05-30T06:00:00Z').toISOString()
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'manual', manualUntil: past, now: NOW })
    expect(d.respond).toBe(true)
    expect(d.reason).toBe('manual_expired')
  })

  it('en el borde exacto (manual_until === ahora) se considera expirado → responde', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'manual', manualUntil: NOW.toISOString(), now: NOW })
    expect(d.respond).toBe(true)
    expect(d.reason).toBe('manual_expired')
  })

  it('NO responde en modo personal (defensivo)', () => {
    const d = decideAgentResponse({ agenteActivoGlobal: true, mode: 'personal', now: NOW })
    expect(d.respond).toBe(false)
    expect(d.reason).toBe('paused_personal')
  })
})
