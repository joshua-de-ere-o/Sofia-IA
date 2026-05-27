import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockJson = vi.fn((payload, init = {}) => {
  const cookies = new Map()

  return {
    status: init.status ?? 200,
    body: payload,
    cookies: {
      set: vi.fn((name, value, options) => {
        cookies.set(name, { name, value, options })
      }),
      delete: vi.fn((name) => {
        cookies.delete(name)
      }),
      getAll: () => Array.from(cookies.values()),
    },
  }
})

vi.mock('next/server', () => ({
  NextResponse: {
    json: mockJson,
  },
}))

const mockFindAuthorizedStaffByEmail = vi.fn()
vi.mock('@/lib/staff-auth-server', () => ({
  findAuthorizedStaffByEmail: mockFindAuthorizedStaffByEmail,
}))

vi.mock('@/lib/staff-auth', () => ({
  normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : ''
  },
  createCookieOperationStore() {
    const operations = []

    return {
      record(cookiesToSet) {
        if (Array.isArray(cookiesToSet)) {
          operations.push(...cookiesToSet)
        }
      },
      apply(response) {
        operations.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    }
  },
}))

const mockSignOut = vi.fn(async () => ({ error: null }))
const mockSignInWithOtp = vi.fn()

const mockSupabase = {
  auth: {
    signOut: mockSignOut,
    signInWithOtp: mockSignInWithOtp,
  },
}

const mockCreateServerClient = vi.fn(() => mockSupabase)
vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}))

function makeRequest(email = 'staff@example.com') {
  return {
    json: async () => ({ email }),
    cookies: {
      getAll: () => [],
    },
    nextUrl: {
      origin: 'https://crm.example.com',
    },
  }
}

describe('POST /api/auth/magic-link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  it('returns the generic success response for emails outside the allowlist', async () => {
    mockFindAuthorizedStaffByEmail.mockResolvedValue({ authorized: false })

    const { POST } = await import('../app/api/auth/magic-link/route.js?enum-unauthorized')
    const response = await POST(makeRequest('unknown@example.com'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true })
    expect(mockCreateServerClient).not.toHaveBeenCalled()
    expect(mockSignInWithOtp).not.toHaveBeenCalled()
  })

  it('returns the generic success response when Supabase rejects the OTP request', async () => {
    mockFindAuthorizedStaffByEmail.mockResolvedValue({ authorized: true })
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'User not found' } })

    const { POST } = await import('../app/api/auth/magic-link/route.js?enum-supabase-error')
    const response = await POST(makeRequest('inactive@example.com'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true })
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mockSignInWithOtp).toHaveBeenCalledOnce()
  })

  it('keeps the normal success response for authorized staff emails', async () => {
    mockFindAuthorizedStaffByEmail.mockResolvedValue({ authorized: true })
    mockSignInWithOtp.mockResolvedValue({ error: null })

    const { POST } = await import('../app/api/auth/magic-link/route.js?enum-happy-path')
    const response = await POST(makeRequest('staff@example.com'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true })
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'staff@example.com',
      options: {
        emailRedirectTo: 'https://crm.example.com/auth/callback',
        shouldCreateUser: false,
      },
    })
  })
})
