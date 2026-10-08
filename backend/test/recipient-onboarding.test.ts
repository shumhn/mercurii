import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { nextRecipientOnboarding } from "../src/recipient-onboarding.ts";

test("recipient is ready only after its private token account is readable", async () => {
  const recipient = Keypair.generate().publicKey.toBase58();
  const payer = Keypair.generate().publicKey.toBase58();
  const ready = await nextRecipientOnboarding({
    recipient, payer, amountMicro: 1, teeToken: "recipient-token",
    readBalance: async () => ({ owner: recipient, mint: "mint", tokenAccount: "ata", location: "ephemeral", balanceMicro: "0" }),
    buildDeposit: async () => { throw new Error("should not build a second deposit"); },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.balanceMicro, "0");
  assert.equal(ready.transaction, null);
  const needsDeposit = await nextRecipientOnboarding({
    recipient, payer, amountMicro: 1, teeToken: "recipient-token",
    readBalance: async () => { throw new Error("Private recipient token balance unavailable"); },
    buildDeposit: async (args) => {
      assert.equal(args.recipient, recipient);
      assert.equal(args.payer, payer);
      assert.equal(args.expectedValidator, "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
      return { kind: "transfer", transactionBase64: "AQID", sendTo: "base", requiredSigners: [payer] };
    },
  });
  assert.equal(needsDeposit.status, "needs_deposit");
  const wait = await nextRecipientOnboarding({
    recipient, payer, amountMicro: 1, teeToken: "recipient-token",
    receipt: { id: "receipt-id", status: "confirmed" },
    readBalance: async () => { throw new Error("Private recipient token balance unavailable"); },
    buildDeposit: async () => { throw new Error("must not build a second deposit"); },
  });
  assert.equal(wait.status, "wait");
  assert.equal(wait.receiptId, "receipt-id");
  await assert.rejects(() => nextRecipientOnboarding({
    recipient, payer, amountMicro: 1, teeToken: "recipient-token",
    readBalance: async () => { throw new Error("RPC access denied"); },
  }), /RPC access denied/);
});
