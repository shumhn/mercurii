import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { inspectMemberGrant } from "../src/member-onboarding.ts";
import { confirmOnboardingReceipt, recordOnboardingBuild } from "../src/onboarding-journal.ts";
import { BASE_RPC, TEE_RPC, buildOperation, readPaymentRequest, readTeamGrant } from "../src/operations.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";

const company = process.env.MERCURY_REAL_AGENT_PROOF_COMPANY;
const founderPath = process.env.MERCURY_REAL_AGENT_PROOF_FOUNDER_KEYPAIR;
const agentPath = process.env.MERCURY_REAL_AGENT_PROOF_AGENT_KEYPAIR;
const recipient = process.env.MERCURY_REAL_AGENT_PROOF_RECIPIENT;
const fireworksKey = process.env.MERCURY_FIREWORKS_API_KEY;
if (!company || !founderPath || !agentPath || !recipient || !fireworksKey) {
  throw new Error("Set MERCURY_REAL_AGENT_PROOF_COMPANY, FOUNDER_KEYPAIR, AGENT_KEYPAIR, RECIPIENT, and MERCURY_FIREWORKS_API_KEY");
}
const load = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const founder = load(founderPath);
const agent = load(agentPath);
const founderAddress = founder.publicKey.toBase58();
const agentAddress = agent.publicKey.toBase58();
const token = async (signer: Keypair) => (await getAuthToken(TEE_RPC, signer.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, signer.secretKey))).token;
const [founderToken, agentToken] = await Promise.all([token(founder), token(agent)]);
const proofPath = new URL(`../.state/real-agent-invoice-proof-${company}.json`, import.meta.url).pathname;
const prior = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown> : null;
if (prior && process.env.MERCURY_REAL_AGENT_PROOF_RESUME !== "1") {
  throw new Error(`A prior real-agent proof exists for ${company}. Use a new company or set MERCURY_REAL_AGENT_PROOF_RESUME=1 only to recover that exact signed run.`);
}
const invoiceNumber = String(prior?.invoiceNumber ?? `AGENT-${randomUUID().slice(0, 8).toUpperCase()}`);
const grantId = String(prior?.grantId ?? Date.now());
const signatures: string[] = Array.isArray(prior?.signatures) ? prior.signatures as string[] : [];
function save(extra: Record<string, unknown>): void {
  writeFileSync(proofPath, JSON.stringify({ company, founder: founderAddress, agent: agentAddress,
    recipient, grantId, invoiceNumber, signatures, ...extra }, null, 2), { mode: 0o600 });
}
if (!prior) save({ status: "started" });
const pause = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureAgentBaseLamports(): Promise<string | null> {
  // This is devnet proof setup, separate from Mercury treasury spending. The Agent
  // signs its own base-layer request shell/delegation transactions, so it needs SOL.
  const requiredLamports = 100_000_000;
  const rpc = new Connection(BASE_RPC, "confirmed");
  const current = await rpc.getBalance(agent.publicKey);
  if (current >= requiredLamports) return null;
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: founder.publicKey, toPubkey: agent.publicKey,
    lamports: requiredLamports - current,
  }));
  const signature = await rpc.sendTransaction(transaction, [founder]);
  const confirmation = await rpc.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error(`Agent devnet SOL bootstrap failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}

async function send(built: { transactionBase64: string; sendTo: "base" | "ephemeral" },
  signer: Keypair, teeToken: string): Promise<{ signature: string; signed: string }> {
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  assert.equal(transaction.feePayer?.toBase58(), signer.publicKey.toBase58());
  transaction.sign(signer);
  const signed = transaction.serialize().toString("base64");
  const endpoint = new URL(built.sendTo === "base" ? BASE_RPC : TEE_RPC);
  if (built.sendTo === "ephemeral") endpoint.searchParams.set("token", teeToken);
  const rpc = new Connection(endpoint.toString(), "confirmed");
  const signature = await rpc.sendRawTransaction(Buffer.from(signed, "base64"), { skipPreflight: false });
  const confirmation = await rpc.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error(`Signed ${built.sendTo} transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  signatures.push(signature);
  return { signature, signed };
}

