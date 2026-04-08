import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  
  // Si enviamos a la ruta next (despues de autenticarse magic link)
  const next = searchParams.get('next') ?? '/dashboard'
  const supabase = await createServerSupabaseClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }

    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Compatibilidad con enlaces de confirmacion que llegan con token_hash/type
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }

    return NextResponse.redirect(`${origin}/login?error=auth_verify_failed`)
  }

  // Redirigir de regreso al login en caso de error
  return NextResponse.redirect(`${origin}/login?error=missing_auth_params`)
}
