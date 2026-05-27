import { createAdminSupabaseClient } from '@/lib/supabase-admin'
import { isAuthorizedStaffRecord, normalizeEmail } from '@/lib/staff-auth'

const STAFF_ALLOWLIST_COLUMNS = 'email, role, is_active'

export async function findAuthorizedStaffByEmail(email) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return { authorized: false, staff: null }
  }

  const adminSupabase = createAdminSupabaseClient()
  const { data, error } = await adminSupabase
    .from('staff_allowlist')
    .select(STAFF_ALLOWLIST_COLUMNS)
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error) {
    throw error
  }

  return {
    authorized: isAuthorizedStaffRecord(data),
    staff: data ?? null,
  }
}

export async function findAuthorizedStaffForUser(supabase, user) {
  const normalizedEmail = normalizeEmail(user?.email)

  if (!normalizedEmail) {
    return { authorized: false, staff: null }
  }

  const { data, error } = await supabase
    .from('staff_allowlist')
    .select(STAFF_ALLOWLIST_COLUMNS)
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error) {
    throw error
  }

  return {
    authorized: isAuthorizedStaffRecord(data),
    staff: data ?? null,
  }
}
