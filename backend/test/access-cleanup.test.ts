import assert from "node:assert/strict";
import { test } from "node:test";
import { financeRequestNeedsReset } from "../src/finance-cleanup.ts";
import { managerRequestNeedsReset } from "../src/manager-cleanup.ts";

test("Finance cleanup includes Finance-owned and explicitly shared requests", () => {
  const recorded = { includeFinance: true, manager: "manager-wallet" };
  assert.equal(financeRequestNeedsReset("finance-wallet", "requester-wallet", recorded), true);
  assert.equal(financeRequestNeedsReset("finance-wallet", "finance-wallet", undefined), true);
  assert.equal(financeRequestNeedsReset("finance-wallet", "requester-wallet", undefined), false);
  assert.equal(financeRequestNeedsReset("finance-wallet", "requester-wallet",
    { includeFinance: false, manager: null }), false);
});

test("Manager cleanup includes Manager-owned and explicitly shared requests", () => {
  const recorded = { includeFinance: true, manager: "manager-wallet" };
  assert.equal(managerRequestNeedsReset("manager-wallet", "requester-wallet", recorded), true);
  assert.equal(managerRequestNeedsReset("manager-wallet", "manager-wallet", undefined), true);
  assert.equal(managerRequestNeedsReset("other-manager", "requester-wallet", recorded), false);
  assert.equal(managerRequestNeedsReset("manager-wallet", "requester-wallet", undefined), false);
});
