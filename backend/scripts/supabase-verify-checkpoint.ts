import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

const company = process.env.MERCURY_COMPANY_ADDRESS;
if (!company) throw new Error("Set MERCURY_COMPANY_ADDRESS");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set Supabase server configuration");
const domains = ["payments", "payment-flows", "onboarding-receipts", "payees", "payroll-runs", "payroll-schedules", "invoices", "compliance-audits", "agent-sessions", "x402-purchases"];
const rows: Record<string, number> = {};
for (const name of domains) {
  const snapshot = await store.get<Record<string, unknown>>(company, `journal.${name}`, "latest");
  if (!snapshot) throw new Error(`Missing encrypted ${name} checkpoint`);
  rows[name] = Object.values(snapshot).filter(Array.isArray).reduce((count, value) => count + value.length, 0);
}
console.log(JSON.stringify({ result: "PASS", company, encryptedSnapshotsReadable: rows }));
