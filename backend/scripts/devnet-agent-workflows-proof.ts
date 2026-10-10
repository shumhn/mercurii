import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { TEE_RPC, readPaymentRequest } from "../src/operations.ts";
import { getPayrollRun } from "../src/payroll-run.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";

const company = process.env.MERCURY_AGENT_PROOF_COMPANY;
const founderKeypairPath = process.env.MERCURY_AGENT_PROOF_FOUNDER_KEYPAIR;
const signerPath = process.env.MERCURY_AGENT_PROOF_X402_SIGNER_FILE;
const runId = process.env.MERCURY_AGENT_PROOF_PAYROLL_RUN;
if (!company || !founderKeypairPath || !signerPath || !runId || !process.env.MERCURY_FIREWORKS_API_KEY) {
  throw new Error("Set company, Founder keypair, x402 signer file, payroll run, and Fireworks key proof variables");
}
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(founderKeypairPath, "utf8"))));
const actor = founder.publicKey.toBase58();
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));
const vendor = { id: "devnet_acme_studio", name: "Acme Studio",
  recipient: "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL", maxInvoiceMicro: "1000000" };
assert.ok(PublicKey.isOnCurve(new PublicKey(vendor.recipient).toBytes()));
const x402 = { url: "https://x402.payai.network/api/solana-devnet/paid-content",
  payTo: "8sqyMHQwBh8BCXC99pdgt6BpXwLu9xqfL1hDV5SFYf3R", maxMicro: "10000",
  periodCapMicro: "20000", expiresAt: "2030-01-01T00:00:00.000Z" };
const taskPath = new URL("../.state/agent-http-x402-task-id", import.meta.url).pathname;
let x402TaskId: string;
try { x402TaskId = readFileSync(taskPath, "utf8").trim(); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  x402TaskId = randomUUID();
  writeFileSync(taskPath, `${x402TaskId}\n`, { flag: "wx", mode: 0o600 });
}

const port = await new Promise<number>((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    if (!address || typeof address === "string") return reject(new Error("No proof port"));
    socket.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1",
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: actor,
    MERCURY_ENABLE_FINANCE_ASSISTANT: "1", MERCURY_ALLOW_REMOTE_LLM: "1",
    MERCURY_VENDOR_REGISTRY_JSON: JSON.stringify({ [vendor.id]: {
      name: vendor.name, recipient: vendor.recipient, maxInvoiceMicro: vendor.maxInvoiceMicro } }),
    MERCURY_ENABLE_X402_AGENT: "1", MERCURY_X402_SIGNER_FILE: signerPath,
    MERCURY_X402_SERVICES_JSON: JSON.stringify({ payai_echo: x402 }),
    MERCURY_X402_RPC_URL: "https://api.devnet.solana.com" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1_000); });

