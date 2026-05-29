import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { createCookieOperationStore, PIN_UNLOCK_COOKIE_NAME } from '@/lib/staff-auth'
import { findAuthorizedStaffForUser } from '@/lib/staff-auth-server'

// Valida que next sea una ruta interna segura (evita open-redirect)
function safeNext(raw) {
  if (!raw || typeof raw !== 'string') return '/dashboard'
  if (!raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//')) return '/dashboard'
  return raw
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next'))

  // Sin credenciales válidas en la URL no hay nada que validar
  if (!code && !(tokenHash && type)) {
    return NextResponse.redirect(`${origin}/login?error=missing_auth_params`)
  }

  // Crear la respuesta de redirección primero para poder adjuntarle las cookies de sesión
  const cookieStore = createCookieOperationStore()
  let response = NextResponse.redirect(`${origin}${next}`)

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

  // token_hash (verifyOtp) funciona abriendo el enlace desde CUALQUIER navegador o
  // webview (Gmail, Outlook), porque no depende del code_verifier de PKCE que vive
  // en el navegador original. code (exchangeCodeForSession) se mantiene como
  // respaldo para enlaces ya emitidos con el flujo anterior.
  const { error } =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  const { authorized } = await findAuthorizedStaffForUser(supabase, user)

  if (!authorized) {
    response = NextResponse.redirect(`${origin}/login?error=staff_not_authorized`)
    await supabase.auth.signOut()
    response.cookies.delete(PIN_UNLOCK_COOKIE_NAME)
    cookieStore.apply(response)
    return response
  }

  // Limpiar cookie del PIN para que el nuevo usuario valide su propio PIN
  // (importante si cambió de usuario: Joshua ↔ Dra. Kely en el mismo navegador)
  response.cookies.delete(PIN_UNLOCK_COOKIE_NAME)
  cookieStore.apply(response)
  return response
}
