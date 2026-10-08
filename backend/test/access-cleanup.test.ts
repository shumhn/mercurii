import assert from "node:assert/strict";
import { test } from "node:test";
import { financeCleanupReaderPlan } from "../src/finance-cleanup.ts";
import { managerCleanupReaderPlan } from "../src/manager-cleanup.ts";

test("Finance revocation preserves the assigned Manager reader", () => {
  const recorded = { includeFinance: true, manager: "manager-wallet" };
  assert.deepEqual(financeCleanupReaderPlan("finance-wallet", "requester-wallet", recorded),
    { manager: "manager-wallet" });
  assert.equal(financeCleanupReaderPlan("finance-wallet", "requester-wallet", undefined), null);
  assert.equal(financeCleanupReaderPlan("finance-wallet", "requester-wallet",
    { includeFinance: false, manager: null }), null);
});

test("Manager revocation never re-adds a revoked Finance reader", () => {
  const recorded = { includeFinance: true, manager: "manager-wallet" };
  assert.deepEqual(managerCleanupReaderPlan("manager-wallet", recorded, true), { includeFinance: true });
  assert.deepEqual(managerCleanupReaderPlan("manager-wallet", recorded, false), { includeFinance: false });
  assert.equal(managerCleanupReaderPlan("other-manager", recorded, true), null);
  assert.equal(managerCleanupReaderPlan("manager-wallet", undefined, true), null);
});
