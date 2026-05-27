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
}))

function makeRequest(email = 'staff@example.com') {
  return {
    json: async () => ({ email }),
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
    expect(response.body).toEqual({ success: true, shouldSendMagicLink: false })
  })

  it('marks allowlisted emails to send the magic link in the browser', async () => {
    mockFindAuthorizedStaffByEmail.mockResolvedValue({ authorized: true })

    const { POST } = await import('../app/api/auth/magic-link/route.js?browser-pkce')
    const response = await POST(makeRequest('staff@example.com'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, shouldSendMagicLink: true })
  })
})
