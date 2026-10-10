import { readFileSync } from "node:fs";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

type Source = { domain: string; file: URL; array: string; id: (row: Record<string, unknown>, index: number) => string | null };
const sources: Source[] = [
  { domain: "payment", file: new URL("../.state/payments.json", import.meta.url), array: "payments", id: (row) => stringField(row, "paymentId") },
  // `operation.payment` is the deployed database-primary payment repository.
  // Keep the older `payment` copy during migration so prior checkpoint and
  // audit tooling can still read its historical domain without a flag day.
  { domain: "operation.payment", file: new URL("../.state/payments.json", import.meta.url), array: "payments", id: (row) => stringField(row, "paymentId") },
  { domain: "payment-flow", file: new URL("../.state/payment-flows.json", import.meta.url), array: "flows", id: (row) => stringField(row, "paymentId") },
  { domain: "operation.payment-flow", file: new URL("../.state/payment-flows.json", import.meta.url), array: "flows", id: (row) => stringField(row, "paymentId") },
  { domain: "payee", file: new URL("../.state/payees.json", import.meta.url), array: "payees", id: (row) => stringField(row, "payeeId") },
  { domain: "operation.payee", file: new URL("../.state/payees.json", import.meta.url), array: "payees", id: (row) => stringField(row, "payeeId") },
  { domain: "payee-link", file: new URL("../.state/payees.json", import.meta.url), array: "links", id: (row) => stringField(row, "paymentId") },
  { domain: "operation.payee-link", file: new URL("../.state/payees.json", import.meta.url), array: "links", id: (row) => stringField(row, "paymentId") },
  { domain: "payroll-run", file: new URL("../.state/payroll-runs.json", import.meta.url), array: "runs", id: (row) => stringField(row, "runId") },
  { domain: "operation.payroll-run", file: new URL("../.state/payroll-runs.json", import.meta.url), array: "runs", id: (row) => stringField(row, "runId") },
  { domain: "payroll-schedule", file: new URL("../.state/payroll-schedules.json", import.meta.url), array: "schedules", id: (row) => stringField(row, "scheduleId") },
  { domain: "operation.payroll-schedule", file: new URL("../.state/payroll-schedules.json", import.meta.url), array: "schedules", id: (row) => stringField(row, "scheduleId") },
  { domain: "invoice", file: new URL("../.state/invoices.json", import.meta.url), array: "invoices", id: (row) => stringField(row, "paymentId") },
  { domain: "operation.invoice", file: new URL("../.state/invoices.json", import.meta.url), array: "invoices", id: (row) => stringField(row, "paymentId") },
  { domain: "onboarding-receipt", file: new URL("../.state/onboarding-receipts.json", import.meta.url), array: "receipts", id: (row) => stringField(row, "id") },
  { domain: "operation.onboarding-receipt", file: new URL("../.state/onboarding-receipts.json", import.meta.url), array: "receipts", id: (row) => stringField(row, "id") },
  { domain: "agent-session", file: new URL("../.state/agent-sessions.json", import.meta.url), array: "sessions", id: (row) => stringField(row, "id") },
  { domain: "operation.agent-session", file: new URL("../.state/agent-sessions.json", import.meta.url), array: "sessions", id: (row) => stringField(row, "id") },
  { domain: "compliance-audit-share", file: new URL("../.state/compliance-audits.json", import.meta.url), array: "audits", id: (row) => stringField(row, "auditId") },
  { domain: "operation.compliance-audit-share", file: new URL("../.state/compliance-audits.json", import.meta.url), array: "audits", id: (row) => stringField(row, "auditId") },
  { domain: "x402-purchase", file: new URL("../.state/x402-purchases.json", import.meta.url), array: "purchases", id: (row) => stringField(row, "taskId") },
  { domain: "operation.x402-purchase", file: new URL("../.state/x402-purchases.json", import.meta.url), array: "purchases", id: (row) => stringField(row, "taskId") },
];

function stringField(row: Record<string, unknown>, name: string): string | null {
  return typeof row[name] === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(row[name]) ? row[name] : null;
}

function readRows(source: Source): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(readFileSync(source.file, "utf8")) as Record<string, unknown>;
    const rows = parsed[source.array];
    if (!Array.isArray(rows)) throw new Error("Expected array");
    return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read ${source.domain} journal: ${(error as Error).message}`);
  }
}

const company = process.env.MERCURY_COMPANY_ADDRESS;
const founder = process.env.MERCURY_FOUNDER_ADDRESS;
const mint = process.env.MERCURY_COMPANY_MINT;
if (!company || !founder || !mint) {
  throw new Error("Set MERCURY_COMPANY_ADDRESS, MERCURY_FOUNDER_ADDRESS, and MERCURY_COMPANY_MINT before backfill");
}
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set MERCURY_SUPABASE_URL and MERCURY_SUPABASE_SECRET_KEY in backend/.env.local");

await store.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company, mintAddress: mint,
  perValidator: TEE_VALIDATOR.toBase58() });
const counts: Record<string, number> = {};
for (const source of sources) {
  let count = 0;
  for (const [index, row] of readRows(source).entries()) {
    if (row.company !== company) continue;
    const recordId = source.id(row, index);
    if (!recordId) throw new Error(`${source.domain} journal row ${index + 1} has no safe opaque ID`);
    await store.put({ companyId: company, domain: source.domain, recordId, payload: row,
      metadata: { source: "local-json-backfill" } });
    count++;
  }
  counts[source.domain] = count;
}

console.log(JSON.stringify({ result: "PASS", company, encryptedRecordsBackfilled: counts }));
