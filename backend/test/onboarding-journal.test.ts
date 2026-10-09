import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { confirmOnboardingReceipt, confirmedOnboardingStep, recordOnboardingBuild,
  waitForCleanupReceipt, hasConfirmedRecipientDeposit } from "../src/onboarding-journal.ts";

test("onboarding journal binds an unsigned build to its exact signed message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-onboarding-"));
  const previous = process.env.MERCURY_ONBOARDING_JOURNAL;
  const path = join(directory, "receipts.json");
  process.env.MERCURY_ONBOARDING_JOURNAL = path;
  try {
    const founder = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    const build = (lamports: number) => {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: founder.publicKey, toPubkey: recipient, lamports,
      }));
      tx.feePayer = founder.publicKey;
      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
      return tx;
    };
    const tx = build(1);
    const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const receipt = recordOnboardingBuild({
      company: founder.publicKey.toBase58(), target: recipient.toBase58(),
      operation: "initGrantPermission", chain: "ephemeral", transactionBase64: unsigned,
    });
    const created = Date.parse(receipt.createdAt);
    assert.equal(waitForCleanupReceipt(receipt, created + 60_000), true);
    assert.equal(waitForCleanupReceipt(receipt, created + 5 * 60_000), false);
    assert.equal(confirmedOnboardingStep(receipt.company, receipt.target, receipt.operation), false);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).receipts[0].id, receipt.id);
    await assert.rejects(() => confirmOnboardingReceipt(receipt.id, unsigned, ""), /does not match/);
    const different = build(2);
    different.sign(founder);
    await assert.rejects(() => confirmOnboardingReceipt(receipt.id,
      different.serialize().toString("base64"), ""), /does not match/);
    tx.sign(founder);
    const confirmed = await confirmOnboardingReceipt(receipt.id, tx.serialize().toString("base64"),
      "token", async () => ({ err: null, confirmationStatus: "confirmed" }));
    assert.equal(confirmed.status, "confirmed");
    assert.equal(waitForCleanupReceipt(confirmed), false);
    assert.equal(confirmedOnboardingStep(receipt.company, receipt.target, receipt.operation), true);

    const v0Message = new TransactionMessage({
      payerKey: founder.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: founder.publicKey, toPubkey: recipient, lamports: 1 })],
    }).compileToV0Message();
    const v0 = new VersionedTransaction(v0Message);
    const v0Receipt = recordOnboardingBuild({
      company: founder.publicKey.toBase58(), target: recipient.toBase58(),
      operation: "recipientDeposit", chain: "base",
      transactionBase64: Buffer.from(v0.serialize()).toString("base64"),
    });
    v0.sign([founder]);
    const v0Confirmed = await confirmOnboardingReceipt(v0Receipt.id,
      Buffer.from(v0.serialize()).toString("base64"), "token",
      async () => ({ err: null, confirmationStatus: "confirmed" }));
    assert.equal(v0Confirmed.status, "confirmed");
    assert.equal(hasConfirmedRecipientDeposit(recipient.toBase58()), false);

    const registrationTx = build(3);
    const registrationUnsigned = registrationTx.serialize({ requireAllSignatures: false,
      verifySignatures: false }).toString("base64");
    const registered = recordOnboardingBuild({
      company: founder.publicKey.toBase58(), target: `${recipient.toBase58()}:initial`,
      operation: "recipientDeposit", chain: "base", transactionBase64: registrationUnsigned,
    });
    registrationTx.sign(founder);
    await confirmOnboardingReceipt(registered.id, registrationTx.serialize().toString("base64"), "token",
      async () => ({ err: null, confirmationStatus: "confirmed" }));
    assert.equal(hasConfirmedRecipientDeposit(recipient.toBase58()), true);
  } finally {
    if (previous === undefined) delete process.env.MERCURY_ONBOARDING_JOURNAL;
    else process.env.MERCURY_ONBOARDING_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
