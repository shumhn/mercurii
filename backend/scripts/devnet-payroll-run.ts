import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR } from "../src/operations.ts";
import { DEVNET_USDC, prepareRecipientOnboarding, readRecipientBalance } from "../src/magicblock.ts";
import { openPayrollRoster, sealPayrollRoster } from "../src/payroll-roster-crypto.ts";
import { localDate } from "../src/payroll-schedule.ts";
import { payrollScheduleMessage } from "../src/payroll-schedule-auth.ts";

const COMPANY = process.env.MERCURY_COMPANY_ADDRESS;
if (!COMPANY) throw new Error("MERCURY_COMPANY_ADDRESS is required");
function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = key("MERCURY_FOUNDER_KEYPAIR");
const onboardingPayer = process.env.MERCURY_PAYROLL_ONBOARDING_PAYER_KEYPAIR
  ? key("MERCURY_PAYROLL_ONBOARDING_PAYER_KEYPAIR") : null;
const recipientPaths = process.env.MERCURY_PAYROLL_RECIPIENT_KEYPAIRS?.split(",").map((path) => path.trim()).filter(Boolean);
const recipients = recipientPaths?.length
  ? recipientPaths.map((path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))))
  : [key("MERCURY_PAYROLL_RECIPIENT_1_KEYPAIR"), key("MERCURY_PAYROLL_RECIPIENT_2_KEYPAIR")];
if (recipients.length < 2 || new Set(recipients.map((wallet) => wallet.publicKey.toBase58())).size !== recipients.length) {
  throw new Error("Provide at least two distinct payroll recipient wallets");
}
const expectSecondFailure = process.env.MERCURY_PAYROLL_EXPECT_SECOND_FAILURE === "1";
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));
const token = auth.token;
function signedSchedule(operation: "create" | "update" | "launch", body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, signature: bs58.encode(nacl.sign.detached(
    payrollScheduleMessage(operation, COMPANY!, body), founder.secretKey)) };
}
const port = Number(process.env.MERCURY_PAYROLL_PORT ?? "18787");
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), MERCURY_COMPANY_ADDRESS: COMPANY,
    MERCURY_FOUNDER_ADDRESS: founder.publicKey.toBase58(), MERCURY_COMPANY_MINT: DEVNET_USDC,
    MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1", MERCURY_ENABLE_EXPERIMENTAL_RECEIVE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

