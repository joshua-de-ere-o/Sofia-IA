/**
 * test/system-prompt.test.mjs
 *
 * Sanity checks for SYSTEM_PROMPT in config.ts.
 * Since config.ts is Deno TS, we read and parse it as text — no import.
 *
 * These tests verify:
 *   - New service IDs are present
 *   - Old standalone IDs (quincenal/mensual/premium) no longer appear unqualified
 *   - Key functional keywords are present
 *
 * RED: will fail until SYSTEM_PROMPT is updated in config.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../supabase/functions/agent-runner/config.ts')
const content = readFileSync(CONFIG_PATH, 'utf-8')

// Extract the SYSTEM_PROMPT value (everything between the backtick template literal)
const match = content.match(/export const SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/)
const prompt = match ? match[1] : ''

describe('SYSTEM_PROMPT — required new content', () => {
  it('contains alimentario_mensual ID', () => {
    expect(prompt).toContain('alimentario_mensual')
  })

  it('contains deportivo_mensual ID', () => {
    expect(prompt).toContain('deportivo_mensual')
  })

  it('contains masaje ID', () => {
    expect(prompt).toContain('masaje')
  })

  it('contains reduccion_medidas ID', () => {
    expect(prompt).toContain('reduccion_medidas')
  })

  it('references derivar_a_kelly tool', () => {
    expect(prompt).toContain('derivar_a_kelly')
  })

  it('references mensaje_paciente', () => {
    expect(prompt).toContain('mensaje_paciente')
  })

  it('contains section REGLAS DE DERIVACIÓN', () => {
    expect(prompt).toContain('REGLAS DE DERIVACIÓN')
  })

  it('contains CATÁLOGO DE SERVICIOS section', () => {
    expect(prompt).toContain('CATÁLOGO DE SERVICIOS')
  })
})

describe('SYSTEM_PROMPT — old IDs must not appear standalone', () => {
  /**
   * "quincenal" is valid only as part of alimentario_quincenal or deportivo_quincenal.
   * A standalone word-boundary match means it's being used as a bare plan name.
   */
  it('quincenal only appears qualified (alimentario_quincenal or deportivo_quincenal)', () => {
    // Find all occurrences of "quincenal" not preceded by alimentario_ or deportivo_
    const standalone = prompt.match(/(?<!alimentario_|deportivo_)quincenal/g)
    expect(standalone, 'Found standalone "quincenal" — must be qualified').toBeNull()
  })

  it('does not contain bare "Plan Quincenal" label', () => {
    // The old label "Plan Quincenal" (without alimentario/deportivo qualifier) must be gone
    expect(prompt).not.toMatch(/Plan Quincenal(?!\s+(Alimentario|Deportivo))/i)
  })

  it('does not contain "Plan Premium" label (renamed to alimentario_exclusivo)', () => {
    expect(prompt).not.toContain('Plan Premium')
  })

  it('does not contain standalone "mensual" as old ID (bare, unqualified)', () => {
    // "mensual" is fine when part of alimentario_mensual / deportivo_mensual
    // but the old catalog just said "mensual" as a plan id — check it's gone from plan listings
    // We look for `mensual` NOT preceded by alimentario_ or deportivo_
    const matches = [...prompt.matchAll(/(?<!alimentario_|deportivo_)(?<!\w)mensual(?!\w)/g)]
    // Allow zero matches
    expect(matches.length).toBe(0)
  })
})

describe('SYSTEM_PROMPT — REGLA DE ORO and zones still present', () => {
  it('contains REGLA DE ORO', () => {
    expect(prompt).toContain('REGLA DE ORO')
  })

  it('mentions the 5 valid zones', () => {
    expect(prompt).toContain('sur')
    expect(prompt).toContain('norte')
    expect(prompt).toContain('valle')
    expect(prompt).toContain('virtual')
    expect(prompt).toContain('domicilio')
  })

  it('shows the reminders option in the new-patient menu', () => {
    expect(prompt).toContain('4️⃣ Actualizar datos para recordatorios')
  })
})

describe('SYSTEM_PROMPT — recordatorios linking contract', () => {
  it('asks first for name and appointment date, not birth date as an initial gate', () => {
    expect(prompt).toContain('Pedirle al paciente los 2 datos obligatorios')
    expect(prompt).toContain('Nombre completo')
    expect(prompt).toContain('Fecha de su próxima cita con la Dra. Kely')
    expect(prompt).not.toContain('Fecha de nacimiento (formato DD/MM/AAAA)')
  })

  it('asks appointment time only when name plus date remains ambiguous', () => {
    expect(prompt).toContain('needs_time_tiebreaker')
    expect(prompt).toContain('hora de la cita')
  })

  it('supports rescue when the date is wrong or forgotten', () => {
    expect(prompt).toContain('needs_context_rescue')
    expect(prompt).toContain('cita cercana')
    expect(prompt).toContain('recordatorios solo están activos para pacientes que YA tienen una cita agendada')
  })

  it('does not require fecha_cita in verificar_datos_paciente schema', () => {
    expect(content).toContain('hora_cita')
    expect(content).toContain('required: ["nombre_completo", "from_number"]')
  })
})
