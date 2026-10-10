import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

type RecoveryPayload = { version: 1; company: string; createdAt: string; journals: Record<string, Record<string, unknown>>;
  recoverySequence: string[] };
const files: Record<string, string> = {
  payments: "payments.json", "payment-flows": "payment-flows.json", "onboarding-receipts": "onboarding-receipts.json",
  payees: "payees.json", "payroll-runs": "payroll-runs.json", "payroll-schedules": "payroll-schedules.json",
  invoices: "invoices.json", "compliance-audits": "compliance-audits.json", "agent-sessions": "agent-sessions.json",
  "x402-purchases": "x402-purchases.json",
};
const company = process.env.MERCURY_COMPANY_ADDRESS;
const checkpointId = process.env.MERCURY_RECOVERY_CHECKPOINT_ID;
if (!company || !checkpointId) throw new Error("Set MERCURY_COMPANY_ADDRESS and MERCURY_RECOVERY_CHECKPOINT_ID");
if (!/^recovery-[0-9a-f-]{36}$/.test(checkpointId)) throw new Error("Invalid recovery checkpoint ID");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set Supabase server configuration");
const checkpoint = await store.getRecoveryCheckpoint<RecoveryPayload>(company, checkpointId);
if (!checkpoint || checkpoint.version !== 1 || checkpoint.company !== company || !checkpoint.journals) {
  throw new Error("Recovery checkpoint is missing or invalid");
}
const stateRoot = resolve(new URL("../.state", import.meta.url).pathname);
const output = resolve(process.env.MERCURY_RECOVERY_RESTORE_DIR ?? join(stateRoot, "recovery-restores", checkpointId));
if (!output.startsWith(`${stateRoot}/`)) throw new Error("Recovery restore directory must stay inside backend/.state");
mkdirSync(output, { recursive: true, mode: 0o700 });
const counts: Record<string, number> = {};
for (const [domain, filename] of Object.entries(files)) {
  const journal = checkpoint.journals[domain];
  if (!journal || journal.version !== 1) throw new Error(`Checkpoint is missing ${domain}`);
  const target = join(output, filename);
  writeFileSync(target, JSON.stringify(journal, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  counts[domain] = Object.values(journal).filter(Array.isArray).reduce((total, rows) => total + rows.length, 0);
}
writeFileSync(join(output, "RECOVERY_README.json"), JSON.stringify({ version: 1, company, checkpointId,
  restoredAt: new Date().toISOString(), sourceCreatedAt: checkpoint.createdAt,
  next: "Validate these files against onchain state before replacing any active journal or migrating treasury funds." }, null, 2),
  { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ result: "PASS", company, checkpointId, restoredTo: output, journalRows: counts }));
