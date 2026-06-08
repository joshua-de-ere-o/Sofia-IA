/**
 * __tests__/operator-redirect.test.ts — Deno tests for the operator self-service
 * redirect helpers in config.ts.
 *
 * When a WhatsApp message comes from an operator (Dra. Kely / staff) number, Sofía
 * must point them to the panel / Telegram bot instead of treating them as a patient.
 *
 * Run manually:
 *   deno test --allow-env supabase/functions/agent-runner/__tests__/operator-redirect.test.ts
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getOperatorWhatsappNumbers,
  isOperatorWhatsappNumber,
  operatorRedirectMessage,
  PANEL_URL,
  TELEGRAM_BOT_HANDLE,
} from "../config.ts";

Deno.test("getOperatorWhatsappNumbers — parses comma-separated env, trims, drops empties", () => {
  Deno.env.set("OPERATOR_WHATSAPP_NUMBERS", " +593997129263 , +593111111111 ,");
  assertEquals(getOperatorWhatsappNumbers(), ["+593997129263", "+593111111111"]);
});

Deno.test("getOperatorWhatsappNumbers — empty/unset env yields empty list", () => {
  Deno.env.delete("OPERATOR_WHATSAPP_NUMBERS");
  assertEquals(getOperatorWhatsappNumbers(), []);
});

Deno.test("isOperatorWhatsappNumber — matches a configured operator number only", () => {
  Deno.env.set("OPERATOR_WHATSAPP_NUMBERS", "+593997129263");
  assertEquals(isOperatorWhatsappNumber("+593997129263"), true);
  assertEquals(isOperatorWhatsappNumber("+593983480029"), false);
});

Deno.test("operatorRedirectMessage — points to the panel and the Telegram bot", () => {
  const msg = operatorRedirectMessage();
  assertStringIncludes(msg, PANEL_URL);
  assertStringIncludes(msg, TELEGRAM_BOT_HANDLE);
});
