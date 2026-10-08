import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { bindSignedPayment, getPayment, preparePayment, reconcilePayment, registerPayment } from "../src/payment-journal.ts";

test("payment journal binds one opaque ID to one request and one signed execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payment-"));
  const previous = process.env.MERCURY_PAYMENT_JOURNAL;
  const file = join(directory, "payments.json");
  process.env.MERCURY_PAYMENT_JOURNAL = file;
  try {
    const actor = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    const request = Keypair.generate().publicKey.toBase58();
    const otherRequest = Keypair.generate().publicKey.toBase58();
    const id = randomUUID();
    const args = { paymentId: id, company: actor.publicKey.toBase58(), request,
      requester: actor.publicKey.toBase58(), requestId: "17" };
    assert.equal(registerPayment(args).state, "registered");
    assert.equal(registerPayment(args).request, request);
    assert.throws(() => registerPayment({ ...args, request: otherRequest }), /already bound/);
    assert.throws(() => registerPayment({ ...args, paymentId: randomUUID() }), /already bound/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const build = (lamports: number) => {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: actor.publicKey, toPubkey: recipient, lamports,
      }));
      tx.feePayer = actor.publicKey;
      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
      return tx;
    };
    const tx = build(1);
    const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    assert.equal(preparePayment(id, args.company, args.requester, unsigned).state, "prepared");
    assert.throws(() => preparePayment(id, args.company, args.requester, unsigned), /already has/);
    const wrong = build(2);
    wrong.sign(actor);
    assert.throws(() => bindSignedPayment(id, args.company, wrong.serialize().toString("base64")), /does not match/);
    assert.throws(() => bindSignedPayment(id, args.company, unsigned), /invalid signatures/);
    tx.sign(actor);
    const signed = tx.serialize().toString("base64");
    const submitted = bindSignedPayment(id, args.company, signed);
    assert.equal(submitted.state, "submitted");
    assert.equal(bindSignedPayment(id, args.company, signed).signature, submitted.signature);
    assert.equal(reconcilePayment(id, args.company, "approved", "not_found").state, "submitted");
    assert.equal(reconcilePayment(id, args.company, "executed", "not_found").state, "settled");
    assert.equal(bindSignedPayment(id, args.company, signed).state, "settled");
    assert.equal(getPayment(id, args.company).state, "settled");
    const disk = readFileSync(file, "utf8");
    assert.ok(!disk.includes("lamports"));
    assert.ok(!disk.includes(recipient.toBase58()));
    assert.ok(!disk.includes(signed));
  } finally {
    if (previous === undefined) delete process.env.MERCURY_PAYMENT_JOURNAL;
    else process.env.MERCURY_PAYMENT_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed chain signature can prepare a replacement only after reconciliation", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-payment-"));
  const previous = process.env.MERCURY_PAYMENT_JOURNAL;
  process.env.MERCURY_PAYMENT_JOURNAL = join(directory, "payments.json");
  try {
    const actor = Keypair.generate();
    const id = randomUUID();
    const company = actor.publicKey.toBase58();
    registerPayment({ paymentId: id, company, request: Keypair.generate().publicKey.toBase58(),
      requester: company, requestId: "1" });
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: actor.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1,
    }));
    tx.feePayer = actor.publicKey;
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    preparePayment(id, company, company, tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"));
    tx.sign(actor);
    bindSignedPayment(id, company, tx.serialize().toString("base64"));
    assert.throws(() => preparePayment(id, company, company, tx.serialize().toString("base64")), /already has/);
    assert.equal(reconcilePayment(id, company, "approved", "failed").state, "failed");
    assert.equal(preparePayment(id, company, company, tx.serialize().toString("base64")).state, "prepared");
  } finally {
    if (previous === undefined) delete process.env.MERCURY_PAYMENT_JOURNAL;
    else process.env.MERCURY_PAYMENT_JOURNAL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
