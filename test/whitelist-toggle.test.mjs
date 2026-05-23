import { describe, it, expect } from 'vitest'

import { toggleWhitelistActivaPersisted } from '../lib/whitelist-toggle.mjs'

describe('toggleWhitelistActivaPersisted', () => {
  it('calls updateFn with the toggled value and returns ok', async () => {
    const calls = []
    const updateFn = async (payload) => {
      calls.push(payload)
      return { success: true }
    }

    const res = await toggleWhitelistActivaPersisted({ currentValue: false, updateFn })

    expect(res.ok).toBe(true)
    expect(res.nextValue).toBe(true)
    expect(calls).toEqual([{ whitelist_activa: true }])
  })

  it('marks error when updateFn returns { error }', async () => {
    const updateFn = async () => ({ error: 'boom' })

    const res = await toggleWhitelistActivaPersisted({ currentValue: true, updateFn })

    expect(res.ok).toBe(false)
    expect(res.nextValue).toBe(false)
    expect(res.error).toBe('boom')
  })
})
