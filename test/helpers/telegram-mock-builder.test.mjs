/**
 * test/helpers/telegram-mock-builder.test.mjs
 *
 * T-0 smoke tests for the telegram-mock-builder harness extensions:
 *   - setAdapterResponses(queue): multi-turn response queue
 *   - Column allow-list assertion for known tables
 *
 * H-4: queue dequeues in order, throws on underflow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resetTelegramState,
  teardownTelegramMocks,
  setAdapterResponse,
  setAdapterResponses,
  mockAdapterResponse,
  makeBuilder,
} from './telegram-mock-builder.mjs'

beforeEach(() => resetTelegramState())
afterEach(() => teardownTelegramMocks())

// ─── setAdapterResponses queue ────────────────────────────────────────────────

describe('setAdapterResponses — multi-turn response queue', () => {
  it('dequeues responses in FIFO order across chat() calls', async () => {
    const r1 = { tool: 'responder_texto', args: { texto: 'first' } }
    const r2 = { tool: 'responder_texto', args: { texto: 'second' } }
    const r3 = { tool: 'responder_texto', args: { texto: 'third' } }

    setAdapterResponses([r1, r2, r3])

    // Import the internal adapter mock to simulate calling chat() directly
    // We test via the exported mockAdapterResponse after each dequeue
    // The mock's chat() fn reads from the queue — call it via the module internals
    // Access by re-importing the mock after setup
    const { getModelAdapter } = await import('@/lib/model-adapter')
    const adapter = await getModelAdapter()

    const res1 = await adapter.chat()
    const res2 = await adapter.chat()
    const res3 = await adapter.chat()

    expect(res1).toBe(JSON.stringify(r1))
    expect(res2).toBe(JSON.stringify(r2))
    expect(res3).toBe(JSON.stringify(r3))
  })

  it('throws on underflow when queue is exhausted', async () => {
    setAdapterResponses([{ tool: 'responder_texto', args: { texto: 'only one' } }])

    const { getModelAdapter } = await import('@/lib/model-adapter')
    const adapter = await getModelAdapter()

    await adapter.chat() // consume the only item
    await expect(adapter.chat()).rejects.toThrow(/queue.*empty|underflow|no more/i)
  })

  it('setAdapterResponse (singular) backward-compat: still works after setAdapterResponses exists', async () => {
    setAdapterResponse({ tool: 'responder_texto', args: { texto: 'backward-compat' } })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    const adapter = await getModelAdapter()
    const res = await adapter.chat()
    expect(res).toBe(JSON.stringify({ tool: 'responder_texto', args: { texto: 'backward-compat' } }))
  })

  it('single setAdapterResponse does not exhaust (returns same value on repeated calls)', async () => {
    setAdapterResponse({ tool: 'responder_texto', args: { texto: 'static' } })

    const { getModelAdapter } = await import('@/lib/model-adapter')
    const adapter = await getModelAdapter()

    const r1 = await adapter.chat()
    const r2 = await adapter.chat()
    expect(r1).toBe(r2) // same static value each time
  })
})

// ─── Column allow-list for citas table ───────────────────────────────────────

describe('makeBuilder column allow-list — citas table', () => {
  it('does NOT throw for known citas columns in .select()', () => {
    // Known columns should be accepted without error
    expect(() => {
      const b = makeBuilder('citas', [])
      b.select('id, fecha, hora, zona, estado, duracion_min, patient_name_normalized, pacientes(nombre)')
    }).not.toThrow()
  })

  it('throws for unknown column in .eq() on citas table', () => {
    expect(() => {
      const b = makeBuilder('citas', [])
      b.eq('paciente_nombre', 'Test') // phantom column — was a prod bug
    }).toThrow(/unknown column.*paciente_nombre|citas.*paciente_nombre/i)
  })

  it('throws for unknown column in .gte() on citas table', () => {
    expect(() => {
      const b = makeBuilder('citas', [])
      b.gte('bad_column', '07:00')
    }).toThrow(/unknown column.*bad_column|citas.*bad_column/i)
  })

  it('throws for unknown column in .lte() on citas table', () => {
    expect(() => {
      const b = makeBuilder('citas', [])
      b.lte('bad_column', '09:00')
    }).toThrow(/unknown column.*bad_column|citas.*bad_column/i)
  })

  it('does NOT throw for hora column in .gte()/.lte() — needed for PR1', () => {
    expect(() => {
      const b = makeBuilder('citas', [])
      b.gte('hora', '07:00').lte('hora', '09:00')
    }).not.toThrow()
  })

  it('does NOT enforce allow-list for other tables (no regression)', () => {
    expect(() => {
      const b = makeBuilder('pending_kelly_actions', [])
      b.eq('completely_unknown_col', 'val') // no validation for this table
    }).not.toThrow()
  })
})
