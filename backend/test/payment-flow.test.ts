import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { applyConfirmedReaderCleanup, getOrCreatePaymentFlow, nextPaymentFlowStep, recordedRequestReaders,
  type PaymentFlowObservation } from "../src/payment-flow.ts";

const ready: PaymentFlowObservation = {
  exists: true, delegated: true, visibleOnTee: true, permissionExists: true,
  privateReady: true, status: "empty",
};

test("guided payment flow keeps recipient and amount out of its durable journal", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payment-flow-"));
  const previous = process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
  const file = join(directory, "flows.json");
  process.env.MERCURY_PAYMENT_FLOW_JOURNAL = file;
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const requester = Keypair.generate().publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const id = randomUUID();
    const body = { requester, recipient, amountMicro: 42, includeFinance: true };
    const first = getOrCreatePaymentFlow(id, company, body);
    const repeat = getOrCreatePaymentFlow(id, company, body);
    assert.equal(repeat.flow.request, first.flow.request);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const disk = JSON.parse(readFileSync(file, "utf8")) as { flows: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(disk.flows[0]!).sort(),
      ["company", "createdAt", "includeFinance", "manager", "paymentId", "request", "requestId", "requester", "termsHash"].sort());
    assert.equal(readFileSync(file, "utf8").includes(recipient), false);
    assert.deepEqual(recordedRequestReaders(company).get(first.flow.request),
      { requester, includeFinance: true, manager: null });
    applyConfirmedReaderCleanup(company, first.flow.request, "finance");
    assert.equal(recordedRequestReaders(company).get(first.flow.request)?.includeFinance, false);
    assert.throws(() => getOrCreatePaymentFlow(id, company, { ...body, amountMicro: 43 }), /different private request terms/);
    assert.throws(() => getOrCreatePaymentFlow(randomUUID(), company, { ...body, requester: recipient }), /Requester cannot/);
  } finally {
    if (previous === undefined) delete process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
    else process.env.MERCURY_PAYMENT_FLOW_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("guided payment flow never writes payment terms before private request access", () => {
  const requester = Keypair.generate().publicKey.toBase58();
  const founder = Keypair.generate().publicKey.toBase58();
  const flow = { paymentId: randomUUID(), company: Keypair.generate().publicKey.toBase58(), requester,
    request: Keypair.generate().publicKey.toBase58(), requestId: "1", termsHash: "hash", createdAt: "now" };
  const cases: Array<[Partial<PaymentFlowObservation>, string | null]> = [
    [{ exists: false }, "createRequestShell"],
    [{ delegated: false }, "delegateRequest"],
    [{ visibleOnTee: false }, null],
    [{ permissionExists: false }, "initRequestPermission"],
    [{ privateReady: false }, "activateRequestPrivacy"],
    [{ status: "empty" }, "submitPayment"],
    [{ status: "submitted" }, "approvePayment"],
    [{ status: "approved" }, null],
    [{ status: "executed" }, null],
  ];
  for (const [change, operation] of cases) {
    const step = nextPaymentFlowStep({ ...ready, ...change }, flow, founder);
    assert.equal(step.operation, operation);
  }
  assert.equal(nextPaymentFlowStep({ ...ready, privateReady: false }, flow, founder).actor, founder);
  assert.equal(nextPaymentFlowStep({ ...ready, status: "empty" }, flow, founder).actor, requester);
  assert.equal(nextPaymentFlowStep({ ...ready, status: "approved" }, flow, founder).status, "ready_to_execute");
});
