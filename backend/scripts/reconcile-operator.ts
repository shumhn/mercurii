import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { TEE_RPC } from "../src/operations.ts";

type ReconciliationRow = { paymentId?: string; source?: "payment" | "invoice"; id?: string; next: string };
type PayrollSummary = { runId: string; state: string; failedCount: number; pendingCount: number; approvalPendingCount: number };
type Attention = { kind: "payment" | "invoice" | "receipt" | "payroll" | "treasury"; id?: string; action: string };

const keyPath = process.env.MERCURY_FOUNDER_KEYPAIR;
if (!keyPath) throw new Error("MERCURY_FOUNDER_KEYPAIR is required");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const backendUrl = new URL(process.env.MERCURY_BACKEND_URL ?? "http://127.0.0.1:8787");
if (!['http:', 'https:'].includes(backendUrl.protocol)) throw new Error("Invalid backend URL");
if (backendUrl.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(backendUrl.hostname)) {
  throw new Error("Remote backend URL must use HTTPS for the TEE token");
}
const watch = process.argv.includes("--watch");
const intervalMs = Number(process.env.MERCURY_RECONCILIATION_INTERVAL_MS ?? "60000");
if (watch && (!Number.isSafeInteger(intervalMs) || intervalMs < 10_000)) {
  throw new Error("MERCURY_RECONCILIATION_INTERVAL_MS must be at least 10000");
}

async function request(path: string, token: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(new URL(path, backendUrl), {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${value.error ?? "invalid response"}`);
  return value;
}

function needsAttention(next: string): boolean {
  return !["complete", "closed", "continue_guided_flow"].includes(next);
}

async function sweep(): Promise<void> {
  const auth = await getAuthToken(TEE_RPC, founder.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, founder.secretKey));
  let paymentOffset: number | null = 0;
  let receiptOffset: number | null = 0;
  let paymentCount = 0;
  let receiptCount = 0;
  const actions: Record<string, number> = {};
  const attention: Attention[] = [];
  do {
    const page = await request("/v1/reconciliation/run", auth.token, {
      paymentOffset: paymentOffset ?? Number.MAX_SAFE_INTEGER,
      receiptOffset: receiptOffset ?? Number.MAX_SAFE_INTEGER, limit: 50,
    }) as { payments: ReconciliationRow[]; receipts: ReconciliationRow[]; nextPaymentOffset?: number | null; nextReceiptOffset?: number | null };
    paymentCount += page.payments.length;
    receiptCount += page.receipts.length;
    for (const item of page.payments) {
      actions[item.next] = (actions[item.next] ?? 0) + 1;
      if (needsAttention(item.next)) attention.push({ kind: item.source === "invoice" ? "invoice" : "payment", id: item.paymentId, action: item.next });
    }
    for (const item of page.receipts) {
      actions[item.next] = (actions[item.next] ?? 0) + 1;
      if (needsAttention(item.next)) attention.push({ kind: "receipt", id: item.id, action: item.next });
    }
    paymentOffset = page.nextPaymentOffset ?? null;
    receiptOffset = page.nextReceiptOffset ?? null;
  } while (paymentOffset !== null || receiptOffset !== null);

  const listed = await request("/v1/payroll-runs", auth.token);
  const payroll: PayrollSummary[] = [];
  for (const run of listed.runs ?? []) {
    const status = await request(`/v1/payroll-runs/${encodeURIComponent(String(run.runId))}`, auth.token) as PayrollSummary;
    payroll.push(status);
    if (status.state !== "paid" && status.state !== "rejected") {
      attention.push({ kind: "payroll", id: status.runId,
        action: status.state === "failed" ? "recover_confirmed_failed_items" : `review_${status.state}` });
    }
  }
  if (attention.some((item) => item.action === "sign_snapshot_sync")) {
    attention.push({ kind: "treasury", action: "Founder_or_Finance_sign_snapshot_sync" });
  }
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), paymentCount, receiptCount,
    payroll: payroll.map(({ runId, state, failedCount, pendingCount, approvalPendingCount }) =>
      ({ runId, state, failedCount, pendingCount, approvalPendingCount })), actions, attention }) + "\n");
}

do {
  try { await sweep(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (!watch) process.exitCode = 1;
  }
  if (watch) await new Promise((resolve) => setTimeout(resolve, intervalMs));
} while (watch);
