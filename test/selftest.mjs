import assert from 'node:assert/strict'

import { toggleWhitelistActivaPersisted } from '../lib/whitelist-toggle.mjs'

async function run(name, fn) {
  try {
    await fn()
    process.stdout.write(`ok - ${name}\n`)
    return true
  } catch (err) {
    process.stdout.write(`not ok - ${name}\n`)
    process.stderr.write(`${err?.stack || err}\n`)
    return false
  }
}

const results = await Promise.all([
  run('toggleWhitelistActivaPersisted llama updateFn con el valor alternado', async () => {
    const calls = []
    const updateFn = async (payload) => {
      calls.push(payload)
      return { success: true }
    }

    const res = await toggleWhitelistActivaPersisted({ currentValue: false, updateFn })

    assert.equal(res.ok, true)
    assert.equal(res.nextValue, true)
    assert.deepEqual(calls, [{ whitelist_activa: true }])
  }),

  run('toggleWhitelistActivaPersisted marca error si updateFn devuelve { error }', async () => {
    const updateFn = async () => ({ error: 'boom' })

    const res = await toggleWhitelistActivaPersisted({ currentValue: true, updateFn })

    assert.equal(res.ok, false)
    assert.equal(res.nextValue, false)
    assert.equal(res.error, 'boom')
  }),
])

if (results.some((r) => !r)) {
  process.exitCode = 1
}
