import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assertManagerWithinFinance, nextManagerGrantStep,
  type ManagerGrantObservation } from "../src/manager-onboarding.ts";

const address = () => Keypair.generate().publicKey.toBase58();
const founder = address();
const finance = address();
const manager = address();
const parentAddress = address();
const scope = address();
const recipient = address();
const unrelated = address();
const ready: ManagerGrantObservation = {
  exists: true, delegated: true, visibleOnTee: true,
  permissionExists: true, privateReady: true, active: true,
};
const permitted = {
  founder, finance, manager, parentAddress, scope, perCap: 10, periodCap: 20,
  recipients: [recipient], policy: { founder, finance },
  parent: { address: parentAddress, grantor: founder, member: finance, role: 1,
    parent: PublicKey.default.toBase58(), active: true, revoked: false, mayDelegate: true,
    perPaymentCapMicro: "10", periodCapMicro: "50", scope: PublicKey.default.toBase58(),
    recipients: [recipient] },
};

test("Manager terms cannot exceed the active Finance grant", () => {
  assert.doesNotThrow(() => assertManagerWithinFinance(permitted));
  assert.throws(() => assertManagerWithinFinance({ ...permitted, perCap: 11 }), /exceeds/);
  assert.throws(() => assertManagerWithinFinance({ ...permitted, recipients: [unrelated] }), /exceeds/);
  assert.throws(() => assertManagerWithinFinance({ ...permitted,
    parent: { ...permitted.parent, active: false } }), /active Founder-issued/);
  assert.throws(() => assertManagerWithinFinance({ ...permitted,
    parent: { ...permitted.parent, revoked: true } }), /active Founder-issued/);
  assert.throws(() => assertManagerWithinFinance({ ...permitted,
    parent: { ...permitted.parent, mayDelegate: false } }), /active Founder-issued/);
  assert.throws(() => assertManagerWithinFinance({ ...permitted,
    parent: { ...permitted.parent, scope: unrelated } }), /exceeds/);
});

test("Manager limits are written only after the grant becomes private", () => {
  assert.equal(nextManagerGrantStep({ ...ready, exists: false }).operation, "createGrantShell");
  assert.equal(nextManagerGrantStep({ ...ready, delegated: false }).operation, "delegateGrant");
  assert.equal(nextManagerGrantStep({ ...ready, visibleOnTee: false }).status, "wait");
  assert.equal(nextManagerGrantStep({ ...ready, permissionExists: false }).operation, "initGrantPermission");
  assert.equal(nextManagerGrantStep({ ...ready, privateReady: false }).operation, "activateChildGrantPrivacy");
  assert.equal(nextManagerGrantStep({ ...ready, active: false }).operation, "configureGrant");
  assert.equal(nextManagerGrantStep(ready).status, "ready");
});
