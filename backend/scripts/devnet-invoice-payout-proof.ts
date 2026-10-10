import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { BASE_RPC, TEE_RPC, readPaymentRequest, readTreasurySnapshot } from "../src/operations.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";

const company = process.env.MERCURY_INVOICE_PROOF_COMPANY;
const founderPath = process.env.MERCURY_INVOICE_PROOF_FOUNDER_KEYPAIR;
const recipient = process.env.MERCURY_INVOICE_PROOF_RECIPIENT;
if (!company || !founderPath || !recipient) {
  throw new Error("Set MERCURY_INVOICE_PROOF_COMPANY, MERCURY_INVOICE_PROOF_FOUNDER_KEYPAIR, and MERCURY_INVOICE_PROOF_RECIPIENT");
}
const proofPath = new URL("../.state/invoice-payout-proof.json", import.meta.url).pathname;
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(founderPath, "utf8"))));
const actor = founder.publicKey.toBase58();
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));
const prior = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown> : null;
const invoiceNumber = String(prior?.invoiceNumber ?? `MERCURY-${randomUUID().slice(0, 8).toUpperCase()}`);
const signatures: string[] = Array.isArray(prior?.signatures) ? prior.signatures as string[] : [];
function save(extra: Record<string, unknown>): void {
  writeFileSync(proofPath, JSON.stringify({ invoiceNumber, company, recipient, signatures, ...extra }, null, 2),
    { mode: 0o600 });
}
if (!prior) save({ status: "started" });

async function openPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local port"));
      server.close(() => resolve(address.port));
    });
  });
}
const [modelPort, backendPort] = await Promise.all([openPort(), openPort()]);
const model = createHttpServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
  let message: Record<string, unknown>;
  if (!Array.isArray(body.tools)) {
    const invoiceText = String(body.messages?.at(-1)?.content ?? "");
    const invoice = invoiceText.match(/MERCURY-[A-Z0-9]+/)?.[0];
    const amount = invoiceText.match(/USD (0\.0[12])/)?.[1];
    message = { content: JSON.stringify({ vendorName: "Acme Studio", invoiceNumber: invoice,
      currency: "USD", amount, dueDate: "2026-10-20", summary: "Devnet design services" }) };
  } else if (body.tool_choice?.function?.name === "review_invoice") {
    message = { content: null, tool_calls: [{ id: "invoice-review", type: "function",
      function: { name: "review_invoice", arguments: "{}" } }] };
  } else {
    message = { content: "Review complete." };
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message }] }));
});
await new Promise<void>((resolve) => model.listen(modelPort, "127.0.0.1", resolve));
const root = new URL("../", import.meta.url).pathname;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: root,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(backendPort),
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: actor,
    MERCURY_COMPANY_MINT: DEVNET_USDC, MERCURY_ENABLE_FINANCE_ASSISTANT: "1",
    MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1",
    MERCURY_AGENT_MODEL_URL: `http://127.0.0.1:${modelPort}/v1/chat/completions`,
    MERCURY_AGENT_MODEL: "invoice-proof-model",
    MERCURY_VENDOR_REGISTRY_JSON: JSON.stringify({ acme_studio: {
      name: "Acme Studio", recipient, maxInvoiceMicro: "20000" } }) },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1000); });
