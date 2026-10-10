import { asAddress } from "./magicblock.ts";
import type { PayrollRun } from "./payroll-run.ts";
import { paymentId } from "./payment-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";
const DOMAIN = "operation.payroll-run";
function valid(run: PayrollRun, company: string): PayrollRun { if (!run || run.company !== company || paymentId(run.runId) !== run.runId || !Array.isArray(run.items)) throw new Error("Invalid stored payroll run"); return run; }
export class DatabasePayrollRunStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }
  static fromEnvironment(): DatabasePayrollRunStore | null { if (process.env.MERCURY_PAYROLL_RUN_STORE !== "supabase") return null; const store = SupabasePrivateStore.fromEnvironment(); if (!store) throw new Error("Supabase payroll storage is enabled but not configured"); return new DatabasePayrollRunStore(store); }
  async adopt(run: PayrollRun): Promise<PayrollRun> { const item = valid(run, run.company); const inserted = await this.#store.insertIfAbsent({ companyId: item.company, domain: DOMAIN, recordId: item.runId, payload: item, metadata: { kind: "payroll-run" } }); const stored = inserted ? item : await this.get(item.runId, item.company); if (stored.termsHash !== item.termsHash) throw new Error("Payroll run ID is already bound to different roster terms"); return stored; }
  async get(id: unknown, companyInput: unknown): Promise<PayrollRun> { const company = asAddress(companyInput, "company"); const run = await this.#store.get<PayrollRun>(company, DOMAIN, paymentId(id)); if (!run) throw new Error("Unknown payroll run"); return valid(run, company); }
  async list(companyInput: unknown) { const company = asAddress(companyInput, "company"); return (await this.#store.list<PayrollRun>(company, DOMAIN, 500)).map((run) => valid(run, company)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((run) => ({ runId: run.runId, createdAt: run.createdAt, itemCount: run.items.length })); }
}
