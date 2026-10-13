import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { founderCompanyAddress, validateSignedCompanyBootstrap } from "../src/company-bootstrap.ts";
import { PROGRAM_ID } from "../src/operations.ts";

function transaction(founder: Keypair, recipient: PublicKey, lamports = 1) {
  const tx = new Transaction({ feePayer: founder.publicKey,
    recentBlockhash: PublicKey.default.toBase58() });
  tx.add(SystemProgram.transfer({ fromPubkey: founder.publicKey, toPubkey: recipient, lamports }));
  return tx;
}

test("company policy address is derived from the Founder and Mercury program", () => {
  const founder = Keypair.generate().publicKey;
  const expected = PublicKey.findProgramAddressSync([
    Buffer.from("company-policy"), founder.toBuffer(),
  ], PROGRAM_ID)[0];
  assert.equal(founderCompanyAddress(founder.toBase58()), expected.toBase58());
});

test("bootstrap submit accepts only the signed prepared instruction and Founder", () => {
  const founder = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const expected = transaction(founder, recipient).serialize({ requireAllSignatures: false,
    verifySignatures: false }).toString("base64");
  const signed = transaction(founder, recipient);
  signed.sign(founder);
  const signedTransactionBase64 = signed.serialize().toString("base64");
  assert.ok(validateSignedCompanyBootstrap({ expectedTransactionBase64: expected,
    signedTransactionBase64, founder: founder.publicKey.toBase58() }).signature);

  assert.throws(() => validateSignedCompanyBootstrap({ expectedTransactionBase64: expected,
    signedTransactionBase64, founder: Keypair.generate().publicKey.toBase58() }), /Founder signature/);
  const altered = transaction(founder, recipient, 2);
  altered.sign(founder);
  assert.throws(() => validateSignedCompanyBootstrap({ expectedTransactionBase64: expected,
    signedTransactionBase64: altered.serialize().toString("base64"), founder: founder.publicKey.toBase58() }),
  /does not match/);
});

test("bootstrap submit tolerates wallet-injected compute budget instructions", () => {
  const founder = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const expected = transaction(founder, recipient).serialize({ requireAllSignatures: false,
    verifySignatures: false }).toString("base64");
  // Wallets add priority-fee instructions while signing; the real instruction must still match.
  const signed = transaction(founder, recipient);
  signed.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
  signed.sign(founder);
  assert.ok(validateSignedCompanyBootstrap({ expectedTransactionBase64: expected,
    signedTransactionBase64: signed.serialize().toString("base64"), founder: founder.publicKey.toBase58() }).signature);

  // But any other injected instruction is still rejected.
  const sneaky = transaction(founder, recipient);
  sneaky.add(SystemProgram.transfer({ fromPubkey: founder.publicKey, toPubkey: Keypair.generate().publicKey,
    lamports: 1_000_000 }));
  sneaky.sign(founder);
  assert.throws(() => validateSignedCompanyBootstrap({ expectedTransactionBase64: expected,
    signedTransactionBase64: sneaky.serialize().toString("base64"), founder: founder.publicKey.toBase58() }),
  /Founder signature/);
});