const base = `http://127.0.0.1:${backendPort}`;
async function api(path: string, body?: Record<string, unknown>, method = "POST"): Promise<Record<string, any>> {
  const response = await fetch(base + path, { method,
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${String(value.error).slice(0, 250)}`);
  return value;
}
async function signedBody(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const challenge = await api("/v1/assistant/challenge", { actor });
  return { actor, challengeId: challenge.challengeId,
    signature: bs58.encode(nacl.sign.detached(Buffer.from(String(challenge.message)), founder.secretKey)), ...body };
}
async function send(transactionBase64: string, chain: "base" | "ephemeral"): Promise<{
  signature: string; signedTransactionBase64: string }> {
  const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
  assert.equal(transaction.feePayer?.toBase58(), actor);
  transaction.sign(founder);
  const signed = transaction.serialize().toString("base64");
  const endpoint = new URL(chain === "base" ? BASE_RPC : TEE_RPC);
  if (chain === "ephemeral") endpoint.searchParams.set("token", auth.token);
  const connection = new Connection(endpoint.toString(), "confirmed");
  const signature = await connection.sendRawTransaction(Buffer.from(signed, "base64"), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error(`${chain} transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  signatures.push(signature);
  return { signature, signedTransactionBase64: signed };
}
async function wait(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base + "/health")).ok) { ready = true; break; } } catch { /* Starting. */ }
    await wait(250);
  }
  if (!ready) throw new Error(`Backend failed to start: ${stderr.slice(0, 300)}`);
  const invoiceText = `Invoice ${invoiceNumber} from Acme Studio to Mercury Finance. Design services. Total due USD 0.01 on 2026-10-20. Devnet test invoice; human approval required.`;
  const reviewed = await api("/v1/agent/chat", await signedBody({ message: "Review this registered vendor invoice. Do not pay.",
    requestedTool: "review_invoice", invoiceText, selectedVendorId: "acme_studio" }));
  const suggestion = reviewed.actions?.find((item: { tool: string }) => item.tool === "review_invoice")?.result;
  assert.ok(suggestion, "Agent did not review the invoice");
  assert.equal(suggestion.amountMicro, "10000");
  const id = String(suggestion.paymentId);
  save({ status: "reviewed", paymentId: id, request: suggestion.requestAddress });
  const repeated = await api("/v1/agent/chat", await signedBody({ message: "Review the same invoice again.",
    requestedTool: "review_invoice", invoiceText, selectedVendorId: "acme_studio" }));
  const same = repeated.actions?.find((item: { tool: string }) => item.tool === "review_invoice")?.result;
  assert.equal(same.paymentId, id);
  assert.equal(same.repeated, true);
  const terms = { requester: actor, recipient, amountMicro: 10000, includeFinance: false };
  let flow: Record<string, any> = {};
  for (let i = 0; i < 35; i++) {
    flow = await api(`/v1/payment-flows/${id}/next`, { ...terms, actor });
    if (flow.step.status === "ready_to_execute" || flow.step.status === "ready") break;
    if (flow.step.status === "wait") {
      if (flow.receiptId) await api(`/v1/onboarding/receipts/${flow.receiptId}/reconcile`, {});
      await wait(700);
      continue;
    }
    assert.ok(flow.transaction?.transactionBase64 && flow.receiptId, "Missing guided transaction");
    const signed = await send(String(flow.transaction.transactionBase64), flow.transaction.sendTo);
    const receipt = await api(`/v1/onboarding/receipts/${flow.receiptId}/confirm`, {
      signedTransactionBase64: signed.signedTransactionBase64 });
    assert.equal(receipt.status, "confirmed");
    save({ status: String(flow.step.operation), paymentId: id, request: flow.request });
  }
  assert.ok(["ready_to_execute", "ready"].includes(flow.step.status),
    "Guided invoice request was not approved");
  if (flow.step.status === "ready_to_execute") {
    const planned = await api(`/v1/payment-jobs/${id}/prepare`, { actor });
    assert.ok(planned.transaction?.transactionBase64, "Missing private payout transaction");
    const payout = Transaction.from(Buffer.from(String(planned.transaction.transactionBase64), "base64"));
    payout.sign(founder);
    const submitted = await api(`/v1/payment-jobs/${id}/submit`, {
      signedTransactionBase64: payout.serialize().toString("base64") });
    assert.ok(["submitted", "uncertain", "already_settled"].includes(submitted.broadcast));
  }
  for (let i = 0; i < 20; i++) {
    const job = await api(`/v1/payment-jobs/${id}`, undefined, "GET");
    if (job.paymentSettled === true) {
      assert.equal(job.record.state, "settled");
      const privateRequest = await readPaymentRequest(company, String(flow.request), auth.token);
      assert.equal(privateRequest.status, "executed");
      const refreshed = await api(`/v1/payment-jobs/${id}/prepare`, { actor });
      assert.equal(refreshed.transaction, null, "Retry prepared a second payout");
      const mismatchText = invoiceText.replace("USD 0.01", "USD 0.02");
      const mismatch = await fetch(base + "/v1/agent/chat", { method: "POST",
        headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
        body: JSON.stringify(await signedBody({ message: "Review changed amount.",
          requestedTool: "review_invoice", invoiceText: mismatchText, selectedVendorId: "acme_studio" })) });
      assert.equal(mismatch.status, 400, "Changed invoice terms were accepted");
      let sync: Record<string, any> = {};
      for (let syncAttempt = 0; syncAttempt < 12; syncAttempt++) {
        sync = await api(`/v1/payment-jobs/${id}/snapshot-sync`, { actor });
        if (sync.status === "ready") break;
        if (sync.status === "build") {
          const signed = await send(String(sync.transaction.transactionBase64), "ephemeral");
          const receipt = await api(`/v1/onboarding/receipts/${sync.receiptId}/confirm`, {
            signedTransactionBase64: signed.signedTransactionBase64 });
          assert.equal(receipt.status, "confirmed");
        } else if (sync.status === "wait_for_snapshot") {
          await api(`/v1/onboarding/receipts/${sync.receiptId}/reconcile`, {});
        }
        await wait(700);
      }
      assert.equal(sync.status, "ready", "Treasury snapshot did not refresh");
      const snapshot = await readTreasurySnapshot(company, auth.token);
      let paymentOffset = 0;
      let found = false;
      do {
        const reconciled = await api("/v1/reconciliation/run", { paymentOffset, limit: 50 });
        found = reconciled.payments.some((row: { paymentId: string; paymentState: string }) =>
          row.paymentId === id && row.paymentState === "settled");
        paymentOffset = reconciled.nextPaymentOffset ?? -1;
      } while (!found && paymentOffset >= 0);
      assert.ok(found, "Reconciliation sweep missed the settled invoice payment");
      save({ status: "settled", paymentId: id, request: flow.request,
        payoutSignature: job.record.signature, snapshotMicro: snapshot.balanceMicro });
      console.log(JSON.stringify({ result: "PASS", paymentId: id, request: flow.request,
        payoutSignature: job.record.signature, steps: signatures.length,
        repeatedInvoiceSameId: true, changedAmountBlocked: true,
        secondPayoutBlocked: true, snapshotMicro: snapshot.balanceMicro,
        snapshotUpdatedSlot: snapshot.updatedSlot, reconciled: true }));
      process.exitCode = 0;
      break;
    }
    await wait(1000);
  }
  if (process.exitCode !== 0) throw new Error("Payout did not settle within proof window");
} finally {
  server.kill("SIGTERM");
  model.close();
}
