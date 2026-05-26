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
