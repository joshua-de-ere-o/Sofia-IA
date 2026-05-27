/**
 * lib/confirmar-actualizacion-datos.js
 *
 * Business logic for the confirmar_actualizacion_datos agent tool.
 *
 * Handles all paths:
 *   - already_up_to_date: from_number === existing_telefono → no writes
 *   - UNIQUE collision pre-check: from_number already belongs to a DIFFERENT paciente_id
 *     → INSERT pendiente + escalation_required:true (per resolution #231)
 *   - auto_update: no existing phone → UPDATE pacientes + INSERT historial estado='aprobado'
 *   - request_approval: existing phone differs → INSERT historial estado='pendiente' + escalation_required:true
 *
 * NOTE on Telegram escalation: this module does NOT send Telegram messages directly.
 * Instead it returns { escalation_required: true, historial_id, ... } in the JSON result
 * so that PR 3 (app/api/telegram/route.js) can consume the signal and send notifications.
 * The agent-runner executor in tools.ts will surface this to the LLM.
 *
 * TODO(PR3): When escalation_required=true, the agent-runner should trigger
 * a Telegram notification to Dra. Kely with the historial_id and patient context.
 * The integration point is: after confirmar_actualizacion_datos returns, check
 * escalation_required in the tool result and call the Telegram helper from tools.ts.
 */

/**
 * Executes the appropriate update path.
 *
 * @param {{ paciente_id: string, from_number: string, telefono_nuevo: string, fecha_nacimiento: string, mode: 'auto_update'|'request_approval', existing_telefono?: string }} args
 * @param {object} supabase  Supabase service-role client
 * @returns {Promise<string>}  JSON string
 */
export async function confirmarActualizacionDatos(args, supabase) {
  const {
    paciente_id,
    from_number,
    telefono_nuevo,
    fecha_nacimiento,
    mode,
    existing_telefono,
  } = args

  try {
    // ── 0. already_up_to_date short-circuit ────────────────────────────────
    // If existing_telefono is explicitly provided and matches from_number,
    // there's nothing to do.
    if (existing_telefono && existing_telefono === from_number) {
      return JSON.stringify({
        status: 'already_up_to_date',
        escalation_required: false,
        mensaje_sofia:
          'Tus datos ya están registrados con este número. ¡Seguís recibiendo los recordatorios normalmente!',
      })
    }

    // ── 1. UNIQUE collision pre-check (resolution #231) ─────────────────────
    // Check if from_number already belongs to a DIFFERENT patient.
    const { data: collidingPatient } = await supabase
      .from('pacientes')
      .select('id')
      .eq('telefono', from_number)
      .neq('id', paciente_id)
      .maybeSingle()

    if (collidingPatient) {
      // Collision: from_number registered under a different patient.
      // Insert pendiente and escalate — NEVER auto-update.
      const expiraAt = new Date(Date.now() + 24 * 3_600_000).toISOString()
      const { data: histData } = await supabase
        .from('pacientes_telefono_historial')
        .insert({
          paciente_id,
          telefono_anterior: existing_telefono ?? null,
          telefono_nuevo: from_number,
          from_number,
          estado: 'pendiente',
          expira_at: expiraAt,
          motivo: 'colision_unique_telefono',
        })
        .select()
        .single()

      return JSON.stringify({
        status: 'collision_detected',
        escalation_required: true,
        historial_id: histData?.id ?? null,
        colliding_paciente_id: collidingPatient.id,
        // TODO(PR3): send Telegram to Dra. Kely with collision context
        mensaje_sofia:
          'Recibí tu solicitud pero noté una situación que necesita la revisión de la Dra. Kely. Te aviso cuando esté resuelto.',
      })
    }

    // ── 2. auto_update path ────────────────────────────────────────────────
    if (mode === 'auto_update') {
      // UPDATE pacientes
      await supabase
        .from('pacientes')
        .update({ telefono: from_number, fecha_nacimiento })
        .eq('id', paciente_id)

      // INSERT historial — estado='aprobado', aprobado_por='sistema'
      await supabase
        .from('pacientes_telefono_historial')
        .insert({
          paciente_id,
          telefono_anterior: null,
          telefono_nuevo: from_number,
          from_number,
          estado: 'aprobado',
          aprobado_por: 'sistema',
          expira_at: null,
          motivo: null,
        })
        .select()
        .single()

      return JSON.stringify({
        status: 'updated',
        escalation_required: false,
        mensaje_sofia:
          '¡Listo! Quedaron registrados tus datos. Desde ahora vas a recibir un recordatorio el día antes y otro un par de horas antes de cada cita con la Dra. Kely. En el mismo mensaje vas a poder confirmar, reprogramar o cancelar sin tener que escribir nada extra.',
      })
    }

    // ── 3. request_approval path ──────────────────────────────────────────
    // mode === 'request_approval': existing phone differs, needs Dra. Kely approval
    const expiraAt = new Date(Date.now() + 24 * 3_600_000).toISOString()
    const { data: histData } = await supabase
      .from('pacientes_telefono_historial')
      .insert({
        paciente_id,
        telefono_anterior: existing_telefono ?? null,
        telefono_nuevo: from_number,
        from_number,
        estado: 'pendiente',
        expira_at: expiraAt,
        motivo: null,
      })
      .select()
      .single()

    return JSON.stringify({
      status: 'pending_approval',
      escalation_required: true,
      historial_id: histData?.id ?? null,
      // TODO(PR3): send Telegram to Dra. Kely with inline keyboard
      // datos_confirm_<historial_id> / datos_reject_<historial_id>
      mensaje_sofia:
        'Recibí tu solicitud. Está esperando confirmación de la Dra. Kely, te aviso apenas la apruebe.',
    })
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      reason: err?.message ?? 'unexpected_error',
    })
  }
}
