import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { findAuthorizedStaffByEmail } from '@/lib/staff-auth-server'
import {
  createCookieOperationStore,
  normalizeEmail,
} from '@/lib/staff-auth'

function jsonWithCookies(payload, { status = 200, cookieStore } = {}) {
  const response = NextResponse.json(payload, { status })
  cookieStore?.apply(response)
  return response
}

function successResponse(cookieStore) {
  return jsonWithCookies({ success: true }, { cookieStore })
}

export async function POST(request) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json(
      { error: 'server_auth_not_configured' },
      { status: 500 }
    )
  }

  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)

  if (!email) {
    return NextResponse.json(
      { error: 'invalid_magic_link_request' },
      { status: 400 }
    )
  }

  const { authorized } = await findAuthorizedStaffByEmail(email)

  if (!authorized) {
    return successResponse()
  }

  const cookieStore = createCookieOperationStore()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookieStore.record(cookiesToSet)
        },
      },
    }
  )

  await supabase.auth.signOut({ scope: 'local' })

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${request.nextUrl.origin}/auth/callback`,
      shouldCreateUser: false,
    },
  })

  if (error) {
    return successResponse(cookieStore)
  }

  return successResponse(cookieStore)
}
