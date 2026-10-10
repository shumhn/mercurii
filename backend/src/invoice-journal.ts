import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asAddress } from "./magicblock.ts";
import { getOrCreatePaymentFlow } from "./payment-flow.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

const DEFAULT_PATH = new URL("../.state/invoices.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_INVOICE_JOURNAL ?? DEFAULT_PATH;

type InvoiceRecord = { company?: string; fingerprint: string; termsHash: string; paymentId: string };
type Journal = { version: 1; secret: string; invoices: InvoiceRecord[] };

function readJournal(): Journal {
  try {
    const journal = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (journal.version !== 1 || !/^[0-9a-f]{64}$/.test(journal.secret) || !Array.isArray(journal.invoices)) {
      throw new Error("Invalid invoice journal");
    }
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const journal: Journal = { version: 1, secret: randomBytes(32).toString("hex"), invoices: [] };
      saveJournal(journal);
      return journal;
    }
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "invoices", journal, rowKeys: ["invoices"], sharedKeys: ["secret"] });
}

export function reserveInvoiceFlow(args: {
  company: string; vendorId: string; invoiceNumber: string; agent: string;
  recipient: string; amountMicro: string; includeFinance?: boolean;
}): { paymentId: string; requestId: string; requestAddress: string; repeated: boolean } {
  const company = asAddress(args.company, "company");
  const agent = asAddress(args.agent, "agent");
  const recipient = asAddress(args.recipient, "recipient");
  if (!/^[a-z0-9_-]{1,40}$/.test(args.vendorId)) throw new Error("Invalid vendor ID");
  const number = args.invoiceNumber.normalize("NFKC").trim().toLowerCase();
  if (!number || number.length > 80) throw new Error("Invalid invoice number");
  if (!/^\d+$/.test(args.amountMicro) || !Number.isSafeInteger(Number(args.amountMicro)) ||
      Number(args.amountMicro) <= 0) throw new Error("Invalid invoice amount");
  const journal = readJournal();
  const key = Buffer.from(journal.secret, "hex");
  const fingerprint = createHmac("sha256", key)
    .update(JSON.stringify([company, args.vendorId, number])).digest("hex");
  const termsHash = createHmac("sha256", key)
    .update(JSON.stringify([agent, recipient, args.amountMicro])).digest("hex");
  const existing = journal.invoices.find((item) => item.fingerprint === fingerprint);
  if (existing?.company && existing.company !== company) throw new Error("Invoice belongs to another company");
  if (existing && existing.termsHash !== termsHash) {
    throw new Error("Invoice number is already bound to different payment terms; review it manually");
  }
  const bytes = Buffer.from(fingerprint.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const paymentId = existing?.paymentId ??
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const { flow } = getOrCreatePaymentFlow(paymentId, company, {
    requester: agent, recipient, amountMicro: Number(args.amountMicro),
    includeFinance: args.includeFinance ?? true,
  });
  if (!existing) {
    journal.invoices.push({ company, fingerprint, termsHash, paymentId });
    saveJournal(journal);
  } else if (!existing.company) {
    // The fingerprint already commits to company; attach the explicit owner to legacy rows.
    existing.company = company;
    saveJournal(journal);
  }
  return { paymentId, requestId: flow.requestId, requestAddress: flow.request, repeated: !!existing };
}

export function listInvoicePaymentIds(companyInput: unknown): string[] {
  const company = asAddress(companyInput, "company");
  return readJournal().invoices
    .filter((item) => item.company === company)
    .map((item) => item.paymentId);
}
