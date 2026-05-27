import { NextResponse } from 'next/server'

import { findAuthorizedStaffByEmail } from '@/lib/staff-auth-server'
import { normalizeEmail } from '@/lib/staff-auth'

function successResponse({ shouldSendMagicLink = false } = {}) {
  return NextResponse.json({ success: true, shouldSendMagicLink })
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

  return successResponse({ shouldSendMagicLink: authorized })
}
