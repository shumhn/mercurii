import { asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";
import type { PayrollSchedule } from "./payroll-schedule.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

const DOMAIN = "operation.payroll-schedule";

function valid(schedule: PayrollSchedule, company: string): PayrollSchedule {
  if (!schedule || schedule.company !== company || paymentId(schedule.scheduleId) !== schedule.scheduleId ||
      !["weekly", "biweekly", "monthly", "per_employee"].includes(schedule.cadence) ||
      typeof schedule.encryptedRoster !== "object" || schedule.encryptedRoster === null ||
      !Number.isInteger(schedule.revision) || schedule.revision < 0) {
    throw new Error("Invalid stored payroll schedule");
  }
  return schedule;
}

/** Encrypted, company-scoped payroll schedule repository. */
export class DatabasePayrollScheduleStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }

  static fromEnvironment(): DatabasePayrollScheduleStore | null {
    if (process.env.MERCURY_PAYROLL_SCHEDULE_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase payroll schedule storage is enabled but not configured");
    return new DatabasePayrollScheduleStore(store);
  }

  async list(companyInput: unknown): Promise<PayrollSchedule[]> {
    const company = asAddress(companyInput, "company");
    return (await this.#store.list<PayrollSchedule>(company, DOMAIN, 500))
      .map((schedule) => valid(schedule, company));
  }

  async persist(schedule: PayrollSchedule): Promise<PayrollSchedule> {
    const item = valid(schedule, schedule.company);
    const inserted = await this.#store.insertIfAbsent({ companyId: item.company, domain: DOMAIN,
      recordId: item.scheduleId, payload: item, metadata: { kind: "payroll-schedule", revision: item.revision } });
    if (inserted) return item;
    const current = await this.#store.get<PayrollSchedule>(item.company, DOMAIN, item.scheduleId);
    if (!current) throw new Error("Payroll schedule disappeared during persistence");
    const stored = valid(current, item.company);
    if (stored.revision > item.revision) throw new Error("Payroll schedule changed; reload before changing it");
    if (stored.revision === item.revision) {
      if (JSON.stringify(stored) !== JSON.stringify(item)) throw new Error("Payroll schedule revision is bound to different terms");
      return stored;
    }
    const version = await this.#store.compareAndSwap({ companyId: item.company, domain: DOMAIN,
      recordId: item.scheduleId, expectedVersion: current.recordVersion, payload: item,
      metadata: { kind: "payroll-schedule", revision: item.revision } });
    if (version === null) throw new Error("Payroll schedule changed concurrently; reload before changing it");
    return item;
  }
}
