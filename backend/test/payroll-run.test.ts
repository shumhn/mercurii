import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createPayrollRun, getPayrollRun, listPayrollRuns, payrollNextAction, summarizePayroll } from "../src/payroll-run.ts";
import { getPaymentFlow } from "../src/payment-flow.ts";

test("payroll run binds employee items once without persisting salaries or recipient wallets", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payroll-"));
  const priorRun = process.env.MERCURY_PAYROLL_JOURNAL;
  const priorFlow = process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
  const runFile = join(directory, "runs.json");
  const flowFile = join(directory, "flows.json");
  process.env.MERCURY_PAYROLL_JOURNAL = runFile;
  process.env.MERCURY_PAYMENT_FLOW_JOURNAL = flowFile;
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const requester = Keypair.generate().publicKey.toBase58();
    const first = Keypair.generate().publicKey.toBase58();
    const second = Keypair.generate().publicKey.toBase58();
    const runId = randomUUID();
    const input = { requester, items: [
      { recipient: first, amountMicro: 1234567 },
      { recipient: second, amountMicro: 7654321 },
    ] };
    const run = createPayrollRun(runId, company, input);
    assert.equal(run.items.length, 2);
    assert.notEqual(run.items[0]!.paymentId, run.items[1]!.paymentId);
    assert.deepEqual(createPayrollRun(runId, company, input), run);
    assert.deepEqual(getPayrollRun(runId, company), run);
    assert.deepEqual(listPayrollRuns(company), [{ runId, createdAt: run.createdAt, itemCount: 2 }]);
    assert.deepEqual(listPayrollRuns(Keypair.generate().publicKey.toBase58()), []);
    for (const item of run.items) {
      assert.equal(getPaymentFlow(item.paymentId, company).request, item.request);
    }
    assert.equal(statSync(runFile).mode & 0o777, 0o600);
    const durable = readFileSync(runFile, "utf8") + readFileSync(flowFile, "utf8");
    for (const secret of [first, second, "1234567", "7654321"]) {
      assert.equal(durable.includes(secret), false);
    }
    assert.throws(() => createPayrollRun(runId, company, { requester, items: [
      input.items[0], { recipient: second, amountMicro: 7654322 },
    ] }), /different employees or amounts/);
    assert.throws(() => createPayrollRun(randomUUID(), company, { requester,
      items: [input.items[0], input.items[0]] }), /only once/);
    const five = Array.from({ length: 5 }, () => ({
      recipient: Keypair.generate().publicKey.toBase58(), amountMicro: 1,
    }));
    assert.equal(createPayrollRun(randomUUID(), company, { requester, items: five }).items.length, 5);
    assert.equal(listPayrollRuns(company)[0]?.itemCount, 5);
    assert.throws(() => createPayrollRun(randomUUID(), company, { requester,
      items: [] }), /1 to 100/);
    const pda = PublicKey.findProgramAddressSync([Buffer.from("employee")], Keypair.generate().publicKey)[0];
    assert.throws(() => createPayrollRun(randomUUID(), company, { requester,
      items: [input.items[0], { recipient: pda.toBase58(), amountMicro: 1 }] }), /wallet owner/);
  } finally {
    if (priorRun === undefined) delete process.env.MERCURY_PAYROLL_JOURNAL;
    else process.env.MERCURY_PAYROLL_JOURNAL = priorRun;
    if (priorFlow === undefined) delete process.env.MERCURY_PAYMENT_FLOW_JOURNAL;
    else process.env.MERCURY_PAYMENT_FLOW_JOURNAL = priorFlow;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("payroll progress only retries failed approved items and keeps amounts balanced", () => {
  const items = [
    { paymentId: randomUUID(), requestStatus: "executed", paymentState: "settled", amountMicro: "1000000" },
    { paymentId: randomUUID(), requestStatus: "approved", paymentState: "failed", amountMicro: "2000000" },
    { paymentId: randomUUID(), requestStatus: "approved", paymentState: "submitted", amountMicro: "3000000" },
    { paymentId: randomUUID(), requestStatus: "empty", paymentState: null, amountMicro: null },
  ];
  const summary = summarizePayroll(items);
  assert.equal(summary.knownTotalMicro, "6000000");
  assert.equal(summary.state, "partial");
  assert.equal(summary.settledMicro, "1000000");
  assert.equal(summary.failedMicro, "2000000");
  assert.equal(summary.pendingMicro, "3000000");
  assert.deepEqual(summary.retryablePaymentIds, [items[1]!.paymentId]);
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.unsubmittedCount, 1);
  assert.equal(summary.approvalPendingCount, 0);
  assert.equal(payrollNextAction(items[2]!), "reconcile_or_resend_same_signature");
  assert.equal(payrollNextAction(items[0]!), "complete");
});

test("payroll state reflects paid, failed, and approval phases", () => {
  const item = (requestStatus: string, paymentState: string | null = null) =>
    ({ paymentId: randomUUID(), requestStatus, paymentState, amountMicro: "100" });
  assert.equal(summarizePayroll([item("empty")]).state, "preparing");
  assert.equal(summarizePayroll([item("submitted")]).state, "approval_pending");
  assert.equal(summarizePayroll([item("approved", "submitted")]).state, "paying");
  assert.equal(summarizePayroll([item("approved", "failed")]).state, "failed");
  assert.equal(summarizePayroll([item("rejected")]).state, "rejected");
  assert.equal(summarizePayroll([item("executed", "settled")]).state, "paid");
});
