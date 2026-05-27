'use server'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { findAuthorizedStaffForUser } from '@/lib/staff-auth-server'
import {
  createPinUnlockCookieValue,
  getPinCookieOptions,
  isFourDigitPin,
  PIN_UNLOCK_COOKIE_NAME,
} from '@/lib/staff-auth'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

async function requireAuthorizedStaff(supabase) {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'No autorizado', user: null }
  }

  const { authorized } = await findAuthorizedStaffForUser(supabase, user)

  if (!authorized) {
    await supabase.auth.signOut()
    return { error: 'No autorizado', user: null }
  }

  return { user }
}

async function setPinUnlockCookie(userId) {
  const cookieValue = await createPinUnlockCookieValue(userId)

  if (!cookieValue) {
    return { error: 'Falta configuración segura del servidor.' }
  }

  const cookieStore = await cookies()
  cookieStore.set(PIN_UNLOCK_COOKIE_NAME, cookieValue, getPinCookieOptions())
  return { success: true }
}

export async function hasPinSetup() {
  const supabase = await createServerSupabaseClient()
  const authResult = await requireAuthorizedStaff(supabase)

  if (authResult.error) return { error: 'No autorizado', setup: false }

  const { data, error } = await supabase
    .from('user_settings')
    .select('pin_hash')
    .eq('id', authResult.user.id)
    .single()

  if (error || !data?.pin_hash) {
    return { setup: false, userId: authResult.user.id }
  }

  return { setup: true, userId: authResult.user.id }
}

export async function setupPin(pin) {
  const supabase = await createServerSupabaseClient()
  const authResult = await requireAuthorizedStaff(supabase)

  if (authResult.error) return { error: 'No autorizado' }
  if (!isFourDigitPin(pin)) return { error: 'El PIN debe ser de 4 dígitos' }

  const salt = await bcrypt.genSalt(10)
  const pin_hash = await bcrypt.hash(pin, salt)

  const { error } = await supabase
    .from('user_settings')
    .upsert({
      id: authResult.user.id,
      pin_hash,
      pin_intentos_fallidos: 0
    })

  if (error) return { error: error.message }
  
  return setPinUnlockCookie(authResult.user.id)
}

export async function verifyPin(pin) {
  const supabase = await createServerSupabaseClient()
  const authResult = await requireAuthorizedStaff(supabase)

  if (authResult.error) return { error: 'No autorizado' }

  const { data: settings, error } = await supabase
    .from('user_settings')
    .select('pin_hash, pin_intentos_fallidos')
    .eq('id', authResult.user.id)
    .single()

  if (error || !settings) return { error: 'No se encontró configuración de PIN' }

  if (!isFourDigitPin(pin)) {
    return { error: 'El PIN debe ser de 4 dígitos' }
  }

  if (settings.pin_intentos_fallidos >= 3) {
    await supabase.auth.signOut()
    return { error: 'Demasiados intentos. Tu sesión se ha cerrado.', locked: true }
  }

  const isValid = await bcrypt.compare(pin, settings.pin_hash)

  if (!isValid) {
    const nextFailedAttempts = (settings.pin_intentos_fallidos ?? 0) + 1

    await supabase
      .from('user_settings')
      .update({ pin_intentos_fallidos: nextFailedAttempts })
      .eq('id', authResult.user.id)

    if (nextFailedAttempts >= 3) {
      await supabase.auth.signOut()
      return { error: 'Demasiados intentos. Tu sesión se ha cerrado.', locked: true }
    }

    return { error: 'PIN incorrecto' }
  }

  // Reset intentos on success
  await supabase
    .from('user_settings')
    .update({ pin_intentos_fallidos: 0 })
    .eq('id', authResult.user.id)

  return setPinUnlockCookie(authResult.user.id)
}
