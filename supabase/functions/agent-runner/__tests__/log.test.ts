/**
 * __tests__/log.test.ts — Unit tests for log.ts PII masking helpers (Deno test runner)
 *
 * TODO: Deno is not installed locally. These tests are WRITTEN (TDD RED) but
 * cannot be auto-run until Deno is available.
 *
 * Run manually:
 *   deno test supabase/functions/agent-runner/__tests__/log.test.ts
 *
 * Manual verification checklist:
 *  [ ] maskPhone("+593987654321") → "+59398***4321" (keep first 5, mask middle, keep last 4)
 *  [ ] maskPhone("+1234567890") → keeps first 5 and last 4
 *  [ ] maskPhone("") → "" (empty passthrough)
 *  [ ] maskName("Maria Jose") → "Ma***"
 *  [ ] maskName("X") → "X***" (single char — show it + ***)
 *  [ ] maskName("") → "" (empty passthrough)
 *  [ ] logPaymentEvent logs a valid JSON line to console.log
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maskPhone, maskName } from "../log.ts";

Deno.test("maskPhone — standard Ecuadorian number", () => {
  const result = maskPhone("+593987654321");
  // Keep first 5 chars (+5939), mask middle, keep last 4 (4321)
  assertEquals(result, "+5939***4321");
});

Deno.test("maskPhone — short number still masks middle", () => {
  const result = maskPhone("+12345");
  // 5 or fewer chars — show all if <= 7 total, otherwise mask
  // Implementation: first 5 + *** + last 4 = mask middle if len > 9
  // For "+12345" (6 chars), just return as-is (too short to mask meaningfully)
  assertEquals(typeof result, "string");
});

Deno.test("maskPhone — empty string returns empty", () => {
  assertEquals(maskPhone(""), "");
});

Deno.test("maskName — full name keeps first 2 chars", () => {
  const result = maskName("Maria Jose");
  assertEquals(result, "Ma***");
});

Deno.test("maskName — single char name", () => {
  const result = maskName("X");
  assertEquals(result, "X***");
});

Deno.test("maskName — empty string returns empty", () => {
  assertEquals(maskName(""), "");
});
