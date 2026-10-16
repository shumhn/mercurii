import assert from "node:assert/strict";
import test from "node:test";
import { formatUsdc, founderNeedsPrivateSetup, parseUsdc, setupPolicyLimits } from "../lib/mercurii-client.ts";

test("USDC display preserves micro precision and signed budget differences", () => {
  assert.equal(formatUsdc("123456789"), "123.456789 USDC");
  assert.equal(formatUsdc("-1"), "−0.000001 USDC");
  assert.equal(formatUsdc("-123456789"), "−123.456789 USDC");
  assert.equal(formatUsdc("0"), "0 USDC");
  assert.equal(formatUsdc(null), "—");
});

test("USDC input accepts exact decimals and rejects zero or excess precision", () => {
  assert.equal(parseUsdc("12.345678"), 12345678);
  assert.throws(() => parseUsdc("0"));
  assert.throws(() => parseUsdc("1.0000001"));
});

test("privacy resume preserves an existing spending policy", () => {
  assert.deepEqual(setupPolicyLimits({
    editing: false,
    monthlyLimit: "",
    agentCap: "",
    current: { monthlyLimitMicro: "5000000000", agentCapMicro: "500000000" },
  }), { monthlyLimitMicro: 5000000000, agentCapMicro: 500000000 });
  assert.deepEqual(setupPolicyLimits({ editing: false, monthlyLimit: "", agentCap: "" }),
    { monthlyLimitMicro: 0, agentCapMicro: 0 });
});

test("a completed setup never redirects to privacy after a transient read failure", () => {
  assert.equal(founderNeedsPrivateSetup({
    role: "founder", sessionKey: "company:owner", completedSession: "company:owner",
    policyState: "error", snapshotState: "ready",
  }), false);
  assert.equal(founderNeedsPrivateSetup({
    role: "founder", sessionKey: "company:owner", completedSession: "",
    policyState: "error", snapshotState: "error",
  }), true);
});
