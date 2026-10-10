import { createHash } from "node:crypto";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { asAddress, asMicroAmount } from "./magicblock.ts";
import { paymentRequestAddress } from "./operations.ts";
import { paymentId } from "./payment-journal.ts";
import type { PaymentFlow, PaymentFlowTerms } from "./payment-flow.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

const DOMAIN = "operation.payment-flow";
const MAX_RETRIES = 3;

function requestIdFor(id: string, branchId: number | null): string {
  const random = createHash("sha256").update(`mercury-payment-request:${id}`).digest().readBigUInt64LE(0);
  return ((BigInt(branchId ?? 0) << 40n) | (random & ((1n << 40n) - 1n))).toString();
}

function normalizeTerms(input: Record<string, unknown>, legacy = false): PaymentFlowTerms {
  const requester = asAddress(input.requester, "requester");
  const recipient = asAddress(input.recipient, "recipient");
  const amountMicro = asMicroAmount(input.amountMicro);
  if (requester === recipient) throw new Error("Requester cannot be the payment recipient");
  if (input.includeFinance !== undefined && typeof input.includeFinance !== "boolean") throw new Error("includeFinance must be boolean");
  const manager = input.manager === undefined || input.manager === null ? null : asAddress(input.manager, "manager");
  if (manager === requester || manager === recipient) throw new Error("Manager conflicts with the payment request");
  const branchId = input.branchId === undefined || input.branchId === null ? null : input.branchId;
  if (branchId !== null && (typeof branchId !== "number" || !Number.isInteger(branchId) || branchId < 1 || branchId > 0xff_ffff)) {
    throw new Error("branchId must be an integer from 1 to 16777215");
  }
  if (manager && branchId === null && !legacy) throw new Error("Manager payments require branchId");
  return { requester, recipient, amountMicro, includeFinance: input.includeFinance !== false, manager, branchId };
}

function hashTerms(terms: PaymentFlowTerms): string {
  const { branchId, ...legacyTerms } = terms;
  return createHash("sha256").update(JSON.stringify(branchId === null ? legacyTerms : terms)).digest("hex");
}

function assertFlow(value: PaymentFlow, company: string): PaymentFlow {
  if (!value || value.company !== company || typeof value.paymentId !== "string" ||
      typeof value.request !== "string" || typeof value.requester !== "string" || !/^\d+$/.test(value.requestId)) {
    throw new Error("Invalid stored payment flow");
  }
  return value;
}

