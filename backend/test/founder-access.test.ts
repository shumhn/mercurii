import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { requireFounderPolicy } from "../src/founder-access.ts";
import { readCompanyPolicy } from "../src/operations.ts";

const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const finance = Keypair.generate().publicKey.toBase58();

function tokenFor(wallet: string): string {
  const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ pubkey: wallet, exp: 1_900_000_000 })}.test-signature`;
}

const policy = { address: company, founder, finance };

test("Founder-only access binds a TEE-validated policy read to the token wallet", async () => {
  const calls: string[] = [];
  const readPolicy: typeof readCompanyPolicy = async (address, token) => {
    calls.push(`${address}:${token}`);
    return policy;
  };
  await assert.rejects(() => requireFounderPolicy({ company, founder, teeToken: tokenFor(finance), readPolicy }),
    /TEE token wallet does not match/);
  assert.equal(calls.length, 1);
  assert.deepEqual(await requireFounderPolicy({ company, founder, teeToken: tokenFor(founder), readPolicy }), policy);
  assert.equal(calls.length, 2);
});

test("Founder-only access fails closed when the TEE private read rejects the token", async () => {
  const readPolicy: typeof readCompanyPolicy = async () => { throw new Error("TEE rejected token"); };
  await assert.rejects(() => requireFounderPolicy({ company, founder, teeToken: tokenFor(founder), readPolicy }),
    /TEE rejected token/);
});

test("Founder-only access rejects a policy for another company or founder", async () => {
  const foreignCompany = Keypair.generate().publicKey.toBase58();
  const wrongCompany: typeof readCompanyPolicy = async () => ({ ...policy, address: foreignCompany });
  const wrongFounder: typeof readCompanyPolicy = async () => ({ ...policy, founder: finance });
  await assert.rejects(() => requireFounderPolicy({ company, founder, teeToken: tokenFor(founder),
    readPolicy: wrongCompany }), /Wrong private company policy/);
  await assert.rejects(() => requireFounderPolicy({ company, founder, teeToken: tokenFor(founder),
    readPolicy: wrongFounder }), /Wrong private company policy/);
});

test("Founder-only access requires a bearer token", async () => {
  let reads = 0;
  const readPolicy: typeof readCompanyPolicy = async () => { reads++; return policy; };
  await assert.rejects(() => requireFounderPolicy({ company, founder, teeToken: "", readPolicy }),
    /Founder TEE auth token required/);
  assert.equal(reads, 0);
});
