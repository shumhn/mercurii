import assert from "node:assert/strict";
import { test } from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assertTeeTokenActor, createAssistantChallenge, consumeAssistantChallenge } from "../src/assistant-auth.ts";
import { answerAssistantQuestion, classifyAssistantQuestion, resolveAssistantAccess } from "../src/finance-assistant.ts";
import { branchScopeAddress } from "../src/operations.ts";

const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const finance = Keypair.generate().publicKey.toBase58();
const manager = Keypair.generate().publicKey.toBase58();
const requester = Keypair.generate().publicKey.toBase58();
const viewer = Keypair.generate().publicKey.toBase58();
const zero = PublicKey.default.toBase58();
const financeGrantAddress = Keypair.generate().publicKey.toBase58();
const managerGrantAddress = Keypair.generate().publicKey.toBase58();
const requesterGrantAddress = Keypair.generate().publicKey.toBase58();
const viewerGrantAddress = Keypair.generate().publicKey.toBase58();
const branch = branchScopeAddress(new PublicKey(company), 7).toBase58();
const grants: Record<string, Record<string, unknown>> = {
  [financeGrantAddress]: { company, member: finance, grantor: founder, parent: zero,
    role: 1, scope: zero, active: true, revoked: false },
  [managerGrantAddress]: { company, member: manager, grantor: finance, parent: financeGrantAddress,
    role: 2, scope: branch, active: true, revoked: false },
  [requesterGrantAddress]: { company, member: requester, grantor: founder, parent: zero,
    role: 3, scope: branch, active: true, revoked: false },
  [viewerGrantAddress]: { company, member: viewer, grantor: founder, parent: zero,
    role: 4, scope: branch, active: true, revoked: false },
};
const readPolicy = async () => ({ address: company, founder, finance });
const readGrant = async (_company: string, address: string) => {
  const grant = grants[address];
  if (!grant) throw new Error("Unknown grant");
  return grant;
};
const requestId = ((7n << 40n) | 123n).toString();
const requestAddress = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const readRequest = async () => ({ address: requestAddress, id: requestId, requester,
  amountMicro: "12500000", status: "approved", recipient });

test("assistant wallet challenge is one-use and bound to company and wallet", () => {
  const wallet = Keypair.generate();
  const challenge = createAssistantChallenge(company, wallet.publicKey.toBase58(), 1_000);
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey));
  assert.throws(() => consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: challenge.challengeId, signature, now: 301_001 }), /expired/);
  const fresh = createAssistantChallenge(company, wallet.publicKey.toBase58());
  const signed = bs58.encode(nacl.sign.detached(Buffer.from(fresh.message), wallet.secretKey));
  assert.equal(consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: fresh.challengeId, signature: signed }), wallet.publicKey.toBase58());
  assert.throws(() => consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: fresh.challengeId, signature: signed }), /already used/);
});

test("TEE token subject must match the wallet that signed the assistant challenge", () => {
  const token = (pubkey: string, exp: number, alg = "HS256") => [
    Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ pubkey, exp })).toString("base64url"),
    "signature",
  ].join(".");
  const now = 1_000_000;
  assert.doesNotThrow(() => assertTeeTokenActor(token(founder, 2_000), founder, now));
  assert.throws(() => assertTeeTokenActor(token(finance, 2_000), founder, now), /does not match/);
  assert.throws(() => assertTeeTokenActor(token(founder, 1_000), founder, now), /expired/);
  assert.throws(() => assertTeeTokenActor(token(founder, 2_000, "none"), founder, now), /does not match/);
  assert.throws(() => assertTeeTokenActor("opaque-token", founder, now), /format/);
});

