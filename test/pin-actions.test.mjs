import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCookiesSet = vi.fn()
const mockCookies = vi.fn(async () => ({
  set: mockCookiesSet,
}))

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}))

const mockFindAuthorizedStaffForUser = vi.fn()
vi.mock('@/lib/staff-auth-server', () => ({
  findAuthorizedStaffForUser: mockFindAuthorizedStaffForUser,
}))

const mockGenSalt = vi.fn(async () => 'salt')
const mockHash = vi.fn(async (value) => `hashed:${value}`)
const mockCompare = vi.fn()

vi.mock('bcryptjs', () => ({
  default: {
    genSalt: mockGenSalt,
    hash: mockHash,
    compare: mockCompare,
  },
}))

let mockSupabase
const mockCreateServerSupabaseClient = vi.fn(async () => mockSupabase)

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}))

function createSupabase({ user = { id: 'user-123', email: 'staff@example.com' }, settings } = {}) {
  const selectSingle = vi.fn(async () => ({ data: settings, error: null }))
  const selectEq = vi.fn(() => ({ single: selectSingle }))
  const select = vi.fn(() => ({ eq: selectEq }))

  const updateEq = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq: updateEq }))

  const upsert = vi.fn(async () => ({ error: null }))

  const from = vi.fn((table) => {
    if (table !== 'user_settings') {
      throw new Error(`Unexpected table: ${table}`)
    }

    return {
      select,
      update,
      upsert,
    }
  })

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from,
    __mocks: {
      upsert,
      update,
      updateEq,
      select,
      selectEq,
      selectSingle,
    },
  }
}

describe('PIN server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KELY_PIN_COOKIE_SECRET = 'pin-secret'
    mockFindAuthorizedStaffForUser.mockResolvedValue({ authorized: true })
  })

  it('rejects PIN setup when the value is not exactly 4 digits', async () => {
    mockSupabase = createSupabase({ settings: null })

    const { setupPin } = await import('../app/pin/actions.js?setup-pin-format')
    const result = await setupPin('12a4')

    expect(result).toEqual({ error: 'El PIN debe ser de 4 dígitos' })
    expect(mockSupabase.__mocks.upsert).not.toHaveBeenCalled()
    expect(mockCookiesSet).not.toHaveBeenCalled()
  })

  it('locks the session on the 3rd failed PIN attempt', async () => {
    mockCompare.mockResolvedValue(false)
    mockSupabase = createSupabase({
      settings: {
        pin_hash: 'hashed:1234',
        pin_intentos_fallidos: 2,
      },
    })

    const { verifyPin } = await import('../app/pin/actions.js?verify-pin-lockout')
    const result = await verifyPin('9999')

    expect(result).toEqual({ error: 'Demasiados intentos. Tu sesión se ha cerrado.', locked: true })
    expect(mockSupabase.__mocks.update).toHaveBeenCalledWith({ pin_intentos_fallidos: 3 })
    expect(mockSupabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('rejects non-digit PIN verification before consuming an attempt', async () => {
    mockSupabase = createSupabase({
      settings: {
        pin_hash: 'hashed:1234',
        pin_intentos_fallidos: 1,
      },
    })

    const { verifyPin } = await import('../app/pin/actions.js?verify-pin-format')
    const result = await verifyPin('ab12')

    expect(result).toEqual({ error: 'El PIN debe ser de 4 dígitos' })
    expect(mockCompare).not.toHaveBeenCalled()
    expect(mockSupabase.__mocks.update).not.toHaveBeenCalled()
    expect(mockSupabase.auth.signOut).not.toHaveBeenCalled()
  })
})
