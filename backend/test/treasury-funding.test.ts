import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTreasuryFundingStep, resumableFundingTarget } from "../src/treasury-funding.ts";

test("funding does not repeat a submitted private deposit before credit is observed", () => {
  assert.equal(nextTreasuryFundingStep(null, 10, null), "build_deposit");
  assert.equal(nextTreasuryFundingStep(null, 10, "built"), "wait_for_receipt");
  assert.equal(nextTreasuryFundingStep(null, 10, "pending"), "wait_for_receipt");
  assert.equal(nextTreasuryFundingStep(null, 10, "confirmed"), "build_snapshot_sync");
  assert.equal(nextTreasuryFundingStep("9", 10, "confirmed"), "build_snapshot_sync");
  assert.equal(nextTreasuryFundingStep("10", 10, "confirmed"), "ready");
  assert.equal(nextTreasuryFundingStep("10", 10, null), "ready");
  assert.equal(nextTreasuryFundingStep(null, 10, "failed"), "build_deposit");
});

test("funding recovery resumes a confirmed deposit without creating another deposit", () => {
  const deposit = { target: "company:funding-1", operation: "privateReceive" as const, status: "confirmed" as const };
  assert.equal(resumableFundingTarget([deposit]), deposit.target);
  assert.equal(resumableFundingTarget([deposit, {
    target: deposit.target, operation: "syncTreasurySnapshot", status: "built",
  }]), deposit.target);
  assert.equal(resumableFundingTarget([deposit, {
    target: deposit.target, operation: "syncTreasurySnapshot", status: "confirmed",
  }]), null);
});