test("x402 wallet signature binds the approved service, recipient, and task", () => {
  const wallet = Keypair.generate();
  const intent = { serviceId: "research", taskId: "9bc7d8bb-d209-46ad-ad33-0c18a5aff59f",
    url: "https://example.org/report", payTo: recipient, maxMicro: "1000" };
  const challenge = createAssistantChallenge(company, wallet.publicKey.toBase58(), Date.now(), intent);
  assert.match(challenge.message, /allow one isolated-wallet x402 purchase/);
  assert.match(challenge.message, /1000 micro USDC/);
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey));
  assert.throws(() => consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: challenge.challengeId, signature,
    x402Intent: { ...intent, maxMicro: "2000" } }), /terms do not match/);
  const fresh = createAssistantChallenge(company, wallet.publicKey.toBase58(), Date.now(), intent);
  const freshSignature = bs58.encode(nacl.sign.detached(Buffer.from(fresh.message), wallet.secretKey));
  assert.equal(consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: fresh.challengeId, signature: freshSignature, x402Intent: intent }),
    wallet.publicKey.toBase58());
  const noSpend = createAssistantChallenge(company, wallet.publicKey.toBase58());
  const noSpendSignature = bs58.encode(nacl.sign.detached(Buffer.from(noSpend.message), wallet.secretKey));
  assert.throws(() => consumeAssistantChallenge({ company, actor: wallet.publicKey.toBase58(),
    challengeId: noSpend.challengeId, signature: noSpendSignature, x402Intent: intent }),
  /terms do not match/);
});

test("assistant grants enforce role, parent revocation, and branch scope", async () => {
  const shared = { company, founder, teeToken: "tee", readPolicy, readGrant };
  const financeAccess = await resolveAssistantAccess({ ...shared, actor: finance, grant: financeGrantAddress });
  assert.equal(financeAccess.role, "finance");
  const managerAccess = await resolveAssistantAccess({ ...shared, actor: manager, grant: managerGrantAddress });
  assert.equal(managerAccess.scope, branch);
  const status = await answerAssistantQuestion({ company, access: managerAccess, teeToken: "tee",
    intent: "payment_status", requestAddress, readRequest });
  assert.equal((status.facts as Record<string, unknown>).status, "approved");
  await assert.rejects(answerAssistantQuestion({ company, access: managerAccess, teeToken: "tee",
    intent: "treasury_balance" }), /cannot view/);
  const otherBranch = { ...managerAccess, scope: branchScopeAddress(new PublicKey(company), 8).toBase58() };
  await assert.rejects(answerAssistantQuestion({ company, access: otherBranch, teeToken: "tee",
    intent: "payment_status", requestAddress, readRequest }), /outside/);
  grants[financeGrantAddress]!.revoked = true;
  await assert.rejects(resolveAssistantAccess({ ...shared, actor: manager, grant: managerGrantAddress }), /parent grant is inactive/);
  grants[financeGrantAddress]!.revoked = false;
});

test("requester sees only own request and viewer cannot see treasury", async () => {
  const shared = { company, founder, teeToken: "tee", readPolicy, readGrant };
  const requesterAccess = await resolveAssistantAccess({ ...shared, actor: requester, grant: requesterGrantAddress });
  const viewerAccess = await resolveAssistantAccess({ ...shared, actor: viewer, grant: viewerGrantAddress });
  await answerAssistantQuestion({ company, access: requesterAccess, teeToken: "tee",
    intent: "payment_status", requestAddress, readRequest });
  await assert.rejects(answerAssistantQuestion({ company, access: requesterAccess, teeToken: "tee",
    intent: "payment_status", requestAddress,
    readRequest: async () => ({ ...await readRequest(), requester: finance }) }), /their own/);
  await assert.rejects(answerAssistantQuestion({ company, access: viewerAccess, teeToken: "tee",
    intent: "treasury_balance" }), /cannot view/);
});

test("assistant model only classifies supported reads and is local by default", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"treasury_balance"}' } }] }),
      { status: 200 });
  };
  await assert.rejects(classifyAssistantQuestion({ question: "What is our balance?",
    modelUrl: "https://remote.example/v1/chat/completions", modelName: "test", fetchImpl: fetchImpl as typeof fetch }),
  /privacy opt-in/);
  assert.equal(called, false);
  assert.equal(await classifyAssistantQuestion({ question: "What is our balance?",
    modelUrl: "http://127.0.0.1:8080/v1/chat/completions", modelName: "test",
    fetchImpl: fetchImpl as typeof fetch }), "treasury_balance");
  await assert.rejects(classifyAssistantQuestion({ question: "Pay everyone now",
    modelUrl: "http://127.0.0.1:8080/v1/chat/completions", modelName: "test",
    fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: {
      content: '{"intent":"execute_payment"}',
    } }] }), { status: 200 })) as typeof fetch }), /unsupported intent/);
});
