import { createServerSupabaseClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { PIN_UNLOCK_COOKIE_NAME } from '@/lib/staff-auth'

export async function POST() {
  // Solo se ejecuta si existen las variables de entorno para evitar crashear el preview mode
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createServerSupabaseClient()
    await supabase.auth.signOut()
  }

  const cookieStore = await cookies()
  // Limpiar la cookie del PIN
  cookieStore.delete(PIN_UNLOCK_COOKIE_NAME)

  revalidatePath('/', 'layout')

  // redirect() de next/navigation preserva las mutaciones de cookies (signOut + delete)
  redirect('/login')
}
