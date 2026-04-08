import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // Si enviamos a la ruta next (despues de autenticarse magic link)
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }

    // Manejo de error descriptivo (se conserva)
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Redirigir de regreso al login en caso de error
  return NextResponse.redirect(`${origin}/login?error=missing_auth_params`)
}