const agentFundingSignature = await ensureAgentBaseLamports();
save({ status: "agent_funded", agentFundingSignature });
let grantAddress = "";
for (let attempt = 0; attempt < 40; attempt++) {
  const status = await inspectMemberGrant({ company, founder: founderAddress, member: agentAddress,
    role: "requester", grantId, branchId: null, teeToken: founderToken });
  grantAddress = status.grantAddress;
  if (status.next.status === "ready") break;
  if (status.next.status === "wait") { await pause(800); continue; }
  const operation = status.next.operation!;
  const built = await buildOperation({ operation, actor: founderAddress, member: agentAddress,
    grantId, grant: grantAddress, role: "requester", scope: status.scopeAddress,
    recipients: [], mayDelegate: false },
  { company, founder: founderAddress, teeToken: founderToken });
  const receipt = recordOnboardingBuild({ company, target: grantAddress, operation,
    chain: built.sendTo, transactionBase64: built.transactionBase64 });
  if (receipt.status === "confirmed") continue;
  const sent = await send(built, founder, founderToken);
  const confirmed = await confirmOnboardingReceipt(receipt.id, sent.signed, founderToken);
  assert.equal(confirmed.status, "confirmed");
  save({ status: operation, grant: grantAddress });
}
assert.equal((await readTeamGrant(company, grantAddress, agentToken)).role, 3);

async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createNetServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") return reject(new Error("No local port"));
      socket.close(() => resolve(address.port));
    });
  });
}
const backendPort = await port();
const agentApiKey = randomUUID().replaceAll("-", "");
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(backendPort),
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: founderAddress,
    MERCURY_COMPANY_MINT: DEVNET_USDC, MERCURY_ENABLE_INVOICE_AGENT: "1",
    MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1", MERCURY_AGENT_API_KEY: agentApiKey,
    MERCURY_SUGGEST_AGENT_ADDRESS: agentAddress,
    MERCURY_LLM_URL: "https://api.fireworks.ai/inference/v1/chat/completions",
    MERCURY_LLM_MODEL: "accounts/fireworks/models/kimi-k3",
    MERCURY_LLM_API_KEY: fireworksKey, MERCURY_ALLOW_REMOTE_LLM: "1",
    MERCURY_VENDOR_REGISTRY_JSON: JSON.stringify({ acme_studio: {
      name: "Acme Studio", recipient, maxInvoiceMicro: "20000" } }) },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1000); });
