import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { asAddress, asMicroAmount } from "./magicblock.ts";
import { getOrCreatePaymentFlow } from "./payment-flow.ts";
import { paymentId } from "./payment-journal.ts";

const DEFAULT_PATH = new URL("../.state/payroll-runs.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYROLL_JOURNAL ?? DEFAULT_PATH;
const MAX_ITEMS = 4; // One small run fits in one PER approval transaction.

export type PayrollItem = { paymentId: string; request: string; requester: string; requestId: string };
export type PayrollRun = {
  runId: string; company: string; termsHash: string; items: PayrollItem[]; createdAt: string;
};
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

export function createPayrollRun(runIdInput: unknown, companyInput: unknown, input: Record<string, unknown>): PayrollRun {
  const runId = paymentId(runIdInput);
  const company = asAddress(companyInput, "company");
  const requester = asAddress(input.requester, "requester");
  if (!Array.isArray(input.items) || input.items.length < 2 || input.items.length > MAX_ITEMS) {
    throw new Error(`Payroll run requires 2 to ${MAX_ITEMS} employees`);
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
  const termsHash = createHash("sha256").update(JSON.stringify({ requester, rows })).digest("hex");
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
  const run: PayrollRun = { runId, company, termsHash, items, createdAt: new Date().toISOString() };
  journal.runs.push(run);
  saveJournal(journal);
  return run;
}
