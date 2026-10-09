import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentRecord } from "../src/payment-journal.ts";
import { paymentRecoveryAction } from "../src/reconciliation.ts";

const record = (state: PaymentRecord["state"]): PaymentRecord => ({
  paymentId: "a", company: "b", request: "c", requester: "d", requestId: "1",
  actor: "d", preparedMessageHash: "hash", preparedBlockhash: "blockhash", signature: "sig",
  state, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

test("reconciliation never recommends a replacement for missing or uncertain signatures", () => {
  for (const chainStatus of ["not_found", "processed", "unavailable"] as const) {
    assert.equal(paymentRecoveryAction({ record: record("submitted"), requestStatus: "approved",
      chainStatus, executionSlot: null, snapshotSlot: "10" }), "wait_or_investigate_original_signature");
  }
  assert.equal(paymentRecoveryAction({ record: record("failed"), requestStatus: "approved",
    chainStatus: "failed", executionSlot: null, snapshotSlot: "10" }), "retry_confirmed_failure");
  assert.equal(paymentRecoveryAction({ record: record("settled"), requestStatus: "executed",
    chainStatus: "confirmed", executionSlot: 12, snapshotSlot: "10" }), "sign_snapshot_sync");
  assert.equal(paymentRecoveryAction({ record: record("settled"), requestStatus: "executed",
    chainStatus: "confirmed", executionSlot: 12, snapshotSlot: "12" }), "complete");
});
