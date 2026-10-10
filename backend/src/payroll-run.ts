import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { asAddress, asMicroAmount } from "./magicblock.ts";
import { getOrCreatePaymentFlow } from "./payment-flow.ts";
import { paymentId } from "./payment-journal.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

const DEFAULT_PATH = new URL("../.state/payroll-runs.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYROLL_JOURNAL ?? DEFAULT_PATH;
// Bound one HTTP request and its local journal work; approval is split into
// several Solana transactions when the roster cannot fit in one.
const MAX_ROSTER_ITEMS = 100;

export type PayrollItem = { paymentId: string; request: string; requester: string; requestId: string };
export type PayrollRun = {
  runId: string; company: string; termsHash: string; items: PayrollItem[]; createdAt: string;
  scheduleId: string | null; rosterRevision: number | null; payDate: string | null;
};
export type PayrollProgressItem = { paymentId: string; requestStatus: string;
  paymentState: string | null; amountMicro: string | null };
type Journal = { version: 1; runs: PayrollRun[] };

function readJournal(): Journal {
  try {
    const value = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (value.version !== 1 || !Array.isArray(value.runs)) throw new Error("Invalid payroll journal");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, runs: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "payroll-runs", journal, rowKeys: ["runs"] });
}

function itemId(runId: string, index: number): string {
  const bytes = createHash("sha256").update(`mercury-payroll:${runId}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return paymentId(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}

export function getPayrollRun(runIdInput: unknown, companyInput: unknown): PayrollRun {
  const runId = paymentId(runIdInput);
  const company = asAddress(companyInput, "company");
  const run = readJournal().runs.find((item) => item.runId === runId && item.company === company);
  if (!run) throw new Error("Unknown payroll run");
  return run;
}

export function listPayrollRuns(companyInput: unknown): Array<Pick<PayrollRun, "runId" | "createdAt"> & { itemCount: number }> {
  const company = asAddress(companyInput, "company");
  return readJournal().runs.filter((run) => run.company === company).reverse().map((run) => ({
    runId: run.runId, createdAt: run.createdAt, itemCount: run.items.length,
  }));
}

export function createPayrollRun(runIdInput: unknown, companyInput: unknown, input: Record<string, unknown>): PayrollRun {
  const runId = paymentId(runIdInput);
  const company = asAddress(companyInput, "company");
  const requester = asAddress(input.requester, "requester");
  const source = payrollSource(input);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ROSTER_ITEMS) {
    throw new Error(`Payroll run requires 1 to ${MAX_ROSTER_ITEMS} employees`);
  }
  const rows = input.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid employee at index ${index}`);
    const record = item as Record<string, unknown>;
    const recipient = asAddress(record.recipient, `items[${index}].recipient`);
    if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) {
      throw new Error(`items[${index}].recipient must be a wallet owner`);
    }
    if (recipient === requester) throw new Error("Employee recipient cannot be the requester");
    return { recipient, amountMicro: asMicroAmount(record.amountMicro) };
  });
  if (new Set(rows.map((row) => row.recipient)).size !== rows.length) {
    throw new Error("Each employee may appear only once in a payroll run");
  }
  const total = rows.reduce((sum, row) => sum + BigInt(row.amountMicro), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Payroll total exceeds safe integer range");
  const termsHash = createHash("sha256").update(JSON.stringify({ requester, rows, source })).digest("hex");
  const journal = readJournal();
  const existing = journal.runs.find((item) => item.runId === runId);
  if (existing && (existing.company !== company || existing.termsHash !== termsHash)) {
    throw new Error("Payroll run ID is already bound to different employees or amounts");
  }
  const items = rows.map((row, index) => {
    const id = itemId(runId, index);
    const { flow } = getOrCreatePaymentFlow(id, company, {
      requester, recipient: row.recipient, amountMicro: row.amountMicro,
      includeFinance: true,
    });
    return { paymentId: id, request: flow.request, requester: flow.requester, requestId: flow.requestId };
  });
  if (existing) return existing;
  const run: PayrollRun = { runId, company, termsHash, items, createdAt: new Date().toISOString(), ...source };
  journal.runs.push(run);
  saveJournal(journal);
  return run;
}

function payrollSource(input: Record<string, unknown>): Pick<PayrollRun, "scheduleId" | "rosterRevision" | "payDate"> {
  const sourceFields = [input.scheduleId, input.rosterRevision, input.payDate];
  if (sourceFields.every((value) => value === undefined)) {
    return { scheduleId: null, rosterRevision: null, payDate: null };
  }
  const scheduleId = paymentId(input.scheduleId);
  if (!Number.isSafeInteger(input.rosterRevision) || Number(input.rosterRevision) < 1) {
    throw new Error("rosterRevision must be a positive integer");
  }
  if (typeof input.payDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.payDate)) {
    throw new Error("payDate must be YYYY-MM-DD");
  }
  return { scheduleId, rosterRevision: Number(input.rosterRevision), payDate: input.payDate };
}

export function payrollNextAction(item: PayrollProgressItem): string {
  if (item.requestStatus === "executed") return "complete";
  if (item.requestStatus === "rejected") return "rejected";
  if (item.requestStatus === "submitted") return "approve_run";
  if (item.requestStatus !== "approved") return "finish_private_request";
  if (item.paymentState === "submitted") return "reconcile_or_resend_same_signature";
  if (item.paymentState === "prepared") return "submit_prepared_or_rebuild_after_timeout";
  return "prepare_payout";
}

export function summarizePayroll(items: PayrollProgressItem[]) {
  let knownTotal = 0n;
  let settled = 0n;
  let failed = 0n;
  let pending = 0n;
  let settledCount = 0;
  let failedCount = 0;
  let rejectedCount = 0;
  const retryablePaymentIds: string[] = [];
  for (const item of items) {
    const amount = item.amountMicro === null ? 0n : BigInt(item.amountMicro);
    knownTotal += amount;
    if (item.requestStatus === "executed") { settled += amount; settledCount++; }
    else if (item.requestStatus === "approved" && item.paymentState === "failed") {
      failed += amount;
      failedCount++;
      retryablePaymentIds.push(item.paymentId);
    } else {
      pending += amount;
      if (item.requestStatus === "rejected") rejectedCount++;
    }
  }
  const state = settledCount === items.length ? "paid"
    : settledCount > 0 ? "partial"
    : failedCount > 0 ? "failed"
    : rejectedCount > 0 ? "rejected"
    : items.some((item) => item.requestStatus === "submitted") ? "approval_pending"
    : items.some((item) => item.requestStatus === "approved") ? "paying"
    : "preparing";
  return { knownTotalMicro: knownTotal.toString(), settledMicro: settled.toString(),
    failedMicro: failed.toString(), pendingMicro: pending.toString(),
    state, settledCount, failedCount, rejectedCount,
    pendingCount: items.length - settledCount - failedCount,
    unsubmittedCount: items.filter((item) => item.amountMicro === null).length,
    retryablePaymentIds,
    approvalPendingCount: items.filter((item) => item.requestStatus === "submitted").length,
    readyToApprove: items.some((item) => item.requestStatus === "submitted") &&
      items.every((item) => ["submitted", "approved", "executed"].includes(item.requestStatus)) };
}
