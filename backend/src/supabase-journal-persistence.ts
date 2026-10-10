import { asAddress } from "./magicblock.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

type Journal = Record<string, unknown>;
type StoreLike = Pick<SupabasePrivateStore, "put" | "appendAuditEvent">;
type OperationalRow = { domain: string; idField: string };

// Every row that represents application state gets an encrypted operational
// record as well as its encrypted journal snapshot. This keeps the database
// current while repositories are being migrated from local devnet journals to
// DB-primary reads.
const operationalRows: Record<string, Record<string, OperationalRow>> = {
  payments: { payments: { domain: "operation.payment", idField: "paymentId" } },
  "payment-flows": { flows: { domain: "operation.payment-flow", idField: "paymentId" } },
  payees: {
    payees: { domain: "operation.payee", idField: "payeeId" },
    links: { domain: "operation.payee-link", idField: "paymentId" },
  },
  "payroll-runs": { runs: { domain: "operation.payroll-run", idField: "runId" } },
  "payroll-schedules": { schedules: { domain: "operation.payroll-schedule", idField: "scheduleId" } },
  invoices: { invoices: { domain: "operation.invoice", idField: "paymentId" } },
  "onboarding-receipts": { receipts: { domain: "operation.onboarding-receipt", idField: "id" } },
  "agent-sessions": { sessions: { domain: "operation.agent-session", idField: "id" } },
  "compliance-audits": { audits: { domain: "operation.compliance-audit-share", idField: "auditId" } },
  "x402-purchases": { purchases: { domain: "operation.x402-purchase", idField: "taskId" } },
};

type PersistenceStatus = {
  enabled: boolean;
  pending: number;
  writes: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: string | null;
};

let testStore: StoreLike | null | undefined;
const queues = new Map<string, Promise<void>>();
const pending = new Set<Promise<void>>();
let writes = 0;
let lastSuccessAt: string | null = null;
let lastFailureAt: string | null = null;
let lastFailure: string | null = null;

function enabled(): boolean {
  return process.env.MERCURY_SUPABASE_PERSISTENCE === "1";
}

function store(): StoreLike | null {
  if (!enabled()) return null;
  return testStore === undefined ? SupabasePrivateStore.fromEnvironment() : testStore;
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown persistence failure";
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

function enqueue(key: string, work: () => Promise<void>): void {
  const prior = queues.get(key) ?? Promise.resolve();
  const task = prior.then(work);
  const tracked = task.then(
    () => { writes += 1; lastSuccessAt = new Date().toISOString(); },
    (error) => { lastFailureAt = new Date().toISOString(); lastFailure = safeFailure(error); },
  );
  queues.set(key, tracked);
  pending.add(tracked);
  void tracked.finally(() => pending.delete(tracked));
}

export function schedulePrivateRecord(input: {
  company: string; domain: string; recordId: string; payload: unknown;
  metadata?: Record<string, string | number | boolean | null>;
}): void {
  const database = store();
  if (!database) return;
  let company: string;
  try { company = asAddress(input.company, "company"); }
  catch (error) { lastFailureAt = new Date().toISOString(); lastFailure = safeFailure(error); return; }
  const key = `${company}:${input.domain}:${input.recordId}`;
  enqueue(key, () => database.put({ companyId: company, domain: input.domain,
    recordId: input.recordId, payload: input.payload, metadata: input.metadata }));
}

/**
 * Mirrors a journal as one encrypted, company-scoped snapshot. The public
 * database never receives rows belonging to another company or plaintext.
 */
export function mirrorCompanyJournal(input: {
  domain: string; journal: Journal; rowKeys: string[]; sharedKeys?: string[];
}): void {
  if (!enabled()) return;
  const byCompany = new Map<string, Record<string, unknown[]>>();
  const rowMap = operationalRows[input.domain] ?? {};
  for (const rowKey of input.rowKeys) {
    const rows = input.journal[rowKey];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const company = (row as { company?: unknown }).company;
      if (typeof company !== "string") continue;
      let companyId: string;
      try { companyId = asAddress(company, "company"); }
      catch { continue; }
      const snapshot = byCompany.get(companyId) ?? {};
      const companyRows = snapshot[rowKey] ?? [];
      companyRows.push(row);
      snapshot[rowKey] = companyRows;
      byCompany.set(companyId, snapshot);
      const mapping = rowMap[rowKey];
      const recordId = mapping && (row as Record<string, unknown>)[mapping.idField];
      if (mapping && typeof recordId === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(recordId)) {
        schedulePrivateRecord({ company: companyId, domain: mapping.domain, recordId, payload: row,
          metadata: { kind: "operational_state", source: input.domain } });
      }
    }
  }
  for (const [company, rows] of byCompany) {
    const payload: Journal = { version: input.journal.version ?? 1 };
    for (const sharedKey of input.sharedKeys ?? []) payload[sharedKey] = input.journal[sharedKey];
    Object.assign(payload, rows);
    schedulePrivateRecord({ company, domain: `journal.${input.domain}`, recordId: "latest", payload,
      metadata: { kind: "journal_snapshot", schema: 1 } });
  }
}

export function schedulePrivateAuditEvent(input: {
  company: string; eventId: string; eventType: string; payload: unknown;
}): void {
  const database = store();
  if (!database) return;
  let company: string;
  try { company = asAddress(input.company, "company"); }
  catch (error) { lastFailureAt = new Date().toISOString(); lastFailure = safeFailure(error); return; }
  enqueue(`${company}:audit:${input.eventId}`, () => database.appendAuditEvent({
    companyId: company, eventId: input.eventId, eventType: input.eventType, payload: input.payload,
  }));
}

export async function flushSupabasePersistence(): Promise<PersistenceStatus> {
  await Promise.all([...pending]);
  return supabasePersistenceStatus();
}

export function supabasePersistenceStatus(): PersistenceStatus {
  return { enabled: enabled(), pending: pending.size, writes, lastSuccessAt, lastFailureAt, lastFailure };
}

/** Test-only injection; application code always uses environment configuration. */
export function configureSupabasePersistenceForTest(value: StoreLike | null | undefined): void {
  testStore = value;
  queues.clear(); pending.clear(); writes = 0; lastSuccessAt = null; lastFailureAt = null; lastFailure = null;
}
