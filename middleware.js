import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { createCookieOperationStore, isPinUnlockCookieValid, PIN_UNLOCK_COOKIE_NAME } from '@/lib/staff-auth'
import { findAuthorizedStaffForUser } from '@/lib/staff-auth-server'

export async function middleware(request) {
  const cookieStore = createCookieOperationStore()
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Evitar romper el entorno si las variables no están listadas
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response
  }

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
          response = NextResponse.next({
            request,
          })
          cookieStore.apply(response)
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Helper: crear redirect que preserva las cookies de sesión actualizadas por getUser()
  function redirectWithCookies(url) {
    const redirectResponse = NextResponse.redirect(url)
    cookieStore.apply(redirectResponse)
    return redirectResponse
  }

  async function redirectUnauthorizedStaff() {
    const redirectResponse = NextResponse.redirect(new URL('/login?error=staff_not_authorized', request.url))
    await supabase.auth.signOut()
    cookieStore.apply(redirectResponse)
    redirectResponse.cookies.delete(PIN_UNLOCK_COOKIE_NAME)
    return redirectResponse
  }

  if (user) {
    const { authorized } = await findAuthorizedStaffForUser(supabase, user)

    if (!authorized) {
      return redirectUnauthorizedStaff()
    }
  }

  // Proteger la ruta de dashboard si no hay usuario
  if (request.nextUrl.pathname.startsWith('/dashboard') && !user) {
    return redirectWithCookies(new URL('/login', request.url))
  }

  const pinUnlockedCookie = request.cookies.get(PIN_UNLOCK_COOKIE_NAME)?.value
  const hasValidPinUnlock = user ? await isPinUnlockCookieValid(pinUnlockedCookie, user.id) : false

  // Proteger el acceso de los empleados/doctor con el PIN rápido
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    // Si no está la cookie desbloqueada válida, redirigir al pin pad
    if (!hasValidPinUnlock) {
      const redirectResponse = redirectWithCookies(new URL('/pin', request.url))

      if (pinUnlockedCookie) {
        redirectResponse.cookies.delete(PIN_UNLOCK_COOKIE_NAME)
      }

      return redirectResponse
    }
  }

  // Si ya está logueado y desbloqueado, no mostrar login/pin
  if ((request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/pin') && user) {
    if (hasValidPinUnlock) {
      return redirectWithCookies(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhook|auth/callback).*)',
  ],
}
