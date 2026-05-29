/**
 * lib/verificar-datos-paciente.js
 *
 * Pure decision logic and Supabase integration for the
 * verificar_datos_paciente agent tool.
 *
 * Exported for Vitest testing (Node) and imported from agent-runner/tools.ts.
 *
 * Decision table (per spec R5.3 and design §2.3):
 *   0 rows   → match:'none'
 *   2+ rows without hora_cita → match:'needs_time_tiebreaker'
 *   2+ rows with hora_cita    → match:'multiple'
 *   1 row:
 *     telefono IS NULL or ''      → mode_suggested:'auto_update'
 *     telefono === from_number    → mode_suggested:'already_up_to_date'
 *     telefono !== from_number    → mode_suggested:'request_approval'
 */

/**
 * Pure function. Applies decision logic given the RPC result rows and
 * the sender's phone number. No Supabase calls here.
 *
 * @param {Array<{id: string, nombre: string, telefono: string|null, hora?: string|null, score: number}>} rows
 * @param {string} fromNumber
 * @param {{ timeProvided?: boolean }} options
 * @returns {object}
 */
export function applyMatchDecision(rows, fromNumber, options = {}) {
  const { timeProvided = false } = options

  if (!rows || rows.length === 0) {
    return { match: 'none' }
  }

  if (rows.length > 1) {
    const candidates = rows.map((r) => ({ id: r.id, nombre: r.nombre, hora: r.hora ?? null, score: r.score }))

    if (!timeProvided) {
      return {
        match: 'needs_time_tiebreaker',
        candidates,
      }
    }

    return {
      match: 'multiple',
      candidates,
    }
  }

  // Exactly 1 row
  const row = rows[0]
  const existingTelefono = row.telefono || null

  if (!existingTelefono || existingTelefono === '') {
    return {
      match: 'unique',
      paciente_id: row.id,
      mode_suggested: 'auto_update',
      existing_telefono: null,
      candidates: [row],
    }
  }

  if (existingTelefono === fromNumber) {
    return {
      match: 'unique',
      paciente_id: row.id,
      mode_suggested: 'already_up_to_date',
      existing_telefono: existingTelefono,
      candidates: [row],
    }
  }

  // Phone differs
  return {
    match: 'unique',
    paciente_id: row.id,
    mode_suggested: 'request_approval',
    existing_telefono: existingTelefono,
    candidates: [row],
  }
}

/**
 * Calls the verificar_paciente_match RPC and applies decision logic.
 *
 * @param {{ nombre_completo: string, fecha_cita: string, hora_cita?: string, from_number: string }} args
 * @param {object} supabase  Supabase client (service-role)
 * @returns {Promise<object>}
 */
export async function verificarDatosPaciente(args, supabase) {
  const { nombre_completo, fecha_cita, hora_cita, from_number } = args

  try {
    const rpcArgs = {
      p_nombre: nombre_completo,
      p_fecha_cita: fecha_cita,
    }

    if (hora_cita) {
      rpcArgs.p_hora_cita = hora_cita
    }

    const { data: rows, error } = await supabase.rpc('verificar_paciente_match', rpcArgs)

    if (error) {
      return { match: 'error', reason: error.message ?? 'rpc_error' }
    }

    return applyMatchDecision(rows ?? [], from_number, { timeProvided: Boolean(hora_cita) })
  } catch (err) {
    return { match: 'error', reason: err?.message ?? 'unexpected_error' }
  }
}
