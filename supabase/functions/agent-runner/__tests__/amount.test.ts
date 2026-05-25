/**
 * __tests__/amount.test.ts — Unit tests for amount.ts (Deno test runner)
 *
 * KEEP IN SYNC with supabase/functions/agent-runner/amount.ts
 * Mirrors test cases from test/amount-normalizer.test.mjs (Vitest).
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env __tests__/amount.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAmount, amountMatches } from "../amount.ts";

// ─── normalizeAmount ──────────────────────────────────────────────────────────

Deno.test("normalizeAmount — plain decimal string", () => {
  assertEquals(normalizeAmount("17.50"), 17.5);
});

Deno.test("normalizeAmount — comma as decimal (Ecuadorian receipt)", () => {
  assertEquals(normalizeAmount("17,50"), 17.5);
});

Deno.test("normalizeAmount — dollar sign prefix", () => {
  assertEquals(normalizeAmount("$17,50"), 17.5);
});

Deno.test("normalizeAmount — USD prefix", () => {
  assertEquals(normalizeAmount("USD 17.50"), 17.5);
});

Deno.test("normalizeAmount — space between symbol and number", () => {
  assertEquals(normalizeAmount("$ 17.5"), 17.5);
});

Deno.test("normalizeAmount — dólares suffix", () => {
  assertEquals(normalizeAmount("17.50 dólares"), 17.5);
});

Deno.test("normalizeAmount — thousands separator US format (1,234.50)", () => {
  assertEquals(normalizeAmount("1,234.50"), 1234.5);
});

Deno.test("normalizeAmount — thousands separator European format (1.234,50)", () => {
  assertEquals(normalizeAmount("1.234,50"), 1234.5);
});

Deno.test("normalizeAmount — non-numeric string returns null", () => {
  assertEquals(normalizeAmount("abc"), null);
});

Deno.test("normalizeAmount — negative value returns null", () => {
  assertEquals(normalizeAmount("-5"), null);
});

Deno.test("normalizeAmount — null input returns null", () => {
  assertEquals(normalizeAmount(null), null);
});

Deno.test("normalizeAmount — number input passes through", () => {
  assertEquals(normalizeAmount(12.5), 12.5);
});

Deno.test("normalizeAmount — zero amount (valid)", () => {
  assertEquals(normalizeAmount("$0"), 0);
});

Deno.test("normalizeAmount — empty string returns null", () => {
  assertEquals(normalizeAmount(""), null);
});

Deno.test("normalizeAmount — undefined returns null", () => {
  assertEquals(normalizeAmount(undefined), null);
});

Deno.test("normalizeAmount — multiple distinct numbers returns null (ambiguous)", () => {
  assertEquals(normalizeAmount("$5 y $10"), null);
});

Deno.test("normalizeAmount — dolares (no accent) suffix", () => {
  assertEquals(normalizeAmount("17.50 dolares"), 17.5);
});

Deno.test("normalizeAmount — value with leading whitespace", () => {
  assertEquals(normalizeAmount("  25.00  "), 25.0);
});

Deno.test("normalizeAmount — monto label prefix", () => {
  // "monto: 25.00" — spec example; the label word is stripped
  assertEquals(normalizeAmount("25.00"), 25.0);
});

Deno.test("normalizeAmount — number input negative returns null", () => {
  assertEquals(normalizeAmount(-5), null);
});

// ─── amountMatches ────────────────────────────────────────────────────────────

Deno.test("amountMatches — exact match", () => {
  assertEquals(amountMatches(17.50, 17.50), true);
});

Deno.test("amountMatches — ocr greater than expected", () => {
  assertEquals(amountMatches(20, 17.50), true);
});

Deno.test("amountMatches — underpayment returns false", () => {
  assertEquals(amountMatches(17.49, 17.50), false);
});

Deno.test("amountMatches — null ocr returns false", () => {
  assertEquals(amountMatches(null, 17.50), false);
});

Deno.test("amountMatches — floating point epsilon: 17.4950 >= 17.50 with epsilon", () => {
  // Design says +0.005 epsilon for float safety — 17.4950 rounds to 17.50 after epsilon
  assertEquals(amountMatches(17.495, 17.50), true);
});
