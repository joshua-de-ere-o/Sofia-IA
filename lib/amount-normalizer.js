/**
 * lib/amount-normalizer.js
 *
 * KEEP IN SYNC with supabase/functions/agent-runner/amount.ts
 *
 * Pure function to normalize OCR-extracted payment amounts.
 * Handles common Ecuadorian receipt formats (USD, comma as decimal, etc.).
 *
 * Used by: agent-runner (via amount.ts which re-exports this logic in Deno),
 * and by the text-fallback path when a patient replies with a numeric amount.
 *
 * Normalization rules (applied in order):
 *  1. If input is already a number → round to 2 decimals, guard negative.
 *  2. Strip currency symbols and words: $, USD, usd, dólares, dolares.
 *  3. Strip whitespace.
 *  4. If multiple distinct numeric values detected → return null (ambiguous).
 *  5. Locale detection:
 *     a. Contains both '.' and ',':
 *        - If ',' comes AFTER the last '.' (European: 1.234,50) → strip '.', replace ',' with '.'
 *        - If '.' comes AFTER the last ',' (US: 1,234.50) → strip ','
 *     b. Contains only ',' → replace with '.'
 *     c. Contains only '.' → keep as-is
 *  6. parseFloat. NaN → null. Negative → null.
 */

/**
 * @param {string | number | null | undefined} raw
 * @returns {number | null}
 */
export function normalizeAmount(raw) {
  if (raw === null || raw === undefined) return null

  // If already a number, just guard and round
  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw < 0) return null
    return Math.round(raw * 100) / 100
  }

  if (typeof raw !== 'string') return null

  const input = raw.trim()
  if (input === '') return null

  // Check for multiple distinct numeric amounts (ambiguous)
  // Strip currency words first to find raw numbers
  const stripped = input
    .replace(/USD|usd|US\$|dólares|dolares/gi, ' ')
    .replace(/\$/g, ' ')
    .trim()

  // Check for a leading negative sign before any number (negative amount → null)
  if (/^\s*-/.test(stripped)) return null

  // Find all number-like tokens (digits with optional separators)
  const numberTokens = stripped.match(/\d[\d.,]*/g) || []

  // If more than one distinct number token, it's ambiguous
  if (numberTokens.length > 1) return null

  if (numberTokens.length === 0) return null

  let normalized = numberTokens[0]

  // Locale detection
  const hasDot = normalized.includes('.')
  const hasComma = normalized.includes(',')

  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf('.')
    const lastComma = normalized.lastIndexOf(',')
    if (lastComma > lastDot) {
      // European format: 1.234,50 → remove '.', replace ',' with '.'
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      // US format: 1,234.50 → remove ','
      normalized = normalized.replace(/,/g, '')
    }
  } else if (hasComma && !hasDot) {
    // Only comma: treat as decimal separator (Ecuadorian receipts: $17,50)
    normalized = normalized.replace(',', '.')
  }
  // Only dot: keep as-is

  const value = parseFloat(normalized)

  if (!isFinite(value) || isNaN(value)) return null
  if (value < 0) return null

  return Math.round(value * 100) / 100
}
