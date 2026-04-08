import { createServerSupabaseClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req) {
  // Solo se ejecuta si existen las variables de entorno para evitar crashear el preview mode
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createServerSupabaseClient()
    await supabase.auth.signOut()
  }

  const cookieStore = await cookies()
  // Limpiar la cookie del PIN
  cookieStore.delete('kely_pin_unlocked')

  revalidatePath('/', 'layout')
  
  // Redirigir a login
  const requestUrl = new URL(req.url)
  return NextResponse.redirect(`${requestUrl.origin}/login`, {
    status: 302,
  })
}
