/**
 * __tests__/payment-flow-await.test.ts — Regression guard for fire-and-forget bug
 *
 * Run:
 *   cd supabase/functions/agent-runner
 *   deno test --allow-env --allow-net --allow-read __tests__/payment-flow-await.test.ts
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("payment-flow.ts awaits notifyPaymentPendingApproval (regression: fire-and-forget killed by edge runtime)", async () => {
  const src = await Deno.readTextFile(new URL("../payment-flow.ts", import.meta.url));
  assert(
    /await\s+notifyPaymentPendingApproval\s*\(/.test(src),
    "payment-flow.ts must `await notifyPaymentPendingApproval(...)` — fire-and-forget makes Supabase Edge Runtime terminate the Telegram fetch before completion.",
  );
});

Deno.test("payment-flow.ts anchors cita timestamp to Ecuador time (regression: 2026-05-26 caption showed 24/05 05:00 AM for a 25/05 10:00 AM cita)", async () => {
  const src = await Deno.readTextFile(new URL("../payment-flow.ts", import.meta.url));
  assert(
    /new Date\(`\$\{cita\.fecha\}T\$\{cita\.hora\}-05:00`\)/.test(src),
    "payment-flow.ts must anchor the cita timestamp with `-05:00` — without it, JS parses the naive string as UTC and toLocaleString to America/Guayaquil subtracts 5 hours.",
  );
});
