import { readFileSync } from "node:fs";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

type Snapshot = { domain: string; file: URL; rowKeys: string[]; sharedKeys?: string[] };
const snapshots: Snapshot[] = [
  { domain: "payments", file: new URL("../.state/payments.json", import.meta.url), rowKeys: ["payments"] },
  { domain: "payment-flows", file: new URL("../.state/payment-flows.json", import.meta.url), rowKeys: ["flows"] },
  { domain: "onboarding-receipts", file: new URL("../.state/onboarding-receipts.json", import.meta.url), rowKeys: ["receipts"] },
  { domain: "payees", file: new URL("../.state/payees.json", import.meta.url), rowKeys: ["payees", "links"] },
  { domain: "payroll-runs", file: new URL("../.state/payroll-runs.json", import.meta.url), rowKeys: ["runs"] },
  { domain: "payroll-schedules", file: new URL("../.state/payroll-schedules.json", import.meta.url), rowKeys: ["schedules"] },
  { domain: "invoices", file: new URL("../.state/invoices.json", import.meta.url), rowKeys: ["invoices"], sharedKeys: ["secret"] },
  { domain: "compliance-audits", file: new URL("../.state/compliance-audits.json", import.meta.url), rowKeys: ["audits", "events"] },
  { domain: "agent-sessions", file: new URL("../.state/agent-sessions.json", import.meta.url), rowKeys: ["sessions"] },
  { domain: "x402-purchases", file: new URL("../.state/x402-purchases.json", import.meta.url), rowKeys: ["purchases"] },
];

function readSnapshot(source: Snapshot): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(source.file, "utf8")) as Record<string, unknown>;
    if (value.version !== 1) throw new Error("unsupported journal version");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw new Error(`Cannot read ${source.domain} journal: ${(error as Error).message}`);
  }
}

const company = process.env.MERCURY_COMPANY_ADDRESS;
const founder = process.env.MERCURY_FOUNDER_ADDRESS;
const mint = process.env.MERCURY_COMPANY_MINT;
if (!company || !founder || !mint) throw new Error("Set MERCURY_COMPANY_ADDRESS, MERCURY_FOUNDER_ADDRESS, and MERCURY_COMPANY_MINT");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set MERCURY_SUPABASE_URL and MERCURY_SUPABASE_SECRET_KEY in backend/.env.local");

await store.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company, mintAddress: mint,
  perValidator: TEE_VALIDATOR.toBase58() });
const counts: Record<string, number> = {};
for (const source of snapshots) {
  const journal = readSnapshot(source);
  const payload: Record<string, unknown> = { version: 1 };
  for (const key of source.sharedKeys ?? []) payload[key] = journal[key];
  let count = 0;
  for (const key of source.rowKeys) {
    const rows = journal[key] === undefined ? [] : journal[key];
    if (!Array.isArray(rows)) throw new Error(`${source.domain} has invalid ${key}`);
    const scoped = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row) &&
      (row as { company?: unknown }).company === company);
    payload[key] = scoped;
    count += scoped.length;
  }
  await store.put({ companyId: company, domain: `journal.${source.domain}`, recordId: "latest", payload,
    metadata: { kind: "checkpoint", source: "local-json", schema: 1 } });
  counts[source.domain] = count;
}
console.log(JSON.stringify({ result: "PASS", company, encryptedJournalSnapshots: counts }));
