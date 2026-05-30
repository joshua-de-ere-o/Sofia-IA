/**
 * agent-gate.ts — decisión pura "¿Sofía debe responder?".
 *
 * Centraliza el enforcement que antes no existía en el camino del mensaje:
 *   - switch maestro global (configuracion.agente_activo)
 *   - modo per-conversación 'manual' (con expiración via manual_until)
 *   - modo 'personal' (defensivo; normalmente ya cortado por blocklist en el pre-filter)
 *
 * Se mantiene sin dependencias (ni Supabase ni Deno) para testear sin levantar
 * el runner — mismo enfoque que el resto de la lógica pura del proyecto.
 *
 * `agenteActivoGlobal` indefinido/null se trata como ACTIVO: así, antes de correr
 * la migración que agrega la columna, el comportamiento es idéntico al actual.
 */

export type AgentGateDecision = {
  respond: boolean
  reason: 'auto' | 'manual_expired' | 'paused_global' | 'paused_manual' | 'paused_personal'
}

export function decideAgentResponse(params: {
  agenteActivoGlobal?: boolean | null
  mode?: string | null
  manualUntil?: string | null
  now?: Date
}): AgentGateDecision {
  const { agenteActivoGlobal, mode, manualUntil } = params
  const now = params.now ?? new Date()

  // 1. Switch maestro global. Solo apaga si es explícitamente false.
  if (agenteActivoGlobal === false) {
    return { respond: false, reason: 'paused_global' }
  }

  // 2. Modo personal (defensivo).
  if (mode === 'personal') {
    return { respond: false, reason: 'paused_personal' }
  }

  // 3. Modo manual con expiración.
  if (mode === 'manual') {
    const expirado = manualUntil != null && new Date(manualUntil).getTime() <= now.getTime()
    if (expirado) {
      return { respond: true, reason: 'manual_expired' }
    }
    return { respond: false, reason: 'paused_manual' }
  }

  // 4. Default: Sofía responde.
  return { respond: true, reason: 'auto' }
}
