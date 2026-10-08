import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR } from "../src/operations.ts";
import { DEVNET_USDC, prepareRecipientOnboarding, readRecipientBalance } from "../src/magicblock.ts";

const COMPANY = process.env.MERCURY_COMPANY_ADDRESS;
if (!COMPANY) throw new Error("MERCURY_COMPANY_ADDRESS is required");
function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = key("MERCURY_FOUNDER_KEYPAIR");
const recipients = [key("MERCURY_PAYROLL_RECIPIENT_1_KEYPAIR"), key("MERCURY_PAYROLL_RECIPIENT_2_KEYPAIR")];
const expectSecondFailure = process.env.MERCURY_PAYROLL_EXPECT_SECOND_FAILURE === "1";
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));
const token = auth.token;
const port = Number(process.env.MERCURY_PAYROLL_PORT ?? "18787");
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), MERCURY_COMPANY_ADDRESS: COMPANY,
    MERCURY_FOUNDER_ADDRESS: founder.publicKey.toBase58(), MERCURY_COMPANY_MINT: DEVNET_USDC,
    MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

async function api(path: string, body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(value)}`);
  return value;
}
async function waitForServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await api("/health"); return; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw new Error("Payroll backend did not start");
}
async function send(transaction: any): Promise<{ signed: string; signature: string }> {
  const tx = Transaction.from(Buffer.from(transaction.transactionBase64, "base64"));
  tx.sign(founder);
  const signed = tx.serialize().toString("base64");
  const url = new URL(transaction.sendTo === "base" ? BASE_RPC : TEE_RPC);
  if (transaction.sendTo === "ephemeral") url.searchParams.set("token", token);
  const rpc = new Connection(url.toString(), "confirmed");
  const signature = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: transaction.sendTo === "ephemeral", maxRetries: 3 });
  for (let i = 0; i < 30; i++) {
    const state = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (state?.err) throw new Error(`Transaction failed ${signature}: ${JSON.stringify(state.err)}`);
    if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") return { signed, signature };
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Transaction timed out: ${signature}`);
}

