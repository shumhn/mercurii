import assert from "node:assert/strict";
import { test } from "node:test";
import { nextFinanceGrantStep, type FinanceGrantObservation } from "../src/finance-onboarding.ts";

const ready: FinanceGrantObservation = {
  exists: true, delegated: true, visibleOnTee: true,
  permissionExists: true, privateReady: true, active: true,
};

test("Finance grant setup keeps caps and recipient list private until permission activation", () => {
  const steps: Array<[keyof FinanceGrantObservation, string]> = [
    ["exists", "prepareGrant"],
    ["delegated", "delegateGrant"],
    ["permissionExists", "activateRootGrant"],
    ["privateReady", "activateRootGrantPrivacy"],
    ["active", "configureGrant"],
  ];
  for (const [missing, operation] of steps) {
    assert.equal(nextFinanceGrantStep({ ...ready, [missing]: false }).operation, operation);
  }
  assert.equal(nextFinanceGrantStep(ready).status, "ready");
  assert.equal(nextFinanceGrantStep({ ...ready, visibleOnTee: false }).status, "wait");
});
