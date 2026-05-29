/**
 * lib/verificar-datos-paciente.js
 *
 * Pure decision logic and Supabase integration for the
 * verificar_datos_paciente agent tool.
 *
 * Exported for Vitest testing (Node) and imported from agent-runner/tools.ts.
 *
 * Decision table (safe reminder-linking follow-up):
 *   0 exact rows + 0 rescue rows     → match:'none'
 *   0 exact rows + 1..N rescue rows  → match:'needs_context_rescue'
 *   2+ exact rows without hora_cita  → match:'needs_time_tiebreaker'
 *   2+ exact rows with hora_cita     → match:'multiple'
 *   1 row:
 *     telefono IS NULL or ''      → mode_suggested:'auto_update'
 *     telefono === from_number    → mode_suggested:'already_up_to_date'
 *     telefono !== from_number    → mode_suggested:'request_approval'
 */

function canonicalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * Builds a small set of conservative name variants from the legal full name the
 * patient provides. This supports appointments stored under shortened variants
 * such as "primer nombre + apellidos" without introducing fuzzy matching.
 *
 * Example:
 *   "María Fernanda García López" ->
 *   [
 *     "María Fernanda García López",
 *     "María García López"
 *   ]
 *
 * @param {string} fullName
 * @returns {string[]}
 */
export function buildNameVariants(fullName) {
  const canonical = canonicalizeName(fullName)

  if (!canonical) return []

  const tokens = canonical.split(' ')
  const variants = [canonical]
  const pushVariant = (parts) => {
    const variant = canonicalizeName(parts.join(' '))
    if (!variant || variants.includes(variant)) return
    variants.push(variant)
  }

  if (tokens.length >= 4) {
    pushVariant([tokens[0], ...tokens.slice(-2)])
  }

  if (tokens.length >= 5) {
    pushVariant([...tokens.slice(0, 2), ...tokens.slice(-2)])
  }

  return variants
}

function dedupeRows(rows) {
  const seen = new Set()
  return (rows ?? []).filter((row) => {
    const key = `${row.id}|${row.fecha ?? ''}|${row.hora ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toCandidate(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    fecha: row.fecha ?? null,
    hora: row.hora ?? null,
    score: row.score,
  }
}

export function applyRescueDecision(rows, options = {}) {
  const { dateProvided = false } = options

  if (!rows || rows.length === 0) {
    return {
      match: 'none',
      reason: 'no_relevant_appointment',
    }
  }

  return {
    match: 'needs_context_rescue',
    reason: dateProvided ? 'date_mismatch_or_nearby_context' : 'date_missing_nearby_context',
    rescue_hint: dateProvided
      ? 'Pedí la hora o confirmá una cita cercana antes de vincular el número.'
      : 'El paciente no recuerda la fecha: pedí la hora o confirmá una cita cercana antes de vincular el número.',
    candidates: rows.map(toCandidate),
  }
}

async function fetchMatchRows(supabase, {
  nameVariants,
  fecha_cita,
  hora_cita,
  allow_nearby = false,
}) {
  const aggregatedRows = []

  for (const variant of nameVariants) {
    const rpcArgs = {
      p_nombre: variant,
      p_fecha_cita: fecha_cita ?? null,
      p_allow_nearby: allow_nearby,
    }

    if (hora_cita) {
      rpcArgs.p_hora_cita = hora_cita
    }

    const { data: rows, error } = await supabase.rpc('verificar_paciente_match', rpcArgs)

    if (error) {
      return { error }
    }

    aggregatedRows.push(...(rows ?? []))
  }

  return { rows: dedupeRows(aggregatedRows) }
}

/**
 * Pure function. Applies decision logic given the RPC result rows and
 * the sender's phone number. No Supabase calls here.
 *
 * @param {Array<{id: string, nombre: string, telefono: string|null, fecha?: string|null, hora?: string|null, score: number}>} rows
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
    const candidates = rows.map(toCandidate)

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
      candidates: [toCandidate(row)],
    }
  }

  if (existingTelefono === fromNumber) {
    return {
      match: 'unique',
      paciente_id: row.id,
      mode_suggested: 'already_up_to_date',
      existing_telefono: existingTelefono,
      candidates: [toCandidate(row)],
    }
  }

  // Phone differs
  return {
    match: 'unique',
    paciente_id: row.id,
    mode_suggested: 'request_approval',
    existing_telefono: existingTelefono,
    candidates: [toCandidate(row)],
  }
}

/**
 * Calls the verificar_paciente_match RPC and applies decision logic.
 *
 * @param {{ nombre_completo: string, fecha_cita?: string, hora_cita?: string, from_number: string }} args
 * @param {object} supabase  Supabase client (service-role)
 * @returns {Promise<object>}
 */
export async function verificarDatosPaciente(args, supabase) {
  const { nombre_completo, fecha_cita, hora_cita, from_number } = args

  try {
    const nameVariants = buildNameVariants(nombre_completo)

    if (nameVariants.length === 0) {
      return { match: 'none', reason: 'missing_name' }
    }

    if (fecha_cita) {
      const exactResult = await fetchMatchRows(supabase, {
        nameVariants,
        fecha_cita,
        hora_cita,
        allow_nearby: false,
      })

      if (exactResult.error) {
        return { match: 'error', reason: exactResult.error.message ?? 'rpc_error' }
      }

      const exactRows = exactResult.rows ?? []
      if (exactRows.length > 0) {
        return applyMatchDecision(exactRows, from_number, { timeProvided: Boolean(hora_cita) })
      }
    }

    const rescueResult = await fetchMatchRows(supabase, {
      nameVariants,
      fecha_cita: fecha_cita ?? null,
      hora_cita,
      allow_nearby: true,
    })

    if (rescueResult.error) {
      return { match: 'error', reason: rescueResult.error.message ?? 'rpc_error' }
    }

    return applyRescueDecision(rescueResult.rows ?? [], { dateProvided: Boolean(fecha_cita) })
  } catch (err) {
    return { match: 'error', reason: err?.message ?? 'unexpected_error' }
  }
}
