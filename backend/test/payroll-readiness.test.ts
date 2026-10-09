import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { checkPayrollReadiness } from "../src/payroll-readiness.ts";

test("payroll readiness uses recipient onboarding evidence without reading private balances", async () => {
  const ready = Keypair.generate().publicKey.toBase58();
  const missing = Keypair.generate().publicKey.toBase58();
  const unavailable = Keypair.generate().publicKey.toBase58();
  const result = await checkPayrollReadiness({ items: [
    { recipient: ready, amountMicro: 1_000_000 },
    { recipient: missing, amountMicro: 2_000_000 },
    { recipient: unavailable, amountMicro: 3_000_000 },
  ], isRegistered: (recipient) => {
    if (recipient === unavailable) throw new Error("journal unavailable");
    return recipient === ready;
  } });
  assert.equal(result.totalMicro, "6000000");
  assert.equal(result.readyCount, 1);
  assert.deepEqual(result.items.map((item) => item.status), ["ready", "needs_onboarding", "unavailable"]);
  await assert.rejects(() => checkPayrollReadiness({ items: [
    { recipient: ready, amountMicro: 1 }, { recipient: ready, amountMicro: 1 },
  ] }), /only once/);
});
