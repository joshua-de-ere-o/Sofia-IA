export const STAFF_ROLES = ['doctor', 'admin']
export const PIN_UNLOCK_COOKIE_NAME = 'kely_pin_unlocked'

const PIN_COOKIE_VERSION = 'v1'
const PIN_COOKIE_SECRET_ENV_KEYS = ['KELY_PIN_COOKIE_SECRET', 'PIN_COOKIE_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const AUTH_ERROR_MESSAGES = {
  auth_callback_failed: 'No se pudo validar el enlace mágico. Pedí uno nuevo e inténtalo otra vez.',
  invalid_magic_link_request: 'No se pudo procesar la solicitud de acceso. Revisa el correo e inténtalo otra vez.',
  missing_auth_params: 'El enlace de acceso no es válido o ya expiró. Pedí uno nuevo.',
  server_auth_not_configured: 'Falta configuración del servidor para iniciar sesión.',
  staff_not_authorized: 'Este correo no está autorizado para ingresar al CRM.',
}

const textEncoder = new TextEncoder()

export function normalizeEmail(email) {
  if (typeof email !== 'string') return ''

  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    return ''
  }

  return normalizedEmail
}

export function isAllowedStaffRole(role) {
  return STAFF_ROLES.includes(role)
}

export function isAuthorizedStaffRecord(record) {
  return Boolean(
    record &&
    normalizeEmail(record.email) &&
    record.is_active === true &&
    isAllowedStaffRole(record.role)
  )
}

export function getPinCookieOptions({ isProduction = process.env.NODE_ENV === 'production' } = {}) {
  return {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 86400 * 30,
  }
}

export function getPinCookieSecret(env = process.env) {
  for (const key of PIN_COOKIE_SECRET_ENV_KEYS) {
    const value = env?.[key]

    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return ''
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false
  }

  let mismatch = 0

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }

  return mismatch === 0
}

async function signPinCookiePayload(payload, secret) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(payload))
  return bytesToHex(new Uint8Array(signature))
}

export async function createPinUnlockCookieValue(userId, { secret = getPinCookieSecret() } = {}) {
  if (typeof userId !== 'string' || !userId || !secret) {
    return null
  }

  const payload = `${PIN_COOKIE_VERSION}.${userId}`
  const signature = await signPinCookiePayload(payload, secret)
  return `${payload}.${signature}`
}

export async function isPinUnlockCookieValid(cookieValue, userId, { secret = getPinCookieSecret() } = {}) {
  if (typeof cookieValue !== 'string' || !cookieValue || typeof userId !== 'string' || !userId || !secret) {
    return false
  }

  const [version, signedUserId, signature, ...rest] = cookieValue.split('.')

  if (rest.length > 0 || version !== PIN_COOKIE_VERSION || signedUserId !== userId || !signature) {
    return false
  }

  const expectedSignature = await signPinCookiePayload(`${version}.${signedUserId}`, secret)
  return constantTimeEqual(signature, expectedSignature)
}

export function isFourDigitPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin)
}

export function getAuthErrorMessage(code) {
  return AUTH_ERROR_MESSAGES[code] ?? null
}

export function createCookieOperationStore() {
  const operations = new Map()

  return {
    record(cookiesToSet) {
      if (!Array.isArray(cookiesToSet)) return

      cookiesToSet.forEach((cookie) => {
        if (!cookie?.name) return
        operations.set(cookie.name, cookie)
      })
    },
    apply(response) {
      operations.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
    },
    getAll() {
      return Array.from(operations.values())
    },
  }
}