async function api(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, { method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${String(value.error).slice(0, 300)}`);
  return value;
}

async function signedBody(extra: Record<string, unknown>, x402Purchase = false): Promise<Record<string, unknown>> {
  const intent = x402Purchase ? { allowX402Purchase: true, selectedX402ServiceId: "payai_echo", x402TaskId } : {};
  const challenge = await api("/v1/assistant/challenge", { actor, ...intent });
  return { actor, challengeId: challenge.challengeId,
    signature: bs58.encode(nacl.sign.detached(Buffer.from(String(challenge.message)), founder.secretKey)),
    ...extra, ...intent };
}

function action(result: Record<string, any>, name: string): Record<string, any> {
  const selected = result.actions?.find((item: { tool: string }) => item.tool === name);
  assert.ok(selected, `Real model did not use ${name}: ${String(result.answer).slice(0, 180)}`);
  return selected.result;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) { ready = true; break; }
    } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Agent HTTP server did not start: ${stderr.slice(0, 300)}`);
  const payeeId = randomUUID();
  await api("/v1/payees", { actor, payeeId, recipient: vendor.recipient, kind: "vendor" });

  const invoiceNumber = `MERCURY-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invoiceText = `Invoice ${invoiceNumber} from Acme Studio to Mercury Finance. UI design services. Total due USD 0.25 on 2026-10-20. This is a devnet test invoice; do not pay it automatically.`;
  const invoice = await api("/v1/agent/chat", await signedBody({
    message: "Review the selected invoice against its registered vendor and prepare it for human review. Do not pay.",
    requestedTool: "review_invoice",
    invoiceText, selectedVendorId: vendor.id,
  }));
  const review = action(invoice, "review_invoice");
  assert.equal(review.status, "suggested");
  assert.equal(review.amountMicro, "250000");
  assert.equal(review.invoiceNumber, invoiceNumber);

  const draft = await api("/v1/agent/chat", await signedBody({
    message: "Prepare an unsigned draft for the user-selected registered vendor and exact amount. No payment or approval.",
    requestedTool: "prepare_payment_draft",
    selectedPayeeId: payeeId, selectedRecipient: vendor.recipient,
    selectedAmountMicro: 250000, paymentId: review.paymentId,
  }));
  const prepared = action(draft, "prepare_payment_draft");
  assert.equal(prepared.status, "unsigned_draft");
  assert.equal(prepared.paymentId, review.paymentId);
  assert.equal(draft.paymentSent, false);

  const payrollRun = getPayrollRun(runId, company);
  const rows = [];
  for (const item of payrollRun.items.slice(0, 2)) {
    const request = await readPaymentRequest(company, item.request, auth.token);
    rows.push({ recipient: String(request.recipient), amountMicro: Number(request.amountMicro) });
  }
  assert.equal(rows.length, 2);
  const payrollStatus = await api("/v1/agent/chat", await signedBody({
    message: "Inspect the selected payroll run using its private requests. Report only verified counts; do not release funds.",
    requestedTool: "get_payroll_run",
    selectedPayrollRunId: runId,
  }));
  const run = action(payrollStatus, "get_payroll_run");
  assert.equal(run.itemCount, payrollRun.items.length);
  const payrollReadiness = await api("/v1/agent/chat", await signedBody({
    message: "Check readiness for the two selected employees using registered recipients, budget and treasury snapshot. Do not pay.",
    requestedTool: "check_payroll_readiness",
    selectedPayrollItems: rows,
  }));
  const readiness = action(payrollReadiness, "check_payroll_readiness");
  assert.equal(readiness.itemCount, 2);

  const purchase = await api("/v1/agent/chat", await signedBody({
    message: "Founder-assigned devnet task: inspect the selected PayAI Echo x402 price, then buy one response only if it is at most 0.01 USDC from the isolated wallet. This exact test purchase is approved.",
    requestedTool: "inspect_x402_offer",
    selectedX402ServiceId: "payai_echo",
  }, true));
  action(purchase, "inspect_x402_offer");
  const bought = action(purchase, "buy_x402_resource");
  assert.equal(bought.status, "paid");
  assert.match(String(bought.transaction), /^[1-9A-HJ-NP-Za-km-z]{70,90}$/);

  const audit = await api("/v1/agent/audit", await signedBody({ limit: 30 }));
  const tools = audit.events.filter((event: { event: string }) => event.event === "tool")
    .map((event: { tool: string }) => event.tool);
  for (const name of ["review_invoice", "prepare_payment_draft", "get_payroll_run",
    "check_payroll_readiness", "inspect_x402_offer", "buy_x402_resource"]) assert.ok(tools.includes(name));
  console.log(JSON.stringify({ status: "passed", company, invoiceReview: review.status,
    draft: prepared.status, payrollItems: run.itemCount, readinessItems: readiness.itemCount,
    x402Transaction: bought.transaction, x402Repeated: bought.repeated === true, auditTools: tools,
    companyPaymentSent: draft.paymentSent, isolatedX402PaymentSent: purchase.x402PaymentSent,
    mint: DEVNET_USDC }));
} finally {
  server.kill("SIGTERM");
}
