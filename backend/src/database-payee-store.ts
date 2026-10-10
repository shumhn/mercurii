import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";
import type { Payee } from "./payee-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

const PAYEE_DOMAIN = "operation.payee";
const LINK_DOMAIN = "operation.payee-link";
const MAX_RETRIES = 3;
type Kind = "employee" | "contractor" | "vendor";
type Link = { paymentId: string; payeeId: string; company: string };

function recipientHash(company: string, recipient: string): string {
  return createHash("sha256").update(`mercury-payee:${company}:${recipient}`).digest("hex");
}

function validatePayee(companyInput: unknown, input: Record<string, unknown>): {
  company: string; payeeId: string; kind: Kind; teamId: string | null; recipientHash: string;
} {
  const company = asAddress(companyInput, "company");
  const payeeId = paymentId(input.payeeId);
  const kind = input.kind;
  if (kind !== "employee" && kind !== "contractor" && kind !== "vendor") {
    throw new Error("Payee kind must be employee, contractor, or vendor");
  }
  const recipient = asAddress(input.recipient, "recipient");
  if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) throw new Error("Payee must be a wallet owner");
  const teamId = input.teamId === undefined || input.teamId === null ? null : input.teamId;
  if (teamId !== null && (typeof teamId !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(teamId))) {
    throw new Error("teamId must be a short team code");
  }
  return { company, payeeId, kind, teamId, recipientHash: recipientHash(company, recipient) };
}

function assertPayee(value: Payee, company: string): Payee {
  if (!value || value.company !== company || typeof value.payeeId !== "string" ||
      !["employee", "contractor", "vendor"].includes(value.kind) ||
      typeof value.recipientHash !== "string" || typeof value.active !== "boolean") {
    throw new Error("Invalid stored payee record");
  }
  return value;
}

/** Encrypted, company-scoped employee/contractor/vendor registry. */
export class DatabasePayeeStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }

  static fromEnvironment(): DatabasePayeeStore | null {
    if (process.env.MERCURY_PAYEE_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase payee storage is enabled but not configured");
    return new DatabasePayeeStore(store);
  }

  async register(companyInput: unknown, input: Record<string, unknown>): Promise<Payee> {
    const candidate = validatePayee(companyInput, input);
    const now = new Date().toISOString();
    const payee: Payee = { ...candidate, active: true, createdAt: now, updatedAt: now };
    const inserted = await this.#store.insertIfAbsent({ companyId: candidate.company, domain: PAYEE_DOMAIN,
      recordId: candidate.payeeId, payload: payee, metadata: { kind: "payee", payeeKind: candidate.kind, active: true } });
    const stored = inserted ? payee : await this.get(candidate.company, candidate.payeeId);
    if (stored.kind !== candidate.kind || stored.teamId !== candidate.teamId || stored.recipientHash !== candidate.recipientHash) {
      throw new Error("Payee ID is already bound to different details");
    }
    return stored;
  }

  async get(companyInput: unknown, idInput: unknown): Promise<Payee> {
    const company = asAddress(companyInput, "company");
    const payeeId = paymentId(idInput);
    const stored = await this.#store.get<Payee>(company, PAYEE_DOMAIN, payeeId);
    if (!stored) throw new Error("Unknown payee ID");
    return assertPayee(stored, company);
  }

  async list(companyInput: unknown): Promise<Payee[]> {
    const company = asAddress(companyInput, "company");
    const rows = await this.#store.list<Payee>(company, PAYEE_DOMAIN, 500);
    return rows.map((row) => assertPayee(row, company));
  }

  async deactivate(companyInput: unknown, idInput: unknown): Promise<Payee> {
    const company = asAddress(companyInput, "company");
    const payeeId = paymentId(idInput);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await this.#store.get<Payee>(company, PAYEE_DOMAIN, payeeId);
      if (!current) throw new Error("Unknown payee ID");
      const payee = assertPayee(current, company);
      if (!payee.active) return payee;
      const next = { ...payee, active: false, updatedAt: new Date().toISOString() };
      const version = await this.#store.compareAndSwap({ companyId: company, domain: PAYEE_DOMAIN, recordId: payeeId,
        expectedVersion: current.recordVersion, payload: next, metadata: { kind: "payee", payeeKind: next.kind, active: false } });
      if (version !== null) return next;
    }
    throw new Error("Payee state changed concurrently; reload and retry");
  }

  async match(companyInput: unknown, idInput: unknown, recipientInput: unknown): Promise<Payee> {
    const company = asAddress(companyInput, "company");
    const recipient = asAddress(recipientInput, "recipient");
    const payee = await this.get(company, idInput);
    if (!payee.active || payee.recipientHash !== recipientHash(company, recipient)) {
      throw new Error("Active payee does not match payment recipient");
    }
    return payee;
  }

  async linkPayment(companyInput: unknown, paymentIdInput: unknown, payeeIdInput: unknown): Promise<Link> {
    const company = asAddress(companyInput, "company");
    const payment = paymentId(paymentIdInput);
    const payeeId = paymentId(payeeIdInput);
    await this.get(company, payeeId);
    const candidate: Link = { paymentId: payment, payeeId, company };
    const inserted = await this.#store.insertIfAbsent({ companyId: company, domain: LINK_DOMAIN, recordId: payment,
      payload: candidate, metadata: { kind: "payment-payee-link" } });
    const stored = inserted ? candidate : await this.#store.get<Link>(company, LINK_DOMAIN, payment);
    if (!stored || stored.company !== company || stored.paymentId !== payment || stored.payeeId !== payeeId) {
      throw new Error("Payment already linked to another payee");
    }
    return stored;
  }

  async paymentPayee(companyInput: unknown, paymentIdInput: unknown): Promise<Pick<Payee, "payeeId" | "kind" | "teamId"> | null> {
    const company = asAddress(companyInput, "company");
    const payment = paymentId(paymentIdInput);
    const link = await this.#store.get<Link>(company, LINK_DOMAIN, payment);
    if (!link) return null;
    const payee = await this.get(company, link.payeeId);
    return { payeeId: payee.payeeId, kind: payee.kind, teamId: payee.teamId };
  }
}