const base = `http://127.0.0.1:${backendPort}`;
async function api(path: string, body: Record<string, unknown> | null, teeToken: string,
  method = "POST", key = false): Promise<Record<string, any>> {
  const response = await fetch(base + path, { method,
    headers: { authorization: `Bearer ${key ? agentApiKey : teeToken}`, "content-type": "application/json" },
    ...(body !== null ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${String(value.error).slice(0, 260)}`);
  return value;
}
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base + "/health")).ok) { ready = true; break; } } catch { /* Starting. */ }
    await pause(250);
  }
  if (!ready) throw new Error(`Backend failed to start: ${stderr.slice(0, 300)}`);
  const invoiceText = `Invoice ${invoiceNumber} from Acme Studio to Mercury Finance. Devnet services. Total due USD 0.01 on 2026-10-20. Human review required.`;
  const suggestion = await api("/v1/agent/invoice-suggestions", { invoiceText,
    vendorId: "acme_studio" }, agentToken, "POST", true);
  assert.equal(suggestion.amountMicro, "10000");
  assert.equal(suggestion.flowTerms.requester, agentAddress);
  const id = String(suggestion.paymentId);
  const repeated = await api("/v1/agent/invoice-suggestions", { invoiceText,
    vendorId: "acme_studio" }, agentToken, "POST", true);
  assert.equal(repeated.paymentId, id);
  assert.equal(repeated.repeated, true);
  save({ status: "suggested", paymentId: id, grant: grantAddress });
  let flow: Record<string, any> = {};
  for (let i = 0; i < 40; i++) {
    const observed = await api(`/v1/payment-flows/${id}`, null, founderToken, "GET");
    const current = observed.step.actor === founderAddress || observed.step.status === "approval_required"
      ? founder : agent;
    const bearer = current === founder ? founderToken : agentToken;
    flow = await api(`/v1/payment-flows/${id}/next`, { ...suggestion.flowTerms,
      actor: current.publicKey.toBase58(), requesterGrant: grantAddress }, bearer);
    if (["ready_to_execute", "ready"].includes(flow.step.status)) break;
    if (flow.step.status === "wait") {
      if (flow.receiptId) await api(`/v1/onboarding/receipts/${flow.receiptId}/reconcile`, {}, bearer);
      await pause(800); continue;
    }
    assert.ok(flow.transaction?.transactionBase64 && flow.receiptId, "Missing guided payment transaction");
    const needed = flow.step.status === "approval_required" ? founderAddress : flow.step.actor;
    const signer = needed === founderAddress ? founder : agent;
    const signerToken = signer === founder ? founderToken : agentToken;
    assert.equal(flow.transaction.requiredSigners?.[0], signer.publicKey.toBase58());
    const sent = await send(flow.transaction, signer, signerToken);
    const receipt = await api(`/v1/onboarding/receipts/${flow.receiptId}/confirm`, {
      signedTransactionBase64: sent.signed }, signerToken);
    assert.equal(receipt.status, "confirmed");
    save({ status: String(flow.step.operation), paymentId: id, grant: grantAddress });
  }
  assert.ok(["ready_to_execute", "ready"].includes(flow.step.status), "Agent request did not reach approval");
  if (flow.step.status === "ready_to_execute") {
    const plan = await api(`/v1/payment-jobs/${id}/prepare`, { actor: founderAddress }, founderToken);
    assert.ok(plan.transaction?.transactionBase64, "Missing Founder-signed payout");
    const payout = Transaction.from(Buffer.from(String(plan.transaction.transactionBase64), "base64"));
    payout.sign(founder);
    const submitted = await api(`/v1/payment-jobs/${id}/submit`, {
      signedTransactionBase64: payout.serialize().toString("base64") }, founderToken);
    assert.ok(["submitted", "uncertain", "already_settled"].includes(submitted.broadcast));
  }
  let settled: Record<string, any> | null = null;
  for (let i = 0; i < 25; i++) {
    const job = await api(`/v1/payment-jobs/${id}`, null, founderToken, "GET");
    if (job.paymentSettled) { settled = job; break; }
    await pause(800);
  }
  assert.ok(settled, "Agent invoice payout did not settle");
  const privateRequest = await readPaymentRequest(company, String(suggestion.requestAddress), agentToken);
  assert.equal(privateRequest.status, "executed");
  const retry = await api(`/v1/payment-jobs/${id}/prepare`, { actor: founderAddress }, founderToken);
  assert.equal(retry.transaction, null, "Agent invoice retry prepared another payout");
  const changed = await fetch(base + "/v1/agent/invoice-suggestions", { method: "POST",
    headers: { authorization: `Bearer ${agentApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ invoiceText: invoiceText.replace("USD 0.01", "USD 0.02"),
      vendorId: "acme_studio" }) });
  assert.equal(changed.status, 400, "Changed invoice amount was accepted");
  let sync: Record<string, any> = {};
  for (let i = 0; i < 12; i++) {
    sync = await api(`/v1/payment-jobs/${id}/snapshot-sync`, { actor: founderAddress }, founderToken);
    if (sync.status === "ready") break;
    if (sync.status === "build") {
      const signed = await send(sync.transaction, founder, founderToken);
      const receipt = await api(`/v1/onboarding/receipts/${sync.receiptId}/confirm`, {
        signedTransactionBase64: signed.signed }, founderToken);
      assert.equal(receipt.status, "confirmed");
    } else if (sync.status === "wait_for_snapshot") {
      await api(`/v1/onboarding/receipts/${sync.receiptId}/reconcile`, {}, founderToken);
    }
    await pause(700);
  }
  assert.equal(sync.status, "ready", "Snapshot did not catch up with agent payout");
  let offset = 0;
  let reconciledPayment = false;
  do {
    const sweep = await api("/v1/reconciliation/run", { paymentOffset: offset, limit: 50 }, founderToken);
    reconciledPayment = sweep.payments.some((payment: { paymentId: string; paymentState: string }) =>
      payment.paymentId === id && payment.paymentState === "settled");
    offset = sweep.nextPaymentOffset ?? -1;
  } while (!reconciledPayment && offset >= 0);
  assert.ok(reconciledPayment, "Reconciliation missed agent invoice payout");
  save({ status: "settled", paymentId: id, grant: grantAddress,
    request: suggestion.requestAddress, payoutSignature: settled.record.signature,
    snapshotMicro: sync.balanceMicro });
  console.log(JSON.stringify({ result: "PASS", model: "accounts/fireworks/models/kimi-k3", company, paymentId: id,
    agent: agentAddress, grant: grantAddress, request: suggestion.requestAddress,
    payoutSignature: settled.record.signature, agentFundingSignature, grantAndFlowSignatures: signatures.length,
    repeatedInvoiceSameId: true, changedAmountBlocked: true,
    secondPayoutBlocked: true, snapshotMicro: sync.balanceMicro, reconciled: true }));
} finally {
  server.kill("SIGTERM");
}
