import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // Si enviamos a la ruta next (despues de autenticarse magic link)
  const next = searchParams.get('next') ?? '/dashboard'

  // Crear la respuesta de redirección primero para poder adjuntarle las cookies de sesión
  const response = NextResponse.redirect(`${origin}${next}`)

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return response
    }

    // Manejo de error descriptivo
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Redirigir de regreso al login en caso de error
  return NextResponse.redirect(`${origin}/login?error=missing_auth_params`)
}
