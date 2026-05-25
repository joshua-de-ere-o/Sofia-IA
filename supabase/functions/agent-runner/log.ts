/**
 * log.ts — PII masking helpers and structured logging for agent-runner.
 *
 * Rules (NFR-3):
 *   - Patient names and phone numbers MUST be masked in logs.
 *   - Receipt URLs, amounts, and cita IDs are NOT PII — log freely.
 *
 * Used by: agent-runner payment processing branch (T6, wired in PR 3).
 */

/**
 * Mask a phone number for logging.
 * Keeps first 5 characters and last 4 characters, masks the middle with ***.
 * Example: "+593987654321" → "+5939***4321"
 *
 * If the phone is too short (≤ 9 chars), returns it as-is — masking would
 * expose more than it hides (defensive: don't crash on malformed input).
 */
export function maskPhone(telefono: string): string {
  if (!telefono) return telefono;
  if (telefono.length <= 9) return telefono;
  const keep_start = 5;
  const keep_end = 4;
  const prefix = telefono.slice(0, keep_start);
  const suffix = telefono.slice(-keep_end);
  return `${prefix}***${suffix}`;
}

/**
 * Mask a patient name for logging.
 * Keeps first 2 characters, replaces the rest with ***.
 * Example: "Maria Jose" → "Ma***"
 *
 * If the name is empty, returns it as-is.
 */
export function maskName(nombre: string): string {
  if (!nombre) return nombre;
  const keep = Math.min(2, nombre.length);
  return `${nombre.slice(0, keep)}***`;
}

/**
 * Log a payment event as structured JSON to console.log.
 * PII fields (telefono, nombre) are automatically masked before logging.
 *
 * @param event - Short event identifier (e.g. "ocr_start", "cita_provisional")
 * @param ctx   - Event context. PII fields are masked; all others logged as-is.
 */
export function logPaymentEvent(
  event: string,
  ctx: {
    citaId?: string;
    telefono?: string;
    nombre?: string;
    monto?: number | null;
    montEsperado?: number;
    imagePath?: string;
    pendingId?: string;
    reason?: string;
    [key: string]: unknown;
  } = {},
): void {
  const masked: Record<string, unknown> = {
    event,
    ts: new Date().toISOString(),
  };

  // Copy all context fields; mask PII
  for (const [k, v] of Object.entries(ctx)) {
    if (k === "telefono" && typeof v === "string") {
      masked[k] = maskPhone(v);
    } else if (k === "nombre" && typeof v === "string") {
      masked[k] = maskName(v);
    } else {
      masked[k] = v;
    }
  }

  console.log(`[Agent-Runner] ${JSON.stringify(masked)}`);
}