/** Database-primary guided-payment identity and reader configuration. */
export class DatabasePaymentFlowStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }

  static fromEnvironment(): DatabasePaymentFlowStore | null {
    if (process.env.MERCURY_PAYMENT_FLOW_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase payment-flow storage is enabled but not configured");
    return new DatabasePaymentFlowStore(store);
  }

  async getOrCreate(paymentInput: unknown, companyInput: unknown, input: Record<string, unknown>): Promise<{
    flow: PaymentFlow; terms: PaymentFlowTerms;
  }> {
    const payment = paymentId(paymentInput);
    const company = asAddress(companyInput, "company");
    const current = await this.#store.get<PaymentFlow>(company, DOMAIN, payment);
    const existing = current ? assertFlow(current, company) : undefined;
    const terms = normalizeTerms(input, existing !== undefined && existing.branchId === undefined);
    const requestId = existing?.requestId ?? requestIdFor(payment, terms.branchId);
    const request = paymentRequestAddress(new PublicKey(company), new PublicKey(terms.requester), new BN(requestId)).toBase58();
    if (existing) {
      if (existing.requester !== terms.requester || existing.request !== request || existing.requestId !== requestId ||
          existing.termsHash !== hashTerms(terms)) throw new Error("Payment ID is already bound to different private request terms");
      if (existing.includeFinance !== undefined && existing.manager !== undefined) return { flow: existing, terms };
      const upgraded = { ...existing, includeFinance: terms.includeFinance, manager: terms.manager };
      const version = await this.#store.compareAndSwap({ companyId: company, domain: DOMAIN, recordId: payment,
        expectedVersion: current!.recordVersion, payload: upgraded, metadata: { kind: "payment-flow" } });
      if (version !== null) return { flow: upgraded, terms };
      return this.getOrCreate(payment, company, input);
    }
    const collision = (await this.#store.list<PaymentFlow>(company, DOMAIN, 500)).some((row) => row.request === request);
    if (collision) throw new Error("Derived payment request is already bound to another payment ID");
    const flow: PaymentFlow = { paymentId: payment, company, requester: terms.requester, request, requestId,
      termsHash: hashTerms(terms), createdAt: new Date().toISOString(), includeFinance: terms.includeFinance,
      manager: terms.manager, branchId: terms.branchId };
    const inserted = await this.#store.insertIfAbsent({ companyId: company, domain: DOMAIN, recordId: payment,
      payload: flow, metadata: { kind: "payment-flow" } });
    if (inserted) return { flow, terms };
    return this.getOrCreate(payment, company, input);
  }

  async get(paymentInput: unknown, companyInput: unknown): Promise<PaymentFlow> {
    const payment = paymentId(paymentInput);
    const company = asAddress(companyInput, "company");
    const stored = await this.#store.get<PaymentFlow>(company, DOMAIN, payment);
    if (!stored) throw new Error("Unknown payment flow ID");
    return assertFlow(stored, company);
  }

  /**
   * Imports a flow created by a legacy caller during the staged cutover. The
   * payload has already passed payment-flow validation; this method only
   * preserves its exact identity and never overwrites a different flow.
   */
  async adopt(flowInput: PaymentFlow): Promise<PaymentFlow> {
    const flow = assertFlow(flowInput, flowInput.company);
    const inserted = await this.#store.insertIfAbsent({ companyId: flow.company, domain: DOMAIN,
      recordId: flow.paymentId, payload: flow, metadata: { kind: "payment-flow" } });
    const stored = inserted ? flow : await this.get(flow.company, flow.paymentId);
    if (stored.request !== flow.request || stored.requester !== flow.requester ||
        stored.requestId !== flow.requestId || stored.termsHash !== flow.termsHash) {
      throw new Error("Payment flow ID is already bound to different private request terms");
    }
    return stored;
  }

  async recordedRequestReaders(companyInput: unknown): Promise<Map<string, { requester: string; includeFinance: boolean; manager: string | null }>> {
    const company = asAddress(companyInput, "company");
    const rows = await this.#store.list<PaymentFlow>(company, DOMAIN, 500);
    return new Map(rows.filter((flow) => typeof flow.includeFinance === "boolean" && flow.manager !== undefined)
      .map((flow) => [flow.request, { requester: flow.requester, includeFinance: flow.includeFinance!, manager: flow.manager! }]));
  }

  async applyConfirmedReaderCleanup(companyInput: unknown, requestInput: unknown, kind: "finance" | "manager" | "all"): Promise<void> {
    const company = asAddress(companyInput, "company");
    const request = asAddress(requestInput, "request");
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const rows = await this.#store.list<PaymentFlow>(company, DOMAIN, 500);
      const current = rows.find((row) => row.request === request);
      if (!current) return;
      const next: PaymentFlow = { ...current };
      if (kind === "finance") next.includeFinance = false;
      else if (kind === "manager") next.manager = null;
      else { next.includeFinance = false; next.manager = null; next.includeRequester = false; }
      const stored = await this.#store.get<PaymentFlow>(company, DOMAIN, next.paymentId);
      if (!stored) return;
      const version = await this.#store.compareAndSwap({ companyId: company, domain: DOMAIN, recordId: next.paymentId,
        expectedVersion: stored.recordVersion, payload: next, metadata: { kind: "payment-flow" } });
      if (version !== null) return;
    }
    throw new Error("Payment-flow reader state changed concurrently; reload and retry");
  }
}
