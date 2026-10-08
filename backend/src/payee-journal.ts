import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";

const DEFAULT_PATH = new URL("../.state/payees.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYEE_JOURNAL ?? DEFAULT_PATH;
type Kind = "employee" | "contractor" | "vendor";
export type Payee = { payeeId: string; company: string; kind: Kind; teamId: string | null;
  recipientHash: string; active: boolean; createdAt: string; updatedAt: string };
type Link = { paymentId: string; payeeId: string; company: string };
type Journal = { version: 1; payees: Payee[]; links: Link[] };

function readJournal(): Journal {
  try {
    const value = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (value.version !== 1 || !Array.isArray(value.payees) || !Array.isArray(value.links)) {
      throw new Error("Invalid payee journal");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, payees: [], links: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
}

function recipientHash(company: string, recipient: string): string {
  return createHash("sha256").update(`mercury-payee:${company}:${recipient}`).digest("hex");
}

export function registerPayee(companyInput: unknown, input: Record<string, unknown>): Payee {
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
  const hash = recipientHash(company, recipient);
  const journal = readJournal();
  const existing = journal.payees.find((item) => item.payeeId === payeeId);
  if (existing) {
    if (existing.company !== company || existing.kind !== kind || existing.teamId !== teamId ||
        existing.recipientHash !== hash) throw new Error("Payee ID is already bound to different details");
    return existing;
  }
  const now = new Date().toISOString();
  const payee: Payee = { payeeId, company, kind, teamId, recipientHash: hash,
    active: true, createdAt: now, updatedAt: now };
  journal.payees.push(payee);
  saveJournal(journal);
  return payee;
}

export function listPayees(companyInput: unknown): Payee[] {
  const company = asAddress(companyInput, "company");
  return readJournal().payees.filter((item) => item.company === company);
}

export function deactivatePayee(companyInput: unknown, idInput: unknown): Payee {
  const company = asAddress(companyInput, "company");
  const id = paymentId(idInput);
  const journal = readJournal();
  const payee = journal.payees.find((item) => item.company === company && item.payeeId === id);
  if (!payee) throw new Error("Unknown payee ID");
  if (payee.active) {
    payee.active = false;
    payee.updatedAt = new Date().toISOString();
    saveJournal(journal);
  }
  return payee;
}

export function matchPayee(companyInput: unknown, idInput: unknown, recipientInput: unknown): Payee {
  const company = asAddress(companyInput, "company");
  const payeeId = paymentId(idInput);
  const recipient = asAddress(recipientInput, "recipient");
  const payee = readJournal().payees.find((item) => item.company === company && item.payeeId === payeeId);
  if (!payee || !payee.active || payee.recipientHash !== recipientHash(company, recipient)) {
    throw new Error("Active payee does not match payment recipient");
  }
  return payee;
}

export function linkPaymentPayee(companyInput: unknown, paymentIdInput: unknown, payeeIdInput: unknown): Link {
  const company = asAddress(companyInput, "company");
  const id = paymentId(paymentIdInput);
  const payeeId = paymentId(payeeIdInput);
  const journal = readJournal();
  if (!journal.payees.some((item) => item.company === company && item.payeeId === payeeId)) {
    throw new Error("Unknown payee ID");
  }
  const existing = journal.links.find((item) => item.company === company && item.paymentId === id);
  if (existing) {
    if (existing.payeeId !== payeeId) throw new Error("Payment already linked to another payee");
    return existing;
  }
  const link = { paymentId: id, payeeId, company };
  journal.links.push(link);
  saveJournal(journal);
  return link;
}

export function paymentPayee(companyInput: unknown, paymentIdInput: unknown): Pick<Payee, "payeeId" | "kind" | "teamId"> | null {
  const company = asAddress(companyInput, "company");
  const id = paymentId(paymentIdInput);
  const journal = readJournal();
  const link = journal.links.find((item) => item.company === company && item.paymentId === id);
  const payee = journal.payees.find((item) => item.company === company && item.payeeId === link?.payeeId);
  return payee ? { payeeId: payee.payeeId, kind: payee.kind, teamId: payee.teamId } : null;
}
