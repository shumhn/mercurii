import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { BASE_RPC, PROGRAM_ID } from "../src/operations.ts";
import { DEVNET_USDC, teeConnection } from "../src/magicblock.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

// An intentionally small, resumable devnet acceptance proof. Keep signer files
// outside Git; the proof journal contains IDs/signatures, never private terms
// or signed transaction bytes. An uncertain submission stops for inspection.
const founderFile = process.env.MERCURY_SHARED_PROOF_FOUNDER_KEYPAIR;
const recipientFile = process.env.MERCURY_SHARED_PROOF_RECIPIENT_KEYPAIR;
const amountMicro = 10_000;
if (!founderFile || !recipientFile || process.env.MERCURY_SHARED_PROOF_CONFIRM !== "pay-10000") {
  throw new Error("Set both MERCURY_SHARED_PROOF_*_KEYPAIR files and MERCURY_SHARED_PROOF_CONFIRM=pay-10000");
}
const load = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
const founder = load(founderFile);
const recipient = load(recipientFile);
const founderAddress = founder.publicKey.toBase58();
const recipientAddress = recipient.publicKey.toBase58();
const company = PublicKey.findProgramAddressSync(
  [Buffer.from("company-policy"), founder.publicKey.toBuffer()], PROGRAM_ID,
)[0].toBase58();
const proofPath = new URL(`../.state/shared-company-loop-${company}.json`, import.meta.url).pathname;
const journalDirectory = new URL(`../.state/shared-company-loop-${company}/`, import.meta.url).pathname;
type Proof = {
  company: string; paymentId: string; fundingId: string; recipient: string;
  targetBalanceMicro: number; initialBalanceMicro: string; initialRecipientMicro: string;
  status: string; fundingCompleted?: boolean; signatures: string[]; receiptIds: string[];
  payoutSignature?: string; lastAttempt?: { signature: string; chain: string; receiptId?: string };
};
function save(proof: Proof): void {
  mkdirSync(dirname(proofPath), { recursive: true, mode: 0o700 });
  writeFileSync(proofPath, JSON.stringify(proof, null, 2), { mode: 0o600 });
}
let proof: Proof | null = null;
try { proof = JSON.parse(readFileSync(proofPath, "utf8")) as Proof; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (proof && (proof.company !== company || proof.recipient !== recipientAddress)) {
  throw new Error("Existing proof is bound to another company or recipient");
}
if (proof?.status === "settled") {
  throw new Error(`Proof ${proof.paymentId} is already settled; inspect its saved receipt instead of paying again`);
}
if (proof?.lastAttempt) {
  throw new Error(`Inspect pending ${proof.lastAttempt.chain} signature ${proof.lastAttempt.signature} before resuming`);
}
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Supabase private store is required");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") return reject(new Error("No local port"));
      socket.close(() => resolve(address.port));
    });
  });
}
async function startBackend(): Promise<{ child: ChildProcess; base: string }> {
  const port = await freePort();
  mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    cwd: new URL("../", import.meta.url).pathname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      MERCURY_COMPANY_ADDRESS: "", MERCURY_FOUNDER_ADDRESS: "", MERCURY_COMPANY_MINT: "",
      MERCURY_ENABLE_EXPERIMENTAL_RECEIVE: "1", MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1",
      MERCURY_ONBOARDING_JOURNAL: join(journalDirectory, "receipts.json"),
      MERCURY_PAYMENT_FLOW_JOURNAL: join(journalDirectory, "flows.json"),
      MERCURY_PAYMENT_JOURNAL: join(journalDirectory, "payments.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 500); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) return { child, base }; } catch { /* Starting. */ }
    if (child.exitCode !== null) break;
    await pause(150);
  }
  child.kill();
  throw new Error(`Backend did not start: ${stderr.slice(0, 300)}`);
}
async function api(base: string, path: string, body: Record<string, unknown> | null,
  token?: string, method = "POST", withCompany = true): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, { method, headers: {
    "content-type": "application/json",
    ...(withCompany ? { "x-mercury-company": company } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, ...(body === null ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${String(value.error).slice(0, 200)}`);
  return value;
}
async function login(base: string, signer: Keypair): Promise<string> {
  const wallet = signer.publicKey.toBase58();
  const challenge = await api(base, "/v1/auth/tee-login/challenge", { wallet });
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(String(challenge.challenge), "utf8"), signer.secretKey));
  const session = await api(base, "/v1/auth/tee-login", { wallet, challenge: challenge.challenge, signature });
  assert.equal(session.wallet, wallet);
  assert.equal(session.company, company);
  return String(session.token);
}
async function sendBuilt(base: string, transaction: Record<string, any>, receiptId: string,
  token: string): Promise<string> {
  assert.ok(proof);
  assert.ok(transaction.requiredSigners?.includes(founderAddress));
  const signed = Transaction.from(Buffer.from(String(transaction.transactionBase64), "base64"));
  assert.equal(signed.feePayer?.toBase58(), founderAddress);
  signed.sign(founder);
  const signature = bs58.encode(signed.signatures[0]!.signature!);
  const chain = String(transaction.sendTo);
  proof.lastAttempt = { signature, chain, receiptId };
  save(proof);
  const connection = chain === "base" ? new Connection(BASE_RPC, "confirmed") : teeConnection(token);
  const submitted = await connection
    .sendRawTransaction(signed.serialize(), { skipPreflight: chain === "ephemeral", maxRetries: 3 });
  assert.equal(submitted, signature);
  let receipt = await api(base, `/v1/onboarding/receipts/${receiptId}/confirm`, {
    signedTransactionBase64: signed.serialize().toString("base64"),
  }, token);
  for (let attempt = 0; receipt.status === "pending" && attempt < 30; attempt++) {
    await pause(800);
    const reconciled = await api(base, `/v1/onboarding/receipts/${receiptId}/reconcile`, {}, token);
    receipt = reconciled.receipt ?? reconciled;
  }
  assert.equal(receipt.status, "confirmed", `Receipt ${receiptId} did not confirm`);
  proof.signatures.push(signature);
  proof.receiptIds.push(receiptId);
  delete proof.lastAttempt;
  save(proof);
  return signature;
}

let server = await startBackend();
try {
  const registered = await api(server.base, "/v1/companies/register", {
    company, founder: founderAddress,
  }, undefined, "POST", false);
  assert.equal(registered.mint, DEVNET_USDC);
  const founderToken = await login(server.base, founder);
  const recipientToken = await login(server.base, recipient);
  const policy = await api(server.base, "/v1/company-policy", null, founderToken, "GET");
  assert.equal(policy.founder, founderAddress);
  assert.equal(policy.mint, DEVNET_USDC);
  const snapshot = await api(server.base, "/v1/treasury-snapshot", null, founderToken, "GET");
  const before = await api(server.base, `/v1/recipient-balance/${recipientAddress}`, null, recipientToken, "GET");
  if (!proof) {
    proof = { company, paymentId: randomUUID(), fundingId: `shared_${randomUUID().slice(0, 12)}`,
      recipient: recipientAddress, targetBalanceMicro: Number(snapshot.balanceMicro) + amountMicro,
      initialBalanceMicro: String(snapshot.balanceMicro), initialRecipientMicro: String(before.balanceMicro),
      status: "started", fundingCompleted: false, signatures: [], receiptIds: [] };
    save(proof);
  }
  if (!proof.fundingCompleted) {
    for (let attempt = 0; attempt < 35; attempt++) {
      const step = await api(server.base, "/v1/onboarding/company-funding/next", {
        actor: founderAddress, payer: founderAddress, amountMicro,
        targetBalanceMicro: proof.targetBalanceMicro, fundingId: proof.fundingId,
      }, founderToken);
      if (step.status === "ready") {
        proof.status = "received"; proof.fundingCompleted = true; save(proof); break;
      }
      if (step.transaction && step.receiptId) {
        await sendBuilt(server.base, step.transaction, String(step.receiptId), founderToken);
        proof.status = String(step.status); save(proof);
      } else if (step.status === "wait_for_receipt" && step.receiptId) {
        await api(server.base, `/v1/onboarding/receipts/${step.receiptId}/reconcile`, {}, founderToken);
        await pause(800);
      } else throw new Error(`Funding stopped at ${step.status}`);
    }
  }
  if (!proof.fundingCompleted) throw new Error("Private receive did not reach the target snapshot");

  const terms = { actor: founderAddress, requester: founderAddress, recipient: recipientAddress,
    amountMicro, includeFinance: false };
  let approved = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const step = await api(server.base, `/v1/payment-flows/${proof.paymentId}/next`, terms, founderToken);
    if (step.step?.status === "ready_to_execute" || step.step?.status === "ready") {
      approved = true; break;
    }
    if (step.step?.status === "wait") { await pause(900); continue; }
    if (!step.transaction || !step.receiptId) throw new Error(`Payment flow stopped at ${step.step?.status}`);
    await sendBuilt(server.base, step.transaction, String(step.receiptId), founderToken);
    proof.status = String(step.step.operation); save(proof);
  }
  if (!approved) throw new Error("Payment did not reach approved state");
  const prepared = await api(server.base, `/v1/payment-jobs/${proof.paymentId}/prepare`, {
    actor: founderAddress,
  }, founderToken);
  if (prepared.transaction) {
    const transaction = Transaction.from(Buffer.from(String(prepared.transaction.transactionBase64), "base64"));
    assert.equal(transaction.feePayer?.toBase58(), founderAddress);
    transaction.sign(founder);
    const signature = bs58.encode(transaction.signatures[0]!.signature!);
    proof.lastAttempt = { signature, chain: "ephemeral" }; save(proof);
    const result = await api(server.base, `/v1/payment-jobs/${proof.paymentId}/submit`, {
      signedTransactionBase64: transaction.serialize().toString("base64"),
    }, founderToken);
    if (!["submitted", "uncertain", "already_settled"].includes(String(result.broadcast))) {
      throw new Error(`Unexpected payout broadcast state ${result.broadcast}`);
    }
    proof.payoutSignature = signature;
    delete proof.lastAttempt; save(proof);
  }
  let settled: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 35; attempt++) {
    const status = await api(server.base, `/v1/payment-jobs/${proof.paymentId}`, null, founderToken, "GET");
    if (status.paymentSettled && status.signatureLinked) { settled = status; break; }
    await pause(900);
  }
  if (!settled) throw new Error("Payout did not reach signed and settled state; inspect same payment ID");
  proof.payoutSignature = String(settled.record.signature);
  proof.status = "paid"; save(proof);
  for (let attempt = 0; attempt < 20; attempt++) {
    const sync = await api(server.base, `/v1/payment-jobs/${proof.paymentId}/snapshot-sync`, {
      actor: founderAddress,
    }, founderToken);
    if (sync.status === "ready") { proof.status = "synced"; save(proof); break; }
    if (sync.status === "build" && sync.transaction && sync.receiptId) {
      await sendBuilt(server.base, sync.transaction, String(sync.receiptId), founderToken);
    } else if (sync.status === "wait_for_snapshot" && sync.receiptId) {
      await api(server.base, `/v1/onboarding/receipts/${sync.receiptId}/reconcile`, {}, founderToken);
      await pause(800);
    } else await pause(800);
  }
  if (proof.status !== "synced") throw new Error("Payment snapshot sync did not finish");
  let reconciled = false;
  let offset = 0;
  do {
    const sweep = await api(server.base, "/v1/reconciliation/run", {
      paymentOffset: offset, limit: 50,
    }, founderToken);
    reconciled = sweep.payments.some((row: { paymentId: string; paymentState: string }) =>
      row.paymentId === proof!.paymentId && row.paymentState === "settled");
    offset = sweep.nextPaymentOffset ?? -1;
  } while (!reconciled && offset >= 0);
  if (!reconciled) throw new Error("Reconciliation did not include the settled payout");
  const after = await api(server.base, `/v1/recipient-balance/${recipientAddress}`, null, recipientToken, "GET");
  assert.equal(BigInt(String(after.balanceMicro)) - BigInt(proof.initialRecipientMicro), BigInt(amountMicro));
  server.child.kill();
  await pause(500);
  server = await startBackend();
  const restartedToken = await login(server.base, founder);
  const recovered = await api(server.base, `/v1/payment-jobs/${proof.paymentId}`, null, restartedToken, "GET");
  assert.equal(recovered.paymentSettled, true);
  assert.equal(recovered.record.signature, proof.payoutSignature);
  assert.ok(await store.get(company, "operation.payment-flow", proof.paymentId));
  assert.ok(await store.get(company, "operation.payment", proof.paymentId));
  for (const id of proof.receiptIds) assert.ok(await store.get(company, "operation.onboarding-receipt", id));
  proof.status = "settled"; save(proof);
  console.log(JSON.stringify({ result: "PASS", company, paymentId: proof.paymentId,
    fundingId: proof.fundingId, payoutSignature: proof.payoutSignature,
    signedSteps: proof.signatures.length, privateReceive: true, recipientDeltaMicro: amountMicro,
    reconciled, recoveredAfterRestart: true, databaseRecords: true }));
} finally {
  server.child.kill();
}
