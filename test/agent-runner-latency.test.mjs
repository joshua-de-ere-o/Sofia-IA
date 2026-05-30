import { describe, it, expect } from 'vitest'

import { createLatencyTracker, getHotspotReport, getToolLatencyLabel } from '../supabase/functions/agent-runner/latency.ts'

describe('agent-runner latency helpers', () => {
  it('reports the slowest stage and stable tool labels', () => {
    const tracker = createLatencyTracker({ correlationId: 'txt_123', senderNumber: '+593999000111' }, () => {})

    tracker.record('preflight', 42, { ok: true })
    tracker.record(getToolLatencyLabel('consultar_disponibilidad'), 128, { ok: true })
    tracker.record('llm_iteration_1', 73, { ok: true })

    expect(getToolLatencyLabel('consultar_disponibilidad')).toBe('tool:consultar_disponibilidad')
    expect(getHotspotReport(tracker.entries)).toMatchObject({
      slowest_stage: 'tool:consultar_disponibilidad',
      slowest_duration_ms: 128,
      total_duration_ms: 243,
    })
  })
})
