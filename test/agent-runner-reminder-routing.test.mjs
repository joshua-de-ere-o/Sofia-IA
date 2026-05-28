import { describe, it, expect } from 'vitest'

import { matchesReminderKeyword } from '../supabase/functions/agent-runner/reminder-routing.ts'

describe('matchesReminderKeyword', () => {
  it('matches singular reminder keyword', () => {
    expect(matchesReminderKeyword('recordatorio')).toBe(true)
  })

  it('matches plural reminder keyword', () => {
    expect(matchesReminderKeyword('Necesito recordatorios por favor')).toBe(true)
  })

  it('does not match normal booking text', () => {
    expect(matchesReminderKeyword('Hola, quiero agendar una cita')).toBe(false)
  })
})