async function onboardFailedRecipient(): Promise<string> {
  const payer = key("MERCURY_PAYROLL_ONBOARDING_PAYER_KEYPAIR");
  const recipient = recipients[1]!;
  const built = await prepareRecipientOnboarding({ payer: payer.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(), amountMicro: 1,
    expectedValidator: TEE_VALIDATOR.toBase58() });
  assert.equal(built.sendTo, "base");
  const raw = Buffer.from(built.transactionBase64, "base64");
  let signed: Buffer;
  try {
    const transaction = VersionedTransaction.deserialize(raw);
    transaction.sign([payer]);
    signed = Buffer.from(transaction.serialize());
  } catch {
    const transaction = Transaction.from(raw);
    transaction.sign(payer);
    signed = transaction.serialize();
  }
  const rpc = new Connection(BASE_RPC, "confirmed");
  const signature = await rpc.sendRawTransaction(signed, { maxRetries: 3 });
  for (let i = 0; i < 35; i++) {
    const state = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (state?.err) throw new Error(`Recipient onboarding failed: ${JSON.stringify(state.err)}`);
    if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") break;
    if (i === 34) throw new Error("Recipient onboarding timed out");
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const auth = await getAuthToken(TEE_RPC, recipient.publicKey,
    async (message: Uint8Array) => nacl.sign.detached(message, recipient.secretKey));
  for (let i = 0; i < 40; i++) {
    try {
      await readRecipientBalance({ owner: recipient.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: auth.token });
      return signature;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("Recipient private balance did not become ready");
}

await waitForServer();
try {
  const runId = randomUUID();
  const payeeIds = recipients.map(() => randomUUID());
  for (const [index, wallet] of recipients.entries()) {
    await api("/v1/payees", { actor: founder.publicKey.toBase58(), payeeId: payeeIds[index],
      kind: "employee", teamId: "demo", recipient: wallet.publicKey.toBase58() });
  }
  assert.ok((await api("/v1/payees")).payees.length >= 2);
  const csvText = `wallet,amount_usdc\n${recipients[0]!.publicKey.toBase58()},0.000001\n` +
    `${recipients[1]!.publicKey.toBase58()},0.000001\n`;
  const preview = await api("/v1/payroll-runs/preview", { csvText });
  assert.equal(preview.canCreateSmallRun, true);
  assert.equal(preview.totalMicro, "2");
  assert.equal(preview.budgetCoversValidRows, true);
  const roster = { runId, requester: founder.publicKey.toBase58(),
    items: preview.items.map((item: any) => ({ recipient: item.recipient, amountMicro: item.amountMicro })) };
  const run = await api("/v1/payroll-runs", roster);
  assert.equal(run.items.length, 2);
  assert.deepEqual((await api("/v1/payroll-runs", roster)).items, run.items);
  for (const [index, item] of run.items.entries()) {
    for (let attempt = 0; attempt < 45; attempt++) {
      const next = await api(item.next, { actor: founder.publicKey.toBase58(), requester: founder.publicKey.toBase58(),
        ...roster.items[index], payeeId: payeeIds[index] });
      if (next.observation.status === "submitted") break;
      if (next.transaction) {
        const sent = await send(next.transaction);
        await api(`/v1/onboarding/receipts/${next.receiptId}/confirm`, { signedTransactionBase64: sent.signed });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (attempt === 44) throw new Error(`Payroll item ${index} did not submit`);
    }
  }
  const before = await api(`/v1/payroll-runs/${runId}`);
  assert.equal(before.readyToApprove, true);
  const approved = await api(`/v1/payroll-runs/${runId}/approve`, { actor: founder.publicKey.toBase58() });
  assert.equal(approved.status, "build");
  const approval = await send(approved.transaction);
  await api(`/v1/onboarding/receipts/${approved.receiptId}/confirm`, { signedTransactionBase64: approval.signed });
  for (let i = 0; i < 20; i++) {
    const state = await api(`/v1/payroll-runs/${runId}`);
    if (state.items.every((item: any) => item.requestStatus === "approved")) break;
    if (i === 19) throw new Error("Payroll approval did not appear on PER");
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const signatures: string[] = [];
  let failedSignature: string | null = null;
  let onboardingSignature: string | null = null;
  for (const [index, item] of run.items.entries()) {
    const prepared = await api(`/v1/payment-jobs/${item.paymentId}/prepare`, { actor: founder.publicKey.toBase58() });
    assert.equal(prepared.record.state, "prepared");
    const tx = Transaction.from(Buffer.from(prepared.transaction.transactionBase64, "base64"));
    tx.sign(founder);
    const result = await api(`/v1/payment-jobs/${item.paymentId}/submit`, { signedTransactionBase64: tx.serialize().toString("base64") });
    assert.ok(["submitted", "uncertain"].includes(result.broadcast));
    let outcome: "settled" | "failed" | null = null;
    for (let i = 0; i < 30; i++) {
      const state = await api(`/v1/payment-jobs/${item.paymentId}`);
      if (state.record.state === "settled" || state.record.state === "failed") {
        outcome = state.record.state;
        break;
      }
      if (i === 29) throw new Error(`Payout ${index} did not resolve`);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (expectSecondFailure && index === 1) {
      assert.equal(outcome, "failed");
      failedSignature = result.record.signature;
      const failed = await api(`/v1/payroll-runs/${runId}`);
      assert.equal(failed.settledCount, 1);
      assert.equal(failed.failedCount, 1);
      assert.deepEqual(failed.retryablePaymentIds, [item.paymentId]);
      onboardingSignature = await onboardFailedRecipient();
      const retry = await api(`/v1/payment-jobs/${item.paymentId}/prepare`, { actor: founder.publicKey.toBase58() });
      assert.equal(retry.record.state, "prepared");
      const retryTx = Transaction.from(Buffer.from(retry.transaction.transactionBase64, "base64"));
      retryTx.sign(founder);
      const resent = await api(`/v1/payment-jobs/${item.paymentId}/submit`,
        { signedTransactionBase64: retryTx.serialize().toString("base64") });
      assert.ok(["submitted", "uncertain"].includes(resent.broadcast));
      for (let i = 0; i < 30; i++) {
        const state = await api(`/v1/payment-jobs/${item.paymentId}`);
        if (state.record.state === "settled") break;
        if (i === 29) throw new Error("Retry payout did not settle");
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      signatures.push(resent.record.signature);
    } else {
      assert.equal(outcome, "settled");
      signatures.push(result.record.signature);
    }
    if (index === 0) {
      const partial = await api(`/v1/payroll-runs/${runId}`);
      assert.equal(partial.settledCount, 1);
      assert.equal(partial.settledMicro, "1");
      assert.equal(partial.pendingMicro, "1");
      const replay = await api(`/v1/payment-jobs/${item.paymentId}/prepare`, { actor: founder.publicKey.toBase58() });
      assert.equal(replay.transaction, null);
    }
  }
  const final = await api(`/v1/payroll-runs/${runId}`);
  assert.equal(final.settledCount, 2);
  assert.equal(final.settledMicro, "2");
  assert.equal(final.retryablePaymentIds.length, 0);
  const history = await api("/v1/payment-jobs?limit=100");
  for (const [index, item] of run.items.entries()) {
    assert.ok(history.payments.some((row: any) => row.record.paymentId === item.paymentId &&
      row.record.state === "settled" && row.payee?.payeeId === payeeIds[index]));
  }
  process.stdout.write(JSON.stringify({ result: "PASS", runId, approvalSignature: approval.signature,
    payoutSignatures: signatures, failedSignature, onboardingSignature, settledCount: final.settledCount,
    requests: run.items.map((item: any) => item.request) }, null, 2) + "\n");
} finally {
  server.kill("SIGTERM");
}
