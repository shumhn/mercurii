import { createHash } from "node:crypto";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { asAddress } from "./magicblock.ts";
import { paymentId, type PaymentRecord } from "./payment-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

const DOMAIN = "operation.payment";
const MAX_RETRIES = 3;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function assertRecord(value: PaymentRecord, company: string): PaymentRecord {
  if (!value || value.company !== company || typeof value.paymentId !== "string" ||
      !["registered", "prepared", "submitted", "failed", "settled", "cancelled"].includes(value.state)) {
    throw new Error("Invalid stored payment record");
  }
  return value;
}

/**
 * Database-primary payment journal for deployed Mercury. It persists each state
 * transition before an HTTP success response and uses encrypted optimistic CAS.
 */
export class DatabasePaymentStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }

  static fromEnvironment(): DatabasePaymentStore | null {
    // This is intentionally per-domain during the database cutover. A global
    // storage flag would let a half-migrated deployment mix durable payment
    // state with local payment-flow/payroll state.
    if (process.env.MERCURY_PAYMENT_STATE_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase primary storage is enabled but not configured");
    return new DatabasePaymentStore(store);
  }

  async get(idInput: unknown, companyInput: unknown): Promise<PaymentRecord> {
    const payment = paymentId(idInput);
    const company = asAddress(companyInput, "company");
    const stored = await this.#store.get<PaymentRecord>(company, DOMAIN, payment);
    if (!stored) throw new Error("Unknown payment ID");
    return assertRecord(stored, company);
  }

  async list(companyInput: unknown, limit = 50): Promise<PaymentRecord[]> {
    const company = asAddress(companyInput, "company");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Payment history limit must be 1 to 100");
    const rows = await this.#store.list<PaymentRecord>(company, DOMAIN, limit);
    return rows.map((row) => assertRecord(row, company));
  }

  async reconciliationPage(companyInput: unknown, offset: number, limit = 50): Promise<{
    payments: PaymentRecord[]; nextOffset: number | null; total: number;
  }> {
    const company = asAddress(companyInput, "company");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Invalid reconciliation page");
    }
    const all = await this.#store.list<PaymentRecord>(company, DOMAIN, 500);
    const payments = all.slice(offset, offset + limit).map((row) => assertRecord(row, company));
    return { payments, nextOffset: offset + payments.length < all.length ? offset + payments.length : null, total: all.length };
  }

  async register(args: { paymentId: unknown; company: string; request: string; requester: string; requestId: string }): Promise<PaymentRecord> {
    const id = paymentId(args.paymentId);
    const company = asAddress(args.company, "company");
    const request = asAddress(args.request, "request");
    const requester = asAddress(args.requester, "requester");
    if (!/^\d+$/.test(args.requestId)) throw new Error("Invalid onchain request ID");
    const now = new Date().toISOString();
    const candidate: PaymentRecord = { paymentId: id, company, request, requester, requestId: args.requestId,
      actor: null, preparedMessageHash: null, preparedBlockhash: null, signature: null,
      state: "registered", createdAt: now, updatedAt: now };
    const inserted = await this.#store.insertIfAbsent({ companyId: company, domain: DOMAIN, recordId: id, payload: candidate,
      metadata: { kind: "payment", state: "registered" } });
    const record = inserted ? candidate : await this.get(id, company);
    if (record.company !== company || record.request !== request || record.requester !== requester || record.requestId !== args.requestId) {
      throw new Error("Payment ID is already bound to another request");
    }
    return record;
  }

  async prepare(idInput: unknown, companyInput: string, actorInput: string, transactionBase64: string): Promise<PaymentRecord> {
    const actor = asAddress(actorInput, "actor");
    const messageHash = preparedMessageHash(transactionBase64);
    const blockhash = Transaction.from(Buffer.from(transactionBase64, "base64")).recentBlockhash ?? null;
    return this.#mutate(idInput, companyInput, (record) => {
      if (record.state !== "registered" && record.state !== "failed") throw new Error("Payment already has a prepared or submitted execution");
      if (record.state === "failed" && record.signature) {
        record.failedSignatures ??= [];
        if (!record.failedSignatures.includes(record.signature)) record.failedSignatures.push(record.signature);
      }
      record.actor = actor; record.preparedMessageHash = messageHash; record.preparedBlockhash = blockhash;
      record.signature = null; record.state = "prepared"; record.updatedAt = new Date().toISOString();
      return record;
    });
  }

  async abandonPrepared(idInput: unknown, companyInput: string, blockhashExpired: boolean, now = Date.now()): Promise<PaymentRecord> {
    return this.#mutate(idInput, companyInput, (record) => {
      if (record.state !== "prepared" || record.signature !== null) throw new Error("Only an unsigned prepared payment can be rebuilt");
      const updatedAt = Date.parse(record.updatedAt);
      if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) throw new Error("Invalid payment preparation time");
      if (now - updatedAt < 60_000) throw new Error("Wait one minute before rebuilding an unsigned payment");
      if (!record.preparedBlockhash || blockhashExpired !== true) throw new Error("Prepared transaction blockhash must be proven expired before rebuilding");
      record.actor = null; record.preparedMessageHash = null; record.preparedBlockhash = null;
      record.state = "registered"; record.updatedAt = new Date(now).toISOString();
      return record;
    });
  }

  async bindSigned(idInput: unknown, companyInput: string, signedTransactionBase64: string): Promise<PaymentRecord> {
    const transaction = Transaction.from(Buffer.from(signedTransactionBase64, "base64"));
    if (!transaction.verifySignatures()) throw new Error("Signed payment has invalid signatures");
    const signature = transaction.signatures[0]?.signature;
    if (!signature) throw new Error("Signed payment has no signature");
    const encoded = bs58.encode(signature);
    const hash = preparedMessageHash(signedTransactionBase64);
    return this.#mutate(idInput, companyInput, (record) => {
      if (transaction.feePayer?.toBase58() !== record.actor || hash !== record.preparedMessageHash) {
        throw new Error("Signed payment does not match the prepared execution");
      }
      if ((record.state === "submitted" || record.state === "settled") && record.signature === encoded) return record;
      if (record.state !== "prepared") throw new Error("Payment is not awaiting this signature");
      record.signature = encoded; record.state = "submitted"; record.updatedAt = new Date().toISOString();
      return record;
    });
  }

  async reconcile(idInput: unknown, companyInput: string, requestStatus: string,
    chainStatus: "not_found" | "processed" | "confirmed" | "failed" | null): Promise<PaymentRecord> {
    return this.#mutate(idInput, companyInput, (record) => {
      let next = record.state;
      if (requestStatus === "executed") next = "settled";
      else if (requestStatus === "rejected") next = "cancelled";
      else if (chainStatus === "failed" && record.state === "submitted") next = "failed";
      if (next !== record.state) { record.state = next; record.updatedAt = new Date().toISOString(); }
      return record;
    }, true);
  }

  async #mutate(idInput: unknown, companyInput: string, update: (record: PaymentRecord) => PaymentRecord,
    allowUnchanged = false): Promise<PaymentRecord> {
    const id = paymentId(idInput);
    const company = asAddress(companyInput, "company");
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await this.#store.get<PaymentRecord>(company, DOMAIN, id);
      if (!current) throw new Error("Unknown payment ID");
      const before = clone(assertRecord(current, company));
      const next = update(clone(before));
      if (allowUnchanged && JSON.stringify(before) === JSON.stringify(next)) return before;
      const version = await this.#store.compareAndSwap({ companyId: company, domain: DOMAIN, recordId: id,
        expectedVersion: current.recordVersion, payload: next, metadata: { kind: "payment", state: next.state } });
      if (version !== null) return next;
    }
    throw new Error("Payment state changed concurrently; reload and retry");
  }
}

export function preparedMessageHash(transactionBase64: string): string {
  const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
  return createHash("sha256").update(transaction.serializeMessage()).digest("hex");
}
