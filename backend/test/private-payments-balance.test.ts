import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { canonicalTokenAccount, privatePaymentsAuthToken, readRecipientBalance } from "../src/magicblock.ts";

function fixture() {
  const owner = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  return { owner, mint, ata: canonicalTokenAccount(owner, mint) };
}

test("private recipient balance uses MagicBlock's authenticated ephemeral endpoint", async () => {
  const { owner, mint, ata } = fixture();
  let requestedUrl = "";
  let authorization = "";
  const balance = await readRecipientBalance({
    owner,
    mint,
    teeToken: "wallet-token",
    paymentsUrl: "https://payments.example",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({
        address: owner,
        mint,
        ata,
        location: "ephemeral",
        balance: "10000000",
        delegation: { status: "delegated", validator: Keypair.generate().publicKey.toBase58() },
      }));
    },
  });

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v1/spl/private-balance");
  assert.equal(url.searchParams.get("address"), owner);
  assert.equal(url.searchParams.get("mint"), mint);
  assert.equal(url.searchParams.get("cluster"), "devnet-private");
  assert.equal(authorization, `Bearer ${owner}.wallet-token`);
  assert.deepEqual(balance, {
    owner,
    mint,
    tokenAccount: ata,
    location: "ephemeral",
    balanceMicro: "10000000",
  });
});

test("Payments API auth binds the wallet once and rejects a different bound wallet", () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const rawJwt = "header.payload.signature";
  assert.equal(privatePaymentsAuthToken(owner, rawJwt), `${owner}.${rawJwt}`);
  assert.equal(privatePaymentsAuthToken(owner, `${owner}.${rawJwt}`), `${owner}.${rawJwt}`);
  assert.throws(() => privatePaymentsAuthToken(owner, `${other}.${rawJwt}`),
    /Payments token belongs to another wallet/);
});

test("private recipient balance requires wallet authentication before making a request", async () => {
  const { owner, mint } = fixture();
  let called = false;
  await assert.rejects(() => readRecipientBalance({
    owner,
    mint,
    teeToken: "",
    fetchImpl: async () => {
      called = true;
      return new Response();
    },
  }), /TEE auth token required/);
  assert.equal(called, false);
});

test("a public, mismatched, or malformed balance can never be shown as private", async () => {
  const { owner, mint, ata } = fixture();
  const otherOwner = Keypair.generate().publicKey.toBase58();
  const otherMint = Keypair.generate().publicKey.toBase58();
  const otherAta = canonicalTokenAccount(otherOwner, mint);
  const invalidResponses: Array<Record<string, unknown>> = [
    { address: owner, mint, ata, location: "base", balance: "10000000" },
    { address: otherOwner, mint, ata, location: "ephemeral", balance: "10000000" },
    { address: owner, mint: otherMint, ata, location: "ephemeral", balance: "10000000" },
    { address: owner, mint, ata: otherAta, location: "ephemeral", balance: "10000000" },
    { address: owner, mint, ata, location: "ephemeral", balance: 10_000_000 },
    { address: owner, mint, ata, location: "ephemeral", balance: "-1" },
    { address: owner, mint, ata, location: "ephemeral", balance: "10.0" },
  ];

  for (const payload of invalidResponses) {
    await assert.rejects(() => readRecipientBalance({
      owner,
      mint,
      teeToken: "wallet-token",
      fetchImpl: async () => new Response(JSON.stringify(payload)),
    }), /authenticated ephemeral balance/);
  }
});

test("Private Payments authentication failures stay errors instead of becoming a zero balance", async () => {
  const { owner, mint } = fixture();
  await assert.rejects(() => readRecipientBalance({
    owner,
    mint,
    teeToken: "wallet-token",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "TOKEN_IDENTITY_MISMATCH", message: "token belongs to another wallet" },
    }), { status: 403 }),
  }), /Private recipient token balance unavailable.*TOKEN_IDENTITY_MISMATCH/);
});
