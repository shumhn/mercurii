import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { completeTeeLogin, createTeeLoginChallenge } from "../src/tee-login.ts";

function fakeJwt(pubkey: string, exp: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ pubkey, exp })}.fakesig`;
}

const wallet = Keypair.generate();
const challenge = "mercury-tee-challenge-abc123";
const signature = bs58.encode(nacl.sign.detached(Buffer.from(challenge, "utf8"), wallet.secretKey));

function mockTee(token: string, status = 200): typeof fetch {
  return (async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes("/auth/challenge")) {
      return new Response(JSON.stringify({ challenge }), { status: 200 });
    }
    if (url.includes("/auth/login") && init?.method === "POST") {
      return new Response(status === 200 ? JSON.stringify({ token, expiresAt: 1_900_000_000_000 }) :
        JSON.stringify({ error: "bad login" }), { status });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

test("TEE login challenge fetches the validator challenge for the wallet", async () => {
  const result = await createTeeLoginChallenge({ wallet: wallet.publicKey.toBase58(),
    teeRpc: "http://127.0.0.1:1", fetchImpl: mockTee(fakeJwt(wallet.publicKey.toBase58(), 0)) });
  assert.equal(result.wallet, wallet.publicKey.toBase58());
  assert.equal(result.challenge, challenge);
  await assert.rejects(() => createTeeLoginChallenge({ wallet: "nope", teeRpc: "http://127.0.0.1:1",
    fetchImpl: mockTee("") }), /Solana address/);
});

test("TEE login completes with a valid wallet signature and returns a wallet-bound token", async () => {
  const validJwt = fakeJwt(wallet.publicKey.toBase58(), 1_900_000_000);
  const result = await completeTeeLogin({ wallet: wallet.publicKey.toBase58(), challenge, signature,
    teeRpc: "http://127.0.0.1:1", fetchImpl: mockTee(validJwt) });
  assert.equal(result.token, validJwt);
  assert.equal(result.expiresAt, 1_900_000_000_000);
});

test("TEE login rejects a signature from the wrong wallet", async () => {
  const wrong = Keypair.generate();
  const wrongSignature = bs58.encode(nacl.sign.detached(Buffer.from(challenge, "utf8"), wrong.secretKey));
  await assert.rejects(() => completeTeeLogin({ wallet: wallet.publicKey.toBase58(), challenge,
    signature: wrongSignature, teeRpc: "http://127.0.0.1:1",
    fetchImpl: mockTee(fakeJwt(wallet.publicKey.toBase58(), 1_900_000_000)) }), /does not match/);
});

test("TEE login never returns a token claiming a different wallet", async () => {
  const foreignJwt = fakeJwt(Keypair.generate().publicKey.toBase58(), 1_900_000_000);
  await assert.rejects(() => completeTeeLogin({ wallet: wallet.publicKey.toBase58(), challenge, signature,
    teeRpc: "http://127.0.0.1:1", fetchImpl: mockTee(foreignJwt) }), /wallet does not match/);
});

test("TEE login surfaces validator login failures", async () => {
  await assert.rejects(() => completeTeeLogin({ wallet: wallet.publicKey.toBase58(), challenge, signature,
    teeRpc: "http://127.0.0.1:1", fetchImpl: mockTee("", 403) }), /TEE login failed: bad login/);
});
