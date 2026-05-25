/**
 * amount.ts — Payment amount normalization for agent-runner (Deno).
 *
 * KEEP IN SYNC with lib/amount-normalizer.js (Node/Next.js side).
 *
 * This is a deliberate re-implementation (not a cross-import) because Deno
 * cannot cleanly import .js files from outside the supabase/functions tree.
 * Duplication mitigation: header comment + matching test suite.
 *
 * Normalization rules (applied in order):
 *  1. If input is already a number → round to 2 decimals, guard negative.
 *  2. Strip currency symbols and words: $, USD, usd, dólares, dolares.
 *  3. Strip whitespace.
 *  4. If multiple distinct numeric tokens detected → return null (ambiguous).
 *  5. Locale detection:
 *     a. Contains both '.' and ',':
 *        - If ',' comes AFTER the last '.' (European: 1.234,50) → strip '.', replace ',' with '.'
 *        - If '.' comes AFTER the last ',' (US: 1,234.50) → strip ','
 *     b. Contains only ',' → replace with '.'
 *     c. Contains only '.' → keep as-is
 *  6. parseFloat. NaN → null. Negative → null.
 */

/**
 * Normalize an OCR-extracted or user-provided amount string to a float.
 *
 * @param raw - The raw amount string, number, null, or undefined.
 * @returns Normalized float (2 decimal precision) or null if invalid.
 */
export function normalizeAmount(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;

  // If already a number, just guard and round
  if (typeof raw === "number") {
    if (!isFinite(raw) || raw < 0) return null;
    return Math.round(raw * 100) / 100;
  }

  if (typeof raw !== "string") return null;

  const input = raw.trim();
  if (input === "") return null;

  // Strip currency words/symbols to find raw number tokens
  const stripped = input
    .replace(/USD|usd|US\$|dólares|dolares/gi, " ")
    .replace(/\$/g, " ")
    .trim();

  // Check for a leading negative sign before any number
  if (/^\s*-/.test(stripped)) return null;

  // Find all number-like tokens (digits with optional separators)
  const numberTokens: string[] = stripped.match(/\d[\d.,]*/g) ?? [];

  // If more than one distinct number token, it's ambiguous
  if (numberTokens.length > 1) return null;
  if (numberTokens.length === 0) return null;

  let normalized: string = numberTokens[0]!;

  // Locale detection
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf(".");
    const lastComma = normalized.lastIndexOf(",");
    if (lastComma > lastDot) {
      // European format: 1.234,50 → remove '.', replace ',' with '.'
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      // US format: 1,234.50 → remove ','
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // Only comma: treat as decimal separator (Ecuadorian receipts: $17,50)
    normalized = normalized.replace(",", ".");
  }
  // Only dot: keep as-is

  const value = parseFloat(normalized);

  if (!isFinite(value) || isNaN(value)) return null;
  if (value < 0) return null;

  return Math.round(value * 100) / 100;
}

/**
 * Check if an OCR-extracted amount is >= the expected amount.
 *
 * The +0.005 epsilon is a floating-point safety margin (not a business
 * tolerance) to handle cases like 17.495 being effectively equal to 17.50
 * after float arithmetic. The policy is still strict >=.
 *
 * @param ocrAmount - Normalized OCR amount (null if extraction failed).
 * @param expected - Expected amount from cita.monto_adelanto.
 * @returns true if ocrAmount is a valid number >= expected.
 */
export function amountMatches(
  ocrAmount: number | null,
  expected: number,
): boolean {
  if (ocrAmount === null) return false;
  return ocrAmount + 0.005 >= expected;
}
