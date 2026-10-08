import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createPayrollRun, getPayrollRun } from "../src/payroll-run.ts";
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
    assert.throws(() => createPayrollRun(randomUUID(), company, { requester,
      items: [input.items[0]] }), /2 to 4/);
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
