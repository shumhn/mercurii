import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { asAddress } from "./magicblock.ts";

export type PaymentRecord = {
  paymentId: string; company: string; request: string; requester: string; requestId: string;
  actor: string | null; preparedMessageHash: string | null; signature: string | null;
  state: "registered" | "prepared" | "submitted" | "failed" | "settled" | "cancelled";
  createdAt: string; updatedAt: string;
};
type Journal = { version: 1; payments: PaymentRecord[] };
const DEFAULT_PATH = new URL("../.state/payments.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYMENT_JOURNAL ?? DEFAULT_PATH;

export function paymentId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("paymentId must be an opaque UUID v4");
  }
  return value.toLowerCase();
}

function readJournal(): Journal {
  try {
    const journal = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.payments)) throw new Error("Invalid payment journal");
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, payments: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const target = path();
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, target);
}

export function getPayment(id: unknown, company: string): PaymentRecord {
  const record = readJournal().payments.find((item) => item.paymentId === paymentId(id) && item.company === company);
  if (!record) throw new Error("Unknown payment ID");
  return record;
}

export function registerPayment(args: {
  paymentId: unknown; company: string; request: string; requester: string; requestId: string;
}): PaymentRecord {
  const id = paymentId(args.paymentId);
  const company = asAddress(args.company, "company");
  const request = asAddress(args.request, "request");
  const requester = asAddress(args.requester, "requester");
  if (!/^\d+$/.test(args.requestId)) throw new Error("Invalid onchain request ID");
  const journal = readJournal();
  const existing = journal.payments.find((item) => item.paymentId === id);
  if (existing) {
    if (existing.company !== company || existing.request !== request || existing.requester !== requester ||
        existing.requestId !== args.requestId) throw new Error("Payment ID is already bound to another request");
    return existing;
  }
  if (journal.payments.some((item) => item.company === company && item.request === request)) {
    throw new Error("Request is already bound to another payment ID");
  }
  const now = new Date().toISOString();
  const record: PaymentRecord = { paymentId: id, company, request, requester, requestId: args.requestId,
    actor: null, preparedMessageHash: null, signature: null, state: "registered", createdAt: now, updatedAt: now };
  journal.payments.push(record);
  saveJournal(journal);
  return record;
}

export function preparedMessageHash(transactionBase64: string): string {
  const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
  return createHash("sha256").update(transaction.serializeMessage()).digest("hex");
}

export function preparePayment(id: unknown, company: string, actorInput: string, transactionBase64: string): PaymentRecord {
  const journal = readJournal();
  const record = journal.payments.find((item) => item.paymentId === paymentId(id) && item.company === company);
  if (!record) throw new Error("Unknown payment ID");
  if (record.state !== "registered" && record.state !== "failed") throw new Error("Payment already has a prepared or submitted execution");
  record.actor = asAddress(actorInput, "actor");
  record.preparedMessageHash = preparedMessageHash(transactionBase64);
  record.signature = null;
  record.state = "prepared";
  record.updatedAt = new Date().toISOString();
  saveJournal(journal);
  return record;
}

export function bindSignedPayment(id: unknown, company: string, signedTransactionBase64: string): PaymentRecord {
  const journal = readJournal();
  const record = journal.payments.find((item) => item.paymentId === paymentId(id) && item.company === company);
  if (!record) throw new Error("Unknown payment ID");
  const transaction = Transaction.from(Buffer.from(signedTransactionBase64, "base64"));
  if (!transaction.verifySignatures()) throw new Error("Signed payment has invalid signatures");
  if (transaction.feePayer?.toBase58() !== record.actor ||
      preparedMessageHash(signedTransactionBase64) !== record.preparedMessageHash) {
    throw new Error("Signed payment does not match the prepared execution");
  }
  const signature = transaction.signatures[0]?.signature;
  if (!signature) throw new Error("Signed payment has no signature");
  const encoded = bs58.encode(signature);
  if ((record.state === "submitted" || record.state === "settled") && record.signature === encoded) return record;
  if (record.state !== "prepared") throw new Error("Payment is not awaiting this signature");
  record.signature = encoded;
  record.state = "submitted";
  record.updatedAt = new Date().toISOString();
  saveJournal(journal);
  return record;
}

export function reconcilePayment(id: unknown, company: string, requestStatus: string,
  chainStatus: "not_found" | "processed" | "confirmed" | "failed" | null): PaymentRecord {
  const journal = readJournal();
  const record = journal.payments.find((item) => item.paymentId === paymentId(id) && item.company === company);
  if (!record) throw new Error("Unknown payment ID");
  let next = record.state;
  if (requestStatus === "executed") next = "settled";
  else if (requestStatus === "rejected") next = "cancelled";
  else if (chainStatus === "failed" && record.state === "submitted") next = "failed";
  if (next !== record.state) {
    record.state = next;
    record.updatedAt = new Date().toISOString();
    saveJournal(journal);
  }
  return record;
}
