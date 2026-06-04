/**
 * citas-context.ts — Build the "active appointments" ground-truth context block
 * injected into every agent turn for known patients.
 *
 * Why this exists: a patient's appointment can be cancelled or rescheduled
 * OUT-OF-BAND (dashboard, Telegram operator bot, raw SQL) without writing
 * anything to the conversation's `mensajes_raw`. The chat history still holds
 * the old "tu cita es el X" text, so the LLM may repeat a cita that no longer
 * exists. Injecting the real current appointments each turn — flagged as the
 * source of truth — lets the model override stale history for ALL out-of-band
 * sources at a single point, instead of patching every mutation site.
 */

/** States that count as a live appointment the patient currently holds. */
export const CITAS_ACTIVAS_STATES = [
  "confirmada",
  "pendiente_pago",
  "confirmada_provisional",
] as const;

export interface CitaActiva {
  fecha: string;
  hora: string;
  servicio?: string | null;
  modalidad?: string | null;
  zona?: string | null;
  estado?: string | null;
}

/**
 * Format the active-appointments context block.
 *
 * @param citas Active citas for the patient (already filtered by state), or null.
 * @returns A string ready to concatenate into the user message context. Always
 *          returns an authoritative block (even when empty) so the LLM cannot
 *          fall back to stale history.
 */
export function buildCitasActivasContext(
  citas: CitaActiva[] | null | undefined,
): string {
  const list = Array.isArray(citas) ? citas : [];

  if (list.length === 0) {
    return (
      "\n\n[CITAS ACTIVAS DEL PACIENTE — FUENTE DE VERDAD]: El paciente NO tiene " +
      "ninguna cita activa en este momento. Si en mensajes anteriores del chat se " +
      "mencionó una cita, ya NO existe (fue cancelada o reagendada por fuera): NO la " +
      "menciones como vigente ni la repitas. Si el paciente pregunta por su cita, " +
      "decile que no ves ninguna cita activa a su nombre."
    );
  }

  const lines = list.map((c) => {
    const hora = (c.hora || "").slice(0, 5);
    const servicio = c.servicio ?? "—";
    const modalidad = c.modalidad ?? "—";
    const zona = c.zona ? `, ${c.zona}` : "";
    const estado = c.estado ?? "—";
    return `- ${c.fecha} ${hora} — ${servicio} (${modalidad}${zona}) [${estado}]`;
  });

  return (
    "\n\n[CITAS ACTIVAS DEL PACIENTE — FUENTE DE VERDAD]:\n" +
    lines.join("\n") +
    "\nEsta lista refleja la base AHORA. Si en mensajes anteriores se mencionó una " +
    "cita que NO aparece en esta lista, fue cancelada o reagendada: NO la trates como vigente."
  );
}
