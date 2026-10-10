import type { Receipt } from "./onboarding-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

const DOMAIN = "operation.onboarding-receipt";
const MAX_RETRIES = 3;

function assertReceipt(value: Receipt, company: string): Receipt {
  if (!value || value.company !== company || !/^[a-f0-9]{64}$/.test(value.id) ||
      !["base", "ephemeral"].includes(value.chain) ||
      !["built", "pending", "confirmed", "failed", "expired"].includes(value.status)) {
    throw new Error("Invalid stored onboarding receipt");
  }
  return value;
}

/**
 * Durable state machine for signed Mercury operation receipts. Transaction
 * parsing and signature verification remain in onboarding-journal until its
 * callers have been moved to the asynchronous repository interface.
 */
export class DatabaseOnboardingReceiptStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }

  static fromEnvironment(): DatabaseOnboardingReceiptStore | null {
    if (process.env.MERCURY_ONBOARDING_RECEIPT_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase onboarding receipt storage is enabled but not configured");
    return new DatabaseOnboardingReceiptStore(store);
  }

  async record(receipt: Receipt): Promise<Receipt> {
    const inserted = await this.#store.insertIfAbsent({ companyId: receipt.company, domain: DOMAIN, recordId: receipt.id,
      payload: receipt, metadata: { kind: "onboarding-receipt", operation: receipt.operation, status: receipt.status } });
    const stored = inserted ? receipt : await this.get(receipt.company, receipt.id);
    if (stored.target !== receipt.target || stored.operation !== receipt.operation || stored.chain !== receipt.chain) {
      throw new Error("Onboarding transaction is already bound to another step");
    }
    return stored;
  }

  async get(company: string, id: string): Promise<Receipt> {
    const stored = await this.#store.get<Receipt>(company, DOMAIN, id);
    if (!stored) throw new Error("Unknown onboarding receipt");
    return assertReceipt(stored, company);
  }

  async list(company: string): Promise<Receipt[]> {
    const rows = await this.#store.list<Receipt>(company, DOMAIN, 500);
    return rows.map((row) => assertReceipt(row, company));
  }

  async latest(company: string, target: string, operation: string): Promise<Receipt | null> {
    const receipts = await this.list(company);
    return receipts.filter((receipt) => receipt.target === target && receipt.operation === operation)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1) ?? null;
  }

  async update(company: string, id: string, mutate: (receipt: Receipt) => Receipt): Promise<Receipt> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await this.#store.get<Receipt>(company, DOMAIN, id);
      if (!current) throw new Error("Unknown onboarding receipt");
      const receipt = assertReceipt(current, company);
      const next = mutate({ ...receipt });
      const version = await this.#store.compareAndSwap({ companyId: company, domain: DOMAIN, recordId: id,
        expectedVersion: current.recordVersion, payload: next,
        metadata: { kind: "onboarding-receipt", operation: next.operation, status: next.status } });
      if (version !== null) return next;
    }
    throw new Error("Onboarding receipt changed concurrently; reload and retry");
  }
}
