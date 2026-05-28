import { describe, it, expect } from 'vitest'

import { sanitizeSchemaForGemini } from '../supabase/functions/agent-runner/gemini-schema.ts'
import { buildGeminiRequestBody, buildProviderToolPayload } from '../supabase/functions/agent-runner/provider-payloads.ts'

describe('sanitizeSchemaForGemini', () => {
  it('removes nullable union type arrays recursively for Gemini payloads', () => {
    const schema = {
      type: 'object',
      properties: {
        paciente_id: {
          type: ['string', 'null'],
          description: 'UUID del paciente',
        },
        nested: {
          type: 'object',
          properties: {
            existing_telefono: {
              type: ['string', 'null'],
              description: 'Teléfono actual',
            },
          },
          required: ['existing_telefono'],
        },
      },
      required: ['nested'],
    }

    const sanitized = sanitizeSchemaForGemini(schema)

    expect(sanitized.properties.paciente_id.type).toBe('string')
    expect(sanitized.properties.nested.properties.existing_telefono.type).toBe('string')
    expect(sanitized.properties.nested.required).toEqual(['existing_telefono'])
    expect(sanitized.required).toEqual(['nested'])
  })

  it('returns a deep-cloned schema without mutating the original input', () => {
    const schema = {
      type: 'object',
      properties: {
        paciente_id: {
          type: ['string', 'null'],
          description: 'UUID del paciente',
        },
      },
      required: [],
    }
    const before = structuredClone(schema)

    const sanitized = sanitizeSchemaForGemini(schema)

    expect(schema).toEqual(before)
    expect(sanitized).not.toBe(schema)
    expect(sanitized.properties).not.toBe(schema.properties)
    expect(sanitized.properties.paciente_id.type).toBe('string')
    expect(schema.properties.paciente_id.type).toEqual(['string', 'null'])
  })
})

describe('provider request preparation', () => {
  it('keeps non-Gemini provider tool schemas unchanged', () => {
    const tools = [{
      name: 'iniciar_actualizacion_datos',
      description: 'Starts patient data update flow',
      input_schema: {
        type: 'object',
        properties: {
          paciente_id: {
            type: ['string', 'null'],
            description: 'UUID del paciente',
          },
        },
        required: [],
      },
    }]

    const openaiTools = buildProviderToolPayload('openai', tools)
    const anthropicTools = buildProviderToolPayload('anthropic', tools)

    expect(openaiTools[0].function.parameters).toBe(tools[0].input_schema)
    expect(openaiTools[0].function.parameters.properties.paciente_id.type).toEqual(['string', 'null'])
    expect(anthropicTools).toBe(tools)
    expect(anthropicTools[0].input_schema.properties.paciente_id.type).toEqual(['string', 'null'])
  })

  it('builds a Gemini request for normal scheduling text without nullable type arrays', () => {
    const tools = [{
      name: 'iniciar_actualizacion_datos',
      description: 'Starts patient data update flow',
      input_schema: {
        type: 'object',
        properties: {
          paciente_id: {
            type: ['string', 'null'],
            description: 'UUID del paciente',
          },
          nested: {
            type: 'object',
            properties: {
              existing_telefono: {
                type: ['string', 'null'],
                description: 'Telefono actual',
              },
            },
            required: ['existing_telefono'],
          },
        },
        required: ['nested'],
      },
    }]

    const body = buildGeminiRequestBody({
      systemPrompt: 'You are Sofía',
      messages: [{ role: 'user', content: 'Hola, quiero agendar una cita' }],
      tools,
      maxTokens: 300,
    })

    expect(body.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Hola, quiero agendar una cita' }],
    })
    expect(body.tools[0].functionDeclarations[0].parameters.properties.paciente_id.type).toBe('string')
    expect(body.tools[0].functionDeclarations[0].parameters.properties.nested.properties.existing_telefono.type).toBe('string')
    expect(body.tools[0].functionDeclarations[0].parameters.required).toEqual(['nested'])
  })
})
