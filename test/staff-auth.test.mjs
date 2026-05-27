import { describe, it, expect } from 'vitest'

import {
  STAFF_ROLES,
  createPinUnlockCookieValue,
  createCookieOperationStore,
  getAuthErrorMessage,
  getPinCookieOptions,
  getPinCookieSecret,
  isPinUnlockCookieValid,
  isAuthorizedStaffRecord,
  normalizeEmail,
} from '../lib/staff-auth.js'

describe('normalizeEmail', () => {
  it('trims and lowercases a valid email', () => {
    expect(normalizeEmail('  Dra.Kely@Example.COM  ')).toBe('dra.kely@example.com')
  })

  it('returns an empty string for invalid values', () => {
    expect(normalizeEmail('')).toBe('')
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail('correo-invalido')).toBe('')
  })
})

describe('isAuthorizedStaffRecord', () => {
  it('accepts active doctor and admin roles', () => {
    expect(isAuthorizedStaffRecord({ email: 'doctor@example.com', role: 'doctor', is_active: true })).toBe(true)
    expect(isAuthorizedStaffRecord({ email: 'admin@example.com', role: 'admin', is_active: true })).toBe(true)
  })

  it('rejects inactive or unsupported staff rows', () => {
    expect(isAuthorizedStaffRecord({ email: 'doctor@example.com', role: 'doctor', is_active: false })).toBe(false)
    expect(isAuthorizedStaffRecord({ email: 'other@example.com', role: 'assistant', is_active: true })).toBe(false)
    expect(isAuthorizedStaffRecord(null)).toBe(false)
  })
})

describe('getPinCookieOptions', () => {
  it('enables secure cookies in production mode', () => {
    expect(getPinCookieOptions({ isProduction: true })).toEqual({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 86400 * 30,
    })
  })

  it('disables the secure flag outside production', () => {
    expect(getPinCookieOptions({ isProduction: false }).secure).toBe(false)
  })
})

describe('PIN unlock cookie signing', () => {
  it('creates a signed cookie bound to the authenticated user', async () => {
    const value = await createPinUnlockCookieValue('user-123', { secret: 'pin-secret' })

    expect(value).toMatch(/^v1\.user-123\./)
    await expect(isPinUnlockCookieValid(value, 'user-123', { secret: 'pin-secret' })).resolves.toBe(true)
  })

  it('rejects forged, tampered, or cross-user cookie values', async () => {
    const value = await createPinUnlockCookieValue('user-123', { secret: 'pin-secret' })

    await expect(isPinUnlockCookieValid('true', 'user-123', { secret: 'pin-secret' })).resolves.toBe(false)
    await expect(isPinUnlockCookieValid(`${value}-tampered`, 'user-123', { secret: 'pin-secret' })).resolves.toBe(false)
    await expect(isPinUnlockCookieValid(value, 'user-456', { secret: 'pin-secret' })).resolves.toBe(false)
  })

  it('prefers a dedicated env secret and falls back to the service role key', () => {
    expect(getPinCookieSecret({ KELY_PIN_COOKIE_SECRET: 'dedicated', SUPABASE_SERVICE_ROLE_KEY: 'service-role' })).toBe('dedicated')
    expect(getPinCookieSecret({ SUPABASE_SERVICE_ROLE_KEY: 'service-role' })).toBe('service-role')
    expect(getPinCookieSecret({})).toBe('')
  })
})

describe('getAuthErrorMessage', () => {
  it('maps known auth errors to Spanish UI copy', () => {
    expect(getAuthErrorMessage('staff_not_authorized')).toBe('Este correo no está autorizado para ingresar al CRM.')
    expect(getAuthErrorMessage('auth_callback_failed')).toBe('No se pudo validar el enlace mágico. Pedí uno nuevo e inténtalo otra vez.')
  })

  it('falls back to null for unknown codes', () => {
    expect(getAuthErrorMessage('something_else')).toBeNull()
    expect(getAuthErrorMessage(null)).toBeNull()
  })
})

describe('STAFF_ROLES', () => {
  it('only exposes the approved staff roles', () => {
    expect(STAFF_ROLES).toEqual(['doctor', 'admin'])
  })
})

describe('createCookieOperationStore', () => {
  it('preserves the latest full cookie options for redirects', () => {
    const store = createCookieOperationStore()

    store.record([
      { name: 'sb-access-token', value: 'first', options: { httpOnly: true, path: '/', sameSite: 'lax' } },
      { name: 'sb-refresh-token', value: 'refresh', options: { httpOnly: true, path: '/', secure: true } },
    ])
    store.record([
      { name: 'sb-access-token', value: 'second', options: { httpOnly: true, path: '/', secure: true, sameSite: 'lax' } },
    ])

    expect(store.getAll()).toEqual([
      { name: 'sb-access-token', value: 'second', options: { httpOnly: true, path: '/', secure: true, sameSite: 'lax' } },
      { name: 'sb-refresh-token', value: 'refresh', options: { httpOnly: true, path: '/', secure: true } },
    ])
  })

  it('ignores empty cookie batches', () => {
    const store = createCookieOperationStore()

    store.record([])
    store.record(null)

    expect(store.getAll()).toEqual([])
  })
})
