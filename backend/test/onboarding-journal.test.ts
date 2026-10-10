import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { confirmOnboardingReceipt, confirmedOnboardingStep, expireUnsignedOnboardingReceipt, getOnboardingReceipt, listOnboardingReceipts,
  reconcileOnboardingReceipt, recordOnboardingBuild,
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
    assert.equal(getOnboardingReceipt(receipt.id, receipt.company).status, "built");
    assert.equal(listOnboardingReceipts(receipt.company).length, 1);
    assert.equal((await reconcileOnboardingReceipt(receipt.id, receipt.company, "token")).status, "built");
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
    assert.equal((await reconcileOnboardingReceipt(receipt.id, receipt.company, "token",
      async () => null)).status, "confirmed");

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

    const pendingTx = build(4);
    const pendingBuild = recordOnboardingBuild({ company: founder.publicKey.toBase58(),
      target: recipient.toBase58(), operation: "pendingSetup", chain: "ephemeral",
      transactionBase64: pendingTx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") });
    pendingTx.sign(founder);
    const signedPending = pendingTx.serialize().toString("base64");
    assert.equal((await confirmOnboardingReceipt(pendingBuild.id, signedPending, "token", async () => null)).status, "pending");
    assert.equal((await reconcileOnboardingReceipt(pendingBuild.id, pendingBuild.company, "token",
      async () => ({ err: null, confirmationStatus: "confirmed" }))).status, "confirmed");
    assert.equal((await confirmOnboardingReceipt(pendingBuild.id, signedPending, "token", async () => null)).status, "confirmed");

    const concurrentTx = build(5);
    const concurrent = recordOnboardingBuild({ company: founder.publicKey.toBase58(),
      target: recipient.toBase58(), operation: "concurrentSetup", chain: "ephemeral",
      transactionBase64: concurrentTx.serialize({ requireAllSignatures: false,
        verifySignatures: false }).toString("base64") });
    concurrentTx.sign(founder);
    await confirmOnboardingReceipt(concurrent.id, concurrentTx.serialize().toString("base64"), "token",
      async () => {
        const otherTx = build(6);
        recordOnboardingBuild({ company: founder.publicKey.toBase58(), target: recipient.toBase58(),
          operation: "otherSetup", chain: "ephemeral",
          transactionBase64: otherTx.serialize({ requireAllSignatures: false,
            verifySignatures: false }).toString("base64") });
        return { err: null, confirmationStatus: "confirmed" };
      });
    assert.equal(listOnboardingReceipts(concurrent.company).length, 6);

    const abandonedTx = build(7);
    const abandoned = recordOnboardingBuild({ company: founder.publicKey.toBase58(),
      target: recipient.toBase58(), operation: "abandonedStep", chain: "base",
      transactionBase64: abandonedTx.serialize({ requireAllSignatures: false,
        verifySignatures: false }).toString("base64") });
    assert.equal(abandoned.blockhash, abandonedTx.recentBlockhash);
    assert.equal((await expireUnsignedOnboardingReceipt(abandoned.id, abandoned.company, "",
      async () => { throw new Error("A fresh transaction must not be checked for expiry"); },
      Date.parse(abandoned.createdAt) + 89_999)).status, "built");
    assert.equal((await expireUnsignedOnboardingReceipt(abandoned.id, abandoned.company, "",
      async (chain, blockhash) => {
        assert.equal(chain, "base");
        assert.equal(blockhash, abandonedTx.recentBlockhash);
        return true;
      }, Date.parse(abandoned.createdAt) + 90_000)).status, "built");
    assert.equal((await expireUnsignedOnboardingReceipt(abandoned.id, abandoned.company, "",
      async () => false, Date.parse(abandoned.createdAt) + 90_000)).status, "expired");
    abandonedTx.sign(founder);
    await assert.rejects(() => confirmOnboardingReceipt(abandoned.id,
      abandonedTx.serialize().toString("base64"), "", async () => null), /expired/);
    assert.equal((await expireUnsignedOnboardingReceipt(pendingBuild.id, pendingBuild.company, "token",
      async () => { throw new Error("Signed receipts must not be expired"); })).status, "confirmed");
  } finally {
    if (previous === undefined) delete process.env.MERCURY_ONBOARDING_JOURNAL;
    else process.env.MERCURY_ONBOARDING_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
