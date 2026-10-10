import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

type Source = { domain: string; file: URL; rowKeys: string[]; sharedKeys?: string[] };
const sources: Source[] = [
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
function journal(source: Source): Record<string, unknown> {
  try { return JSON.parse(readFileSync(source.file, "utf8")) as Record<string, unknown>; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw error;
  }
}
const company = process.env.MERCURY_COMPANY_ADDRESS;
if (!company) throw new Error("Set MERCURY_COMPANY_ADDRESS");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set Supabase server configuration");
const checkpointId = `recovery-${randomUUID()}`;
const journals: Record<string, Record<string, unknown>> = {};
const counts: Record<string, number> = {};
for (const source of sources) {
  const raw = journal(source);
  const snapshot: Record<string, unknown> = { version: 1 };
  for (const key of source.sharedKeys ?? []) snapshot[key] = raw[key];
  let count = 0;
  for (const key of source.rowKeys) {
    const rows = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(rows)) throw new Error(`${source.domain} has invalid ${key}`);
    const scoped = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row) &&
      (row as { company?: unknown }).company === company);
    snapshot[key] = scoped; count += scoped.length;
  }
  journals[source.domain] = snapshot; counts[source.domain] = count;
}
const payload = { version: 1, company, createdAt: new Date().toISOString(), journals,
  recoverySequence: ["freeze_company_operations", "validate_checkpoint", "migrate_treasury", "sanitize_private_state", "commit_and_undelegate_legacy_state", "verify_and_retire"] };
await store.createRecoveryCheckpoint({ companyId: company, checkpointId, payload });
const restored = await store.getRecoveryCheckpoint<typeof payload>(company, checkpointId);
if (!restored || restored.company !== company || restored.journals.payments === undefined) throw new Error("Recovery checkpoint read-back failed");
console.log(JSON.stringify({ result: "PASS", company, checkpointId, encryptedRecoveryCheckpoint: counts }));
