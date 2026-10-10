import { readFileSync } from "node:fs";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

type Source = {
  domain: string;
  file: URL;
  array: string;
  id: (row: Record<string, unknown>) => string | null;
};

const sources: Source[] = [
  { domain: "operation.payment", file: new URL("../.state/payments.json", import.meta.url), array: "payments", id: (row) => field(row, "paymentId") },
  { domain: "operation.payment-flow", file: new URL("../.state/payment-flows.json", import.meta.url), array: "flows", id: (row) => field(row, "paymentId") },
  { domain: "operation.payee", file: new URL("../.state/payees.json", import.meta.url), array: "payees", id: (row) => field(row, "payeeId") },
  { domain: "operation.payee-link", file: new URL("../.state/payees.json", import.meta.url), array: "links", id: (row) => field(row, "paymentId") },
  { domain: "operation.payroll-run", file: new URL("../.state/payroll-runs.json", import.meta.url), array: "runs", id: (row) => field(row, "runId") },
  { domain: "operation.payroll-schedule", file: new URL("../.state/payroll-schedules.json", import.meta.url), array: "schedules", id: (row) => field(row, "scheduleId") },
  { domain: "operation.invoice", file: new URL("../.state/invoices.json", import.meta.url), array: "invoices", id: (row) => field(row, "paymentId") },
  { domain: "operation.onboarding-receipt", file: new URL("../.state/onboarding-receipts.json", import.meta.url), array: "receipts", id: (row) => field(row, "id") },
  { domain: "operation.agent-session", file: new URL("../.state/agent-sessions.json", import.meta.url), array: "sessions", id: (row) => field(row, "id") },
  { domain: "operation.compliance-audit-share", file: new URL("../.state/compliance-audits.json", import.meta.url), array: "audits", id: (row) => field(row, "auditId") },
  { domain: "operation.x402-purchase", file: new URL("../.state/x402-purchases.json", import.meta.url), array: "purchases", id: (row) => field(row, "taskId") },
];

function field(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
}

function sourceRows(source: Source, company: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(readFileSync(source.file, "utf8")) as Record<string, unknown>;
    const rows = parsed[source.array];
    if (!Array.isArray(rows)) throw new Error(`Expected ${source.array} array`);
    return rows.filter((row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && !Array.isArray(row) && row.company === company,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read ${source.domain} source: ${(error as Error).message}`);
  }
}

const company = process.env.MERCURY_COMPANY_ADDRESS;
if (!company) throw new Error("Set MERCURY_COMPANY_ADDRESS in backend/.env.local");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set MERCURY_SUPABASE_URL and MERCURY_SUPABASE_SECRET_KEY in backend/.env.local");

const coverage: Record<string, { local: number; encrypted: number; missing: string[] }> = {};
for (const source of sources) {
  const expected = sourceRows(source, company);
  const ids = expected.map(source.id).map((id, index) => {
    if (!id) throw new Error(`${source.domain} source row ${index + 1} has no opaque ID`);
    return id;
  });
  if (ids.length > 500) throw new Error(`${source.domain} has over 500 rows; add paginated coverage before using this script`);
  const encrypted = await store.list<Record<string, unknown>>(company, source.domain, 500);
  const present = new Set(encrypted.map((record) => record.recordId));
  const missing = ids.filter((id) => !present.has(id));
  coverage[source.domain] = { local: ids.length, encrypted: encrypted.length, missing };
}

const failures = Object.entries(coverage).filter(([, result]) => result.missing.length > 0);
if (failures.length > 0) {
  throw new Error(`Encrypted database coverage incomplete: ${JSON.stringify(Object.fromEntries(failures))}`);
}
console.log(JSON.stringify({ result: "PASS", company, coverage }));
