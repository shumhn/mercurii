import assert from "node:assert/strict";
import { test } from "node:test";
import { nextOnboardingStep, type OnboardingObservation } from "../src/onboarding.ts";

const ready: OnboardingObservation = {
  companyExists: true, companyDelegated: true, companyVisibleOnTee: true,
  companyPermissionExists: true, companyPrivate: true, limitsMatch: true,
  snapshotExists: true, snapshotDelegated: true, snapshotVisibleOnTee: true,
  snapshotPermissionExists: true, snapshotPrivate: true,
};

test("company setup never writes confidential limits before PER privacy", () => {
  const steps: Array<[keyof OnboardingObservation, string]> = [
    ["companyExists", "initializeCompany"],
    ["companyDelegated", "delegateCompany"],
    ["companyPermissionExists", "initCompanyPermission"],
    ["companyPrivate", "activateCompanyPrivacy"],
    ["limitsMatch", "configureLimits"],
    ["snapshotExists", "createSnapshotShell"],
    ["snapshotDelegated", "delegateSnapshot"],
    ["snapshotPermissionExists", "initSnapshotPermission"],
    ["snapshotPrivate", "activateSnapshotPrivacy"],
  ];
  for (const [missing, operation] of steps) {
    assert.equal(nextOnboardingStep({ ...ready, [missing]: false }).operation, operation, missing);
  }
  assert.equal(nextOnboardingStep(ready).status, "ready");
});

test("delegation propagation pauses instead of rebuilding or writing on base", () => {
  assert.equal(nextOnboardingStep({ ...ready, companyVisibleOnTee: false }).status, "wait");
  assert.equal(nextOnboardingStep({ ...ready, snapshotVisibleOnTee: false }).status, "wait");
});
