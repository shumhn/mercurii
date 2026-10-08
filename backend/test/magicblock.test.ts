import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { preparePrivateReceive, prepareRecipientOnboarding, prepareRecipientWithdrawal } from "../src/magicblock.ts";
import { paymentExecutionAccounts, paymentStatusFromRequest } from "../src/operations.ts";

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
  let sent: Record<string, unknown> = {};
  await assert.rejects(() => preparePrivateReceive({
    payer, company, amountMicro: 1, expectedValidator,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        kind: "transfer", transactionBase64: "AQID", sendTo: "base", requiredSigners: [payer],
        validator: otherValidator,
      }), { status: 200 });
    },
  }), /different PER validator/);
  assert.equal(sent.validator, expectedValidator);
});

test("recipient onboarding builds a payer-signed private deposit on the selected PER", async () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  const validator = Keypair.generate().publicKey.toBase58();
  let sent: Record<string, unknown> = {};
  const result = await prepareRecipientOnboarding({
    payer, recipient, amountMicro: 1_000, expectedValidator: validator,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        kind: "transfer", transactionBase64: "AQID", sendTo: "base",
        requiredSigners: [payer], validator,
      }), { status: 200 });
    },
  });
  assert.equal(sent.to, recipient);
  assert.equal(sent.mint, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  assert.equal(sent.amount, 1_000);
  assert.equal(sent.visibility, "private");
  assert.equal(sent.fromBalance, "base");
  assert.equal(sent.toBalance, "ephemeral");
  assert.equal(sent.validator, validator);
  assert.deepEqual(result.requiredSigners, [payer]);
});

test("recipient onboarding rejects a PDA and a different PER validator", async () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  const validator = Keypair.generate().publicKey.toBase58();
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("recipient")], new PublicKey(validator));
  await assert.rejects(() => prepareRecipientOnboarding({
    payer, recipient: pda.toBase58(), amountMicro: 1,
  }), /wallet owner, not a PDA/);
  await assert.rejects(() => prepareRecipientOnboarding({
    payer, recipient, amountMicro: 1, expectedValidator: validator,
    fetchImpl: async () => new Response(JSON.stringify({
      kind: "transfer", transactionBase64: "AQID", sendTo: "base", requiredSigners: [payer],
      validator: Keypair.generate().publicKey.toBase58(),
    }), { status: 200 }),
  }), /different PER validator/);
});

test("payment status follows the atomic private request state", () => {
  const request = { address: Keypair.generate().publicKey.toBase58(), recipient: Keypair.generate().publicKey.toBase58(), amountMicro: "10000" };
  assert.equal(paymentStatusFromRequest({ ...request, status: "approved" }).paymentSettled, false);
  assert.equal(paymentStatusFromRequest({ ...request, status: "executed" }).paymentSettled, true);
  assert.throws(() => paymentStatusFromRequest({ ...request, status: "mystery" }), /Unknown private payment request status/);
});

test("approved USDC payout derives the proven company and recipient token accounts", () => {
  const company = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
  const finance = "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL";
  const policy = {
    address: company, finance, mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    period: "1", reservedMicro: "10000",
  };
  const request = {
    status: "approved", recipient: finance, amountMicro: "10000", approvedPeriod: "1",
  };
  const accounts = paymentExecutionAccounts(company, finance, policy, request);
  assert.equal(accounts.treasuryToken, "9FZSyPdFCdnUExrGwtmigbPGR9HcCehJ77osx3ctoKeH");
  assert.equal(accounts.recipientToken, "8EoZBo73yQy7jMVxoKz5QW12nEhMMwbEHT4W1kyZTj3S");
  assert.equal(accounts.amountMicro, "10000");
  assert.throws(() => paymentExecutionAccounts(company, finance, policy, { ...request, status: "executed" }), /not approved/);
  assert.throws(() => paymentExecutionAccounts(company, finance, { ...policy, reservedMicro: "9999" }, request), /reservation is missing/);
  assert.throws(() => paymentExecutionAccounts(company, finance, policy, { ...request, approvedPeriod: "2" }), /another budget period/);
  assert.throws(() => paymentExecutionAccounts(company, Keypair.generate().publicKey.toBase58(), policy, request), /Finance must act/);
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
