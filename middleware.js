import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request) {
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
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Proteger la ruta de dashboard si no hay usuario
  if (request.nextUrl.pathname.startsWith('/dashboard') && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  // Proteger el acceso de los empleados/doctor con el PIN rápido
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const pinUnlocked = request.cookies.get('kely_pin_unlocked')
    // Si no está la cookie desbloqueada, redirigir al pin pad
    if (!pinUnlocked) {
      return NextResponse.redirect(new URL('/pin', request.url))
    }
  }

  // Si ya está logueado y desbloqueado, no mostrar login/pin
  if ((request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/pin') && user) {
    const pinUnlocked = request.cookies.get('kely_pin_unlocked')
    if (pinUnlocked) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhook).*)',
  ],
}
