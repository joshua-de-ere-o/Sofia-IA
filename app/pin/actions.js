'use server'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

export async function hasPinSetup() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'No autorizado', setup: false }

  const { data, error } = await supabase
    .from('user_settings')
    .select('pin_hash')
    .eq('id', user.id)
    .single()

  if (error || !data?.pin_hash) {
    return { setup: false, userId: user.id }
  }

  return { setup: true, userId: user.id }
}

export async function setupPin(pin) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'No autorizado' }
  if (pin.length !== 4) return { error: 'El PIN debe ser de 4 dígitos' }

  const salt = await bcrypt.genSalt(10)
  const pin_hash = await bcrypt.hash(pin, salt)

  const { error } = await supabase
    .from('user_settings')
    .upsert({
      id: user.id,
      pin_hash,
      pin_intentos_fallidos: 0
    })

  if (error) return { error: error.message }
  
  const cookieStore = await cookies()
  cookieStore.set('kely_pin_unlocked', 'true', { 
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400 * 30
  })
  return { success: true }
}

export async function verifyPin(pin) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'No autorizado' }

  const { data: settings, error } = await supabase
    .from('user_settings')
    .select('pin_hash, pin_intentos_fallidos')
    .eq('id', user.id)
    .single()

  if (error || !settings) return { error: 'No se encontró configuración de PIN' }

  if (settings.pin_intentos_fallidos >= 3) {
    await supabase.auth.signOut()
    return { error: 'Demasiados intentos. Tu sesión se ha cerrado.', locked: true }
  }

  const isValid = await bcrypt.compare(pin, settings.pin_hash)

  if (!isValid) {
    await supabase
      .from('user_settings')
      .update({ pin_intentos_fallidos: settings.pin_intentos_fallidos + 1 })
      .eq('id', user.id)

    return { error: 'PIN incorrecto' }
  }

  // Reset intentos on success
  await supabase
    .from('user_settings')
    .update({ pin_intentos_fallidos: 0 })
    .eq('id', user.id)

  const cookieStore = await cookies()
  cookieStore.set('kely_pin_unlocked', 'true', { 
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400 * 30
  })

  return { success: true }
}
