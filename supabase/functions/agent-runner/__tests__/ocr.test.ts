/**
 * __tests__/ocr.test.ts — Unit tests for ocr.ts (Deno test runner)
 *
 * TODO: Deno is not installed in the local dev environment (Windows).
 * These tests are WRITTEN (TDD RED) but cannot be auto-run via CI yet.
 *
 * MANUAL TEST PLAN (run after installing Deno or in Supabase edge function dev):
 *   deno test supabase/functions/agent-runner/__tests__/ocr.test.ts
 *   (requires: Deno 1.40+ with --allow-env --allow-net flags or mock setup)
 *
 * To install Deno on Windows: https://deno.com/manual/getting_started/installation
 *   iwr https://deno.land/install.ps1 -useb | iex
 *
 * Manual verification checklist (until Deno CI is set up):
 *  [ ] Happy path: Gemini returns {"monto": 17.5, "es_comprobante": true}
 *      → extractAmountFromReceipt returns { monto: 17.5, es_comprobante: true }
 *  [ ] Non-receipt: {"monto": null, "es_comprobante": false}
 *      → returns { monto: null, es_comprobante: false }
 *  [ ] Fenced JSON: ```json\n{"monto":17.5,...}\n```
 *      → parses correctly
 *  [ ] Timeout: mock fetch hangs > 8s → resolves with monto: null within ~8.1s
 *  [ ] HTTP 500 → graceful { monto: null, es_comprobante: true, raw: "http_500" }
 *  [ ] Missing API key (GEMINI_API_KEY unset) → { monto: null, es_comprobante: true, raw: "no_api_key" }
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { OcrResult } from "../ocr.ts";

// Helper: replace globalThis.fetch with a mock for the duration of a test
function withMockedFetch(mockFn: typeof fetch, testFn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mockFn;
  return testFn().finally(() => {
    globalThis.fetch = original;
  });
}

// We import the function lazily to avoid Deno.env reads at module level in tests
const { extractAmountFromReceipt } = await import("../ocr.ts");

Deno.test("extractAmountFromReceipt — happy path: valid receipt with readable amount", async () => {
  await withMockedFetch(
    (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"monto": 17.5, "es_comprobante": true}' }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    async () => {
      // Set env for test
      Deno.env.set("GEMINI_API_KEY", "test-key");
      const result: OcrResult = await extractAmountFromReceipt("https://example.com/receipt.jpg");
      assertEquals(result.monto, 17.5);
      assertEquals(result.es_comprobante, true);
    },
  );
});

Deno.test("extractAmountFromReceipt — non-receipt image: selfie/meme", async () => {
  await withMockedFetch(
    (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"monto": null, "es_comprobante": false}' }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    async () => {
      Deno.env.set("GEMINI_API_KEY", "test-key");
      const result = await extractAmountFromReceipt("https://example.com/selfie.jpg");
      assertEquals(result.monto, null);
      assertEquals(result.es_comprobante, false);
    },
  );
});

Deno.test("extractAmountFromReceipt — fenced JSON response parses correctly", async () => {
  await withMockedFetch(
    (_url, _init) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "```json\n{\"monto\":17.5,\"es_comprobante\":true}\n```" }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    async () => {
      Deno.env.set("GEMINI_API_KEY", "test-key");
      const result = await extractAmountFromReceipt("https://example.com/receipt.jpg");
      assertEquals(result.monto, 17.5);
      assertEquals(result.es_comprobante, true);
    },
  );
});

Deno.test("extractAmountFromReceipt — HTTP 500 → graceful null", async () => {
  await withMockedFetch(
    (_url, _init) =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    async () => {
      Deno.env.set("GEMINI_API_KEY", "test-key");
      const result = await extractAmountFromReceipt("https://example.com/receipt.jpg");
      assertEquals(result.monto, null);
      assertEquals(result.raw.includes("http_500") || result.raw === "http_500", true);
    },
  );
});

Deno.test("extractAmountFromReceipt — missing API key → graceful null", async () => {
  Deno.env.delete("GEMINI_API_KEY");
  const result = await extractAmountFromReceipt("https://example.com/receipt.jpg");
  assertEquals(result.monto, null);
  assertEquals(result.raw, "no_api_key");
});

// Note: timeout test (mock fetch that hangs 9s) is omitted from automated suite
// because it would make CI slow. Test manually with:
//   const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
//   mock fetch to: await delay(9000); return new Response("...");
//   assert result arrives within ~8.5s with monto: null
