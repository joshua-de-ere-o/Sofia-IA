import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinUnlockCookieValue, PIN_UNLOCK_COOKIE_NAME } from '../lib/staff-auth.js'

function createResponse(type, targetUrl = null, init = {}) {
  const cookieJar = new Map()
  const deletedCookies = []

  return {
    type,
    url: targetUrl,
    request: init.request,
    cookies: {
      set: vi.fn((name, value, options) => {
        cookieJar.set(name, { name, value, options })
      }),
      delete: vi.fn((name) => {
        deletedCookies.push(name)
        cookieJar.delete(name)
      }),
      getAll: () => Array.from(cookieJar.values()),
    },
    deletedCookies,
  }
}

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn((init) => createResponse('next', null, init)),
    redirect: vi.fn((url) => createResponse('redirect', url.toString())),
  },
}))

const mockGetUser = vi.fn()
const mockSignOut = vi.fn(async () => ({ error: null }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  })),
}))

const mockFindAuthorizedStaffForUser = vi.fn()
vi.mock('@/lib/staff-auth-server', () => ({
  findAuthorizedStaffForUser: mockFindAuthorizedStaffForUser,
}))

function makeRequest({ pathname = '/dashboard', cookieValue, user } = {}) {
  const cookies = new Map()

  if (cookieValue !== undefined) {
    cookies.set(PIN_UNLOCK_COOKIE_NAME, { name: PIN_UNLOCK_COOKIE_NAME, value: cookieValue })
  }

  mockGetUser.mockResolvedValue({ data: { user } })
  mockFindAuthorizedStaffForUser.mockResolvedValue({ authorized: true })

  return {
    url: `https://crm.example.com${pathname}`,
    headers: new Headers(),
    nextUrl: {
      pathname,
    },
    cookies: {
      get: (name) => cookies.get(name),
      getAll: () => Array.from(cookies.values()),
    },
  }
}

describe('middleware PIN cookie verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  it('redirects forged constant PIN cookies back to /pin', async () => {
    const request = makeRequest({
      pathname: '/dashboard',
      cookieValue: 'true',
      user: { id: 'user-123', email: 'staff@example.com' },
    })

    const { middleware } = await import('../middleware.js?pin-cookie-forged')
    const response = await middleware(request)

    expect(response.type).toBe('redirect')
    expect(response.url).toBe('https://crm.example.com/pin')
    expect(response.cookies.delete).toHaveBeenCalledWith(PIN_UNLOCK_COOKIE_NAME)
  })

  it('allows dashboard access with a valid signed PIN cookie for the same user', async () => {
    const request = makeRequest({
      pathname: '/dashboard',
      cookieValue: await createPinUnlockCookieValue('user-123', { secret: 'service-role-key' }),
      user: { id: 'user-123', email: 'staff@example.com' },
    })

    const { middleware } = await import('../middleware.js?pin-cookie-valid')
    const response = await middleware(request)

    expect(response.type).toBe('next')
    expect(response.cookies.delete).not.toHaveBeenCalled()
  })

  it('does not trust a signed cookie minted for another user', async () => {
    const request = makeRequest({
      pathname: '/dashboard',
      cookieValue: await createPinUnlockCookieValue('user-999', { secret: 'service-role-key' }),
      user: { id: 'user-123', email: 'staff@example.com' },
    })

    const { middleware } = await import('../middleware.js?pin-cookie-cross-user')
    const response = await middleware(request)

    expect(response.type).toBe('redirect')
    expect(response.url).toBe('https://crm.example.com/pin')
  })
})
