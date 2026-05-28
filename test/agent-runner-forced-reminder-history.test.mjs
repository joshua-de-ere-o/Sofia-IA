import { describe, expect, it } from 'vitest'

import { appendForcedReminderHistory } from '../supabase/functions/agent-runner/forced-reminder-history.ts'
import { buildGeminiRequestBody } from '../supabase/functions/agent-runner/provider-payloads.ts'

describe('appendForcedReminderHistory', () => {
  it('keeps Gemini forced reminder routing out of functionCall history', () => {
    const history = [
      { role: 'user', content: '[MENSAJE DEL USUARIO]:\nrecordatorios' },
    ]

    appendForcedReminderHistory({
      provider: 'gemini',
      history,
      toolName: 'iniciar_actualizacion_datos',
      toolInput: { trigger: 'regex_keyword' },
      toolResult: '{"ok":true,"step":"ask_birthdate"}',
      syntheticId: 'forced_1',
    })

    expect(history).toHaveLength(2)
    expect(history[1].role).toBe('user')
    expect(history[1].content).toContain('iniciar_actualizacion_datos')
    expect(history[1].content).toContain('ask_birthdate')

    const body = buildGeminiRequestBody({
      systemPrompt: 'You are Sofía',
      messages: history,
      tools: [],
      maxTokens: 300,
    })

    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: '[MENSAJE DEL USUARIO]:\nrecordatorios' }] },
      { role: 'user', parts: [{ text: history[1].content }] },
    ])
    expect(JSON.stringify(body.contents)).not.toContain('functionCall')
    expect(JSON.stringify(body.contents)).not.toContain('functionResponse')
  })

  it('preserves non-Gemini synthetic tool history unchanged', () => {
    const history = [
      { role: 'user', content: '[MENSAJE DEL USUARIO]:\nrecordatorios' },
    ]

    appendForcedReminderHistory({
      provider: 'openai',
      history,
      toolName: 'iniciar_actualizacion_datos',
      toolInput: { trigger: 'regex_keyword' },
      toolResult: '{"ok":true}',
      syntheticId: 'forced_1',
    })

    expect(history).toEqual([
      { role: 'user', content: '[MENSAJE DEL USUARIO]:\nrecordatorios' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'forced_1',
          name: 'iniciar_actualizacion_datos',
          input: { trigger: 'regex_keyword' },
        }],
      },
      {
        role: 'tool',
        name: 'iniciar_actualizacion_datos',
        tool_call_id: 'forced_1',
        tool_use_id: 'forced_1',
        content: '{"ok":true}',
      },
    ])
  })

  it('leaves normal Gemini booking text behavior untouched', () => {
    const body = buildGeminiRequestBody({
      systemPrompt: 'You are Sofía',
      messages: [{ role: 'user', content: 'Hola, quiero agendar una cita' }],
      tools: [],
      maxTokens: 300,
    })

    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hola, quiero agendar una cita' }] },
    ])
  })
})
