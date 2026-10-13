import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { signPrepared } from "../lib/mercurii-wallet.ts";

test("prepared legacy transactions keep the legacy wallet-signing path", async () => {
  const founder = Keypair.generate();
  const transaction = new Transaction({
    feePayer: founder.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(SystemProgram.transfer({
    fromPubkey: founder.publicKey,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  }));
  let sawLegacy = false;
  const wallet = {
    publicKey: founder.publicKey,
    async signTransaction(value) {
      sawLegacy = value instanceof Transaction && !(value instanceof VersionedTransaction);
      value.sign(founder);
      return value;
    },
  };
  const result = await signPrepared(wallet, founder.publicKey.toBase58(), {
    transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    requiredSigners: [founder.publicKey.toBase58()],
    sendTo: "base",
  });
  assert.equal(sawLegacy, true);
  assert.equal(Transaction.from(Buffer.from(result.bytes)).verifySignatures(), true);
});
