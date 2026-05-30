/**
 * Pure helper for validating condensation LLM output.
 *
 * Extracted into its own module so it can be unit-tested without importing
 * the edge-function entry point (which has top-level Deno.serve side effects).
 */

/**
 * Validates the raw text returned by the condensation LLM.
 *
 * - On success (valid JSON): returns a canonical re-serialised JSON string.
 * - On failure (malformed / truncated JSON): logs a warning and returns the
 *   previous valid summary, or null if there was none.
 *
 * This function NEVER returns a non-JSON string. Callers can safely write the
 * result to `conversaciones.historial_resumido` without further validation.
 */
export function validateCondensationSummary(
  rawText: string,
  previousSummary: string | null,
): string | null {
  try {
    const parsed = JSON.parse(rawText);
    return JSON.stringify(parsed); // canonical, always-valid JSON
  } catch (e: any) {
    console.warn(
      "[Agent-Runner] Condensation produced invalid JSON; keeping previous summary.",
      e?.message,
    );
    return previousSummary ?? null;
  }
}