async function api(path: string, body?: Record<string, unknown>, method?: "GET" | "POST" | "PATCH"): Promise<any> {
  const response = await fetch(`${base}${path}`, { method: method ?? (body ? "POST" : "GET"),
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
async function send(transaction: any, signer = founder): Promise<{ signed: string; signature: string }> {
  const tx = Transaction.from(Buffer.from(transaction.transactionBase64, "base64"));
  tx.sign(signer);
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

async function registerPayrollRecipient(recipient: Keypair, depositId: string): Promise<void> {
  if (!onboardingPayer) {
    throw new Error("MERCURY_PAYROLL_ONBOARDING_PAYER_KEYPAIR with Circle devnet USDC is required to register a new payroll recipient");
  }
  const next = await api("/v1/onboarding/recipient/next", { recipient: recipient.publicKey.toBase58(),
    payer: onboardingPayer.publicKey.toBase58(), amountMicro: 1, depositId });
  if (next.status === "ready") return;
  assert.equal(next.status, "needs_deposit");
  const sent = await send(next.transaction, onboardingPayer);
  const receipt = await api(`/v1/onboarding/receipts/${next.receiptId}/confirm`, { signedTransactionBase64: sent.signed });
  assert.equal(receipt.status, "confirmed");
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
  let runId = randomUUID();
  const payeeIds = recipients.map(() => randomUUID());
  for (const [index, wallet] of recipients.entries()) {
    await api("/v1/payees", { actor: founder.publicKey.toBase58(), payeeId: payeeIds[index],
      kind: "employee", teamId: "demo", recipient: wallet.publicKey.toBase58() });
  }
  assert.ok((await api("/v1/payees")).payees.length >= recipients.length);
  const csvText = `wallet,amount_usdc\n${recipients.map((wallet) =>
    `${wallet.publicKey.toBase58()},0.000001`).join("\n")}\n`;
  const preview = await api("/v1/payroll-runs/preview", { csvText });
  assert.equal(preview.canCreateRun, true);
  assert.equal(preview.totalMicro, String(recipients.length));
  assert.equal(preview.budgetCoversValidRows, true);
  const roster = { runId, requester: founder.publicKey.toBase58(),
    items: preview.items.map((item: any) => ({ recipient: item.recipient, amountMicro: item.amountMicro })) };
  for (const [index, recipient] of recipients.entries()) {
    await registerPayrollRecipient(recipient, `ready-${runId.slice(0, 8)}-${index}`);
  }
  const readiness = await api("/v1/payroll-runs/readiness", { items: roster.items });
  assert.equal(readiness.recipientsReady, true);
  assert.equal(readiness.policyCoversTotal, true);
  assert.equal(readiness.snapshotCoversTotal, true);
  assert.equal(readiness.canCreateRun, true);
  const useSchedule = process.env.MERCURY_PAYROLL_TEST_SCHEDULE === "1";
  let scheduleId: string | null = null;
  let run: any;
  if (useSchedule) {
    scheduleId = randomUUID();
    const payDate = localDate(new Date(), "Asia/Kathmandu");
    const passphrase = `devnet-only-${randomUUID()}`;
    const encryptedRoster = sealPayrollRoster({ requester: roster.requester, items: roster.items }, passphrase);
    const schedule = await api("/v1/payroll-schedules", signedSchedule("create", { actor: founder.publicKey.toBase58(),
      scheduleId, name: "Devnet payroll", cadence: "weekly", firstPayDate: payDate,
      timeZone: "Asia/Kathmandu", encryptedRoster }));
    assert.equal(schedule.dueCycles[0]?.payDate, payDate);
    const recovered = await api(`/v1/payroll-schedules/${scheduleId}`);
    assert.deepEqual(openPayrollRoster(recovered.encryptedRoster, passphrase),
      { requester: roster.requester, items: roster.items });
    const launchBody = signedSchedule("launch", { actor: founder.publicKey.toBase58(), scheduleId,
      payDate, rosterRevision: schedule.rosterRevision, requester: roster.requester, items: roster.items });
    run = await api(`/v1/payroll-schedules/${scheduleId}/launch`, launchBody);
    runId = run.runId;
    assert.equal((await api(`/v1/payroll-schedules/${scheduleId}/launch`, launchBody)).runId, runId);
  } else {
    run = await api("/v1/payroll-runs", roster);
    assert.deepEqual((await api("/v1/payroll-runs", roster)).items, run.items);
  }
  assert.equal((await api("/v1/payroll-runs")).runs.some((entry: { runId: string }) => entry.runId === runId), true);
  assert.equal(run.items.length, recipients.length);
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
  const approvalSignatures: string[] = [];
  for (let attempt = 0; attempt < recipients.length + 5; attempt++) {
    const approved = await api(`/v1/payroll-runs/${runId}/approve`, { actor: founder.publicKey.toBase58() });
    if (approved.status === "ready") break;
    if (approved.status === "wait") {
      await new Promise((resolve) => setTimeout(resolve, 750));
      continue;
    }
    assert.equal(approved.status, "build");
    const approval = await send(approved.transaction);
    approvalSignatures.push(approval.signature);
    await api(`/v1/onboarding/receipts/${approved.receiptId}/confirm`, { signedTransactionBase64: approval.signed });
    if (attempt === recipients.length + 4) throw new Error("Payroll approval chunks did not complete");
  }
  assert.ok(approvalSignatures.length > 0);
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
      assert.equal(partial.pendingMicro, String(recipients.length - 1));
      const replay = await api(`/v1/payment-jobs/${item.paymentId}/prepare`, { actor: founder.publicKey.toBase58() });
      assert.equal(replay.transaction, null);
    }
  }
  const final = await api(`/v1/payroll-runs/${runId}`);
  assert.equal(final.settledCount, recipients.length);
  assert.equal(final.settledMicro, String(recipients.length));
  assert.equal(final.retryablePaymentIds.length, 0);
  const history = await api("/v1/payment-jobs?limit=100");
  for (const [index, item] of run.items.entries()) {
    assert.ok(history.payments.some((row: any) => row.record.paymentId === item.paymentId &&
      row.record.state === "settled" && row.payee?.payeeId === payeeIds[index]));
  }
  if (scheduleId) {
    const schedule = await api(`/v1/payroll-schedules/${scheduleId}`);
    const paused = await api(`/v1/payroll-schedules/${scheduleId}`,
      signedSchedule("update", { actor: founder.publicKey.toBase58(), scheduleId,
        expectedRevision: schedule.revision, paused: true }), "PATCH");
    assert.equal(paused.paused, true);
    assert.equal(paused.revision, schedule.revision + 1);
  }
  process.stdout.write(JSON.stringify({ result: "PASS", runId, scheduleId, approvalSignatures,
    payoutSignatures: signatures, failedSignature, onboardingSignature, settledCount: final.settledCount,
    requests: run.items.map((item: any) => item.request) }, null, 2) + "\n");
} finally {
  server.kill("SIGTERM");
}
