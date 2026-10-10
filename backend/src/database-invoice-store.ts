import { createHmac, randomBytes } from "node:crypto";
import { asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

type InvoiceRecord = { company: string; fingerprint: string; termsHash: string; paymentId: string };
const KEY_DOMAIN = "operation.invoice-key";
const INVOICE_DOMAIN = "operation.invoice";

function uuidFromFingerprint(fingerprint: string): string {
  const bytes = Buffer.from(fingerprint.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Encrypted database-primary invoice idempotency registry. */
export class DatabaseInvoiceStore {
  readonly #store: SupabasePrivateStore;
  constructor(store: SupabasePrivateStore) { this.#store = store; }
  static fromEnvironment(): DatabaseInvoiceStore | null {
    if (process.env.MERCURY_INVOICE_STORE !== "supabase") return null;
    const store = SupabasePrivateStore.fromEnvironment();
    if (!store) throw new Error("Supabase invoice storage is enabled but not configured");
    return new DatabaseInvoiceStore(store);
  }
  async reserve(args: { company: string; vendorId: string; invoiceNumber: string; agent: string;
    recipient: string; amountMicro: string; createFlow: (id: string, company: string, input: Record<string, unknown>) => Promise<{ flow: { requestId: string; request: string } }> }) {
    const company = asAddress(args.company, "company"); const agent = asAddress(args.agent, "agent");
    const recipient = asAddress(args.recipient, "recipient");
    if (!/^[a-z0-9_-]{1,40}$/.test(args.vendorId) || !/^\d+$/.test(args.amountMicro) || Number(args.amountMicro) <= 0) throw new Error("Invalid invoice terms");
    const number = args.invoiceNumber.normalize("NFKC").trim().toLowerCase();
    if (!number || number.length > 80) throw new Error("Invalid invoice number");
    let key = await this.#store.get<{ secret: string }>(company, KEY_DOMAIN, "current");
    if (!key) { await this.#store.insertIfAbsent({ companyId: company, domain: KEY_DOMAIN, recordId: "current", payload: { secret: randomBytes(32).toString("hex") } }); key = await this.#store.get(company, KEY_DOMAIN, "current"); }
    if (!key || !/^[0-9a-f]{64}$/.test(key.secret)) throw new Error("Invoice key unavailable");
    const fingerprint = createHmac("sha256", Buffer.from(key.secret, "hex")).update(JSON.stringify([company, args.vendorId, number])).digest("hex");
    const termsHash = createHmac("sha256", Buffer.from(key.secret, "hex")).update(JSON.stringify([agent, recipient, args.amountMicro])).digest("hex");
    const existing = await this.#store.get<InvoiceRecord>(company, INVOICE_DOMAIN, fingerprint);
    if (existing && existing.termsHash !== termsHash) throw new Error("Invoice number is already bound to different payment terms; review it manually");
    const id = existing?.paymentId ?? paymentId(uuidFromFingerprint(fingerprint));
    const linked = await args.createFlow(id, company, { requester: agent, recipient, amountMicro: Number(args.amountMicro), includeFinance: true });
    if (!existing) await this.#store.insertIfAbsent({ companyId: company, domain: INVOICE_DOMAIN, recordId: fingerprint,
      payload: { company, fingerprint, termsHash, paymentId: id }, metadata: { kind: "invoice" } });
    return { paymentId: id, requestId: linked.flow.requestId, requestAddress: linked.flow.request, repeated: !!existing };
  }
}
