import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { deactivatePayee, linkPaymentPayee, listPayees, matchPayee, paymentPayee, registerPayee } from "../src/payee-journal.ts";

test("payees classify payments without storing recipient wallets or granting spend access", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payees-"));
  const previous = process.env.MERCURY_PAYEE_JOURNAL;
  const file = join(directory, "payees.json");
  process.env.MERCURY_PAYEE_JOURNAL = file;
  try {
    const company = Keypair.generate().publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const other = Keypair.generate().publicKey.toBase58();
    const payeeId = randomUUID();
    const paymentId = randomUUID();
    const input = { payeeId, kind: "contractor", recipient, teamId: "design" };
    assert.equal(registerPayee(company, input).kind, "contractor");
    assert.equal(registerPayee(company, input).payeeId, payeeId);
    assert.equal(listPayees(company).length, 1);
    assert.equal(matchPayee(company, payeeId, recipient).teamId, "design");
    assert.throws(() => matchPayee(company, payeeId, other), /does not match/);
    assert.throws(() => registerPayee(company, { ...input, recipient: other }), /different details/);
    assert.equal(linkPaymentPayee(company, paymentId, payeeId).payeeId, payeeId);
    assert.equal(paymentPayee(company, paymentId)?.kind, "contractor");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, "utf8").includes(recipient), false);
    deactivatePayee(company, payeeId);
    assert.throws(() => matchPayee(company, payeeId, recipient), /does not match/);
    assert.equal(paymentPayee(company, paymentId)?.payeeId, payeeId);
  } finally {
    if (previous === undefined) delete process.env.MERCURY_PAYEE_JOURNAL;
    else process.env.MERCURY_PAYEE_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
