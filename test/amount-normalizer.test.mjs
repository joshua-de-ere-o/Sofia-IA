/**
 * test/amount-normalizer.test.mjs
 *
 * Unit tests for lib/amount-normalizer.js
 * Tests written FIRST (TDD — RED phase) before implementation.
 *
 * Covers all 10 spec examples from FR-3 + design §3 cases.
 */

import { describe, it, expect } from 'vitest'
import { normalizeAmount } from '../lib/amount-normalizer.js'

describe('normalizeAmount — spec examples (FR-3)', () => {
  // Spec table: 10 canonical examples
  it('$17,50 → 17.50', () => {
    expect(normalizeAmount('$17,50')).toBe(17.5)
  })

  it('USD 17.50 → 17.50', () => {
    expect(normalizeAmount('USD 17.50')).toBe(17.5)
  })

  it('$ 17.5 → 17.50', () => {
    expect(normalizeAmount('$ 17.5')).toBe(17.5)
  })

  it('17.50 dólares → 17.50', () => {
    expect(normalizeAmount('17.50 dólares')).toBe(17.5)
  })

  it('1.234,50 → 1234.50 (European thousands)', () => {
    expect(normalizeAmount('1.234,50')).toBe(1234.5)
  })

  it('$0 → 0.00', () => {
    expect(normalizeAmount('$0')).toBe(0)
  })

  it('monto: 25.00 → 25.00', () => {
    expect(normalizeAmount('monto: 25.00')).toBe(25)
  })

  it('hello world → null', () => {
    expect(normalizeAmount('hello world')).toBeNull()
  })

  it('"" (empty string) → null', () => {
    expect(normalizeAmount('')).toBeNull()
  })

  it('$5 y $10 (multiple numbers, ambiguous) → null', () => {
    expect(normalizeAmount('$5 y $10')).toBeNull()
  })
})

describe('normalizeAmount — additional edge cases (design §3)', () => {
  it('17.50 → 17.5', () => {
    expect(normalizeAmount('17.50')).toBe(17.5)
  })

  it('17,50 → 17.5 (comma as decimal)', () => {
    expect(normalizeAmount('17,50')).toBe(17.5)
  })

  it('1,234.50 → 1234.5 (US thousands)', () => {
    expect(normalizeAmount('1,234.50')).toBe(1234.5)
  })

  it('USD 17.50 (extra whitespace) → 17.5', () => {
    expect(normalizeAmount('  USD  17.50  ')).toBe(17.5)
  })

  it('negative number → null', () => {
    expect(normalizeAmount('-5')).toBeNull()
  })

  it('null input → null', () => {
    expect(normalizeAmount(null)).toBeNull()
  })

  it('undefined input → null', () => {
    expect(normalizeAmount(undefined)).toBeNull()
  })

  it('numeric input (number type) → same number rounded', () => {
    expect(normalizeAmount(12.5)).toBe(12.5)
  })

  it('zero string "0" → 0', () => {
    expect(normalizeAmount('0')).toBe(0)
  })

  it('dolares (no accent) → 17.5', () => {
    expect(normalizeAmount('17.50 dolares')).toBe(17.5)
  })
})
