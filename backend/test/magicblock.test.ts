import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { preparePrivateReceive, prepareRecipientWithdrawal } from "../src/magicblock.ts";

test("private receive builder fixes the route and leaves payer signing to the client", async () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const company = Keypair.generate().publicKey.toBase58();
  let sent: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      kind: "transfer",
      version: "v0",
      transactionBase64: "AQID",
      sendTo: "base",
      requiredSigners: [payer],
    }), { status: 200 });
  };
  const result = await preparePrivateReceive({ payer, company, amountMicro: 1_000_000, fetchImpl: fakeFetch });
  assert.equal(sent.to, company);
  assert.equal(sent.visibility, "private");
  assert.equal(sent.fromBalance, "base");
  assert.equal(sent.toBalance, "ephemeral");
  assert.equal(sent.cluster, "devnet-private");
  assert.equal(result.sendTo, "base");
  assert.deepEqual(result.requiredSigners, [payer]);
});

test("rejects wrong signer and unsafe amount", async () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const company = Keypair.generate().publicKey.toBase58();
  await assert.rejects(() => preparePrivateReceive({ payer, company, amountMicro: Number.MAX_SAFE_INTEGER + 1 }), /positive safe integer/);
  await assert.rejects(() => preparePrivateReceive({
    payer,
    company,
    amountMicro: 1,
    fetchImpl: async () => new Response(JSON.stringify({
      kind: "transfer", transactionBase64: "AQID", sendTo: "base", requiredSigners: [company],
    }), { status: 200 }),
  }), /not an unsigned transfer for the payer/);
});

test("rejects a private receive routed to another PER validator", async () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const company = Keypair.generate().publicKey.toBase58();
  const expectedValidator = Keypair.generate().publicKey.toBase58();
  const otherValidator = Keypair.generate().publicKey.toBase58();
  await assert.rejects(() => preparePrivateReceive({
    payer, company, amountMicro: 1, expectedValidator,
    fetchImpl: async () => new Response(JSON.stringify({
      kind: "transfer", transactionBase64: "AQID", sendTo: "base", requiredSigners: [payer],
      validator: otherValidator,
    }), { status: 200 }),
  }), /different PER validator/);
});

test("recipient withdrawal is owner-signed and pinned to the company PER validator", async () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const validator = Keypair.generate().publicKey.toBase58();
  let sent: Record<string, unknown> = {};
  const result = await prepareRecipientWithdrawal({
    owner, mint, validator, amountMicro: 123,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        kind: "withdraw", transactionBase64: "AQID", sendTo: "base",
        requiredSigners: [owner], validator,
      }), { status: 200 });
    },
  });
  assert.deepEqual(sent, {
    owner, mint, amount: 123, cluster: "devnet-private", validator,
    initAtasIfMissing: true, idempotent: true,
  });
  assert.equal(result.sendTo, "base");
  assert.deepEqual(result.requiredSigners, [owner]);
});

test("recipient withdrawal rejects a PDA and wrong validator", async () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const validator = Keypair.generate().publicKey.toBase58();
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("recipient")], new PublicKey(mint));
  await assert.rejects(() => prepareRecipientWithdrawal({ owner: pda.toBase58(), mint, validator, amountMicro: 1 }), /wallet owner, not a PDA/);
  await assert.rejects(() => prepareRecipientWithdrawal({
    owner, mint, validator, amountMicro: 1,
    fetchImpl: async () => new Response(JSON.stringify({
      kind: "withdraw", transactionBase64: "AQID", sendTo: "base",
      requiredSigners: [owner], validator: Keypair.generate().publicKey.toBase58(),
    }), { status: 200 }),
  }), /selected PER validator/);
});
