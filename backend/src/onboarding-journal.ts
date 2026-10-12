import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { TEE_RPC } from "./operations.ts";
import { teeConnection } from "./magicblock.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

export type Receipt = {
  id: string; company: string; target: string; operation: string;
  chain: "base" | "ephemeral"; signature: string | null; blockhash?: string;
  status: "built" | "pending" | "confirmed" | "failed" | "expired";
  createdAt: string; error: unknown | null;
};
type Journal = { version: 1; receipts: Receipt[] };
const DEFAULT_PATH = new URL("../.state/onboarding-receipts.json", import.meta.url).pathname;

function journalPath(): string { return process.env.MERCURY_ONBOARDING_JOURNAL ?? DEFAULT_PATH; }

function readJournal(): Journal {
  try {
    const value = JSON.parse(readFileSync(journalPath(), "utf8")) as Journal;
    if (value.version !== 1 || !Array.isArray(value.receipts)) throw new Error("Invalid onboarding journal");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, receipts: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const path = journalPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
  mirrorCompanyJournal({ domain: "onboarding-receipts", journal, rowKeys: ["receipts"] });
}

/**
 * Rebuild the local read cache from encrypted durable receipts at process
 * start. The cache exists only for the synchronous program inspectors; the
 * server writes every new or changed receipt through its database repository.
 */
export function hydrateOnboardingReceiptCache(receipts: Receipt[]): void {
  const journal = readJournal();
  let changed = false;
  for (const receipt of receipts) {
    const current = journal.receipts.find((item) => item.id === receipt.id);
    if (!current) {
      journal.receipts.push(receipt);
      changed = true;
      continue;
    }
    if (current.company !== receipt.company || current.target !== receipt.target ||
        current.operation !== receipt.operation || current.chain !== receipt.chain) {
      throw new Error("Onboarding receipt cache conflicts with durable receipt");
    }
    if (JSON.stringify(current) !== JSON.stringify(receipt)) {
      Object.assign(current, receipt);
      changed = true;
    }
  }
  if (changed) saveJournal(journal);
}

function deserialize(raw: Buffer): Transaction | VersionedTransaction {
  try { return VersionedTransaction.deserialize(raw); }
  catch { return Transaction.from(raw); }
}

function messageBytes(transaction: Transaction | VersionedTransaction): Buffer {
  return Buffer.from(transaction instanceof Transaction
    ? transaction.serializeMessage() : transaction.message.serialize());
}

function messageId(transaction: Transaction | VersionedTransaction): string {
  return createHash("sha256").update(messageBytes(transaction)).digest("hex");
}

function firstVerifiedSignature(transaction: Transaction | VersionedTransaction): Uint8Array | null {
  if (transaction instanceof Transaction) {
    return transaction.verifySignatures() ? transaction.signatures[0]?.signature ?? null : null;
  }
  const message = transaction.message;
  const signerKeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  if (signerKeys.length === 0 || transaction.signatures.length !== signerKeys.length) return null;
  const bytes = messageBytes(transaction);
  for (let i = 0; i < signerKeys.length; i++) {
    if (!nacl.sign.detached.verify(bytes, transaction.signatures[i]!, signerKeys[i]!.toBytes())) return null;
  }
  return transaction.signatures[0] ?? null;
}

/** Check an exact signed receipt without relying on a status RPC before broadcast. */
export function validateSignedOnboardingReceipt(id: string, company: string, signedTransactionBase64: string): {
  bytes: Buffer; signature: string; receipt: Receipt;
} {
  const receipt = getOnboardingReceipt(id, company);
  if (receipt.status === "expired") throw new Error("Onboarding transaction expired; build a new step");
  const bytes = Buffer.from(signedTransactionBase64, "base64");
  const transaction = deserialize(bytes);
  const signature = firstVerifiedSignature(transaction);
  if (messageId(transaction) !== id || !signature) {
    throw new Error("Signed transaction does not match the prepared onboarding step");
  }
  const signatureText = bs58.encode(signature);
  if (receipt.signature && receipt.signature !== signatureText) throw new Error("Receipt already has another signature");
  return { bytes, signature: signatureText, receipt };
}

export function recordOnboardingBuild(args: {
  company: string; target: string; operation: string;
  chain: "base" | "ephemeral"; transactionBase64: string;
}): Receipt {
  const transaction = deserialize(Buffer.from(args.transactionBase64, "base64"));
  const id = messageId(transaction);
  const journal = readJournal();
  const existing = journal.receipts.find((receipt) => receipt.id === id);
  if (existing) {
    if (existing.company !== args.company || existing.target !== args.target ||
        existing.operation !== args.operation || existing.chain !== args.chain) {
      throw new Error("Onboarding transaction is already bound to another step");
    }
    return existing;
  }
  const receipt: Receipt = {
    id, company: args.company, target: args.target, operation: args.operation,
    chain: args.chain, signature: null, status: "built",
    blockhash: transaction instanceof Transaction ? transaction.recentBlockhash : transaction.message.recentBlockhash,
    createdAt: new Date().toISOString(), error: null,
  };
  journal.receipts.push(receipt);
  saveJournal(journal);
  return receipt;
}

// Only an unsigned transaction with a proven expired blockhash can be replaced.
// Older receipts without a recorded blockhash remain manual-recovery cases.
export async function expireUnsignedOnboardingReceipt(id: string, company: string, teeToken: string,
  blockhashValid?: (chain: "base" | "ephemeral", blockhash: string) => Promise<boolean>,
  now = Date.now()): Promise<Receipt> {
  const receipt = getOnboardingReceipt(id, company);
  if (receipt.status !== "built" || receipt.signature || !receipt.blockhash) return receipt;
  const created = Date.parse(receipt.createdAt);
  if (!Number.isFinite(created) || now - created < 90_000) return receipt;
  const connection = receipt.chain === "base"
    ? new Connection(process.env.MERCURY_BASE_SUBMIT_RPC ?? "https://api.devnet.solana.com", "confirmed")
    : teeConnection(teeToken);
  const valid = blockhashValid
    ? await blockhashValid(receipt.chain, receipt.blockhash)
    : (await connection.isBlockhashValid(receipt.blockhash, { commitment: "finalized" })).value;
  if (valid) return getOnboardingReceipt(id, company);
  const journal = readJournal();
  const latest = journal.receipts.find((item) => item.id === id && item.company === company);
  if (!latest) throw new Error("Unknown onboarding receipt");
  if (latest.status === "built" && !latest.signature) {
    latest.status = "expired";
    saveJournal(journal);
  }
  return latest;
}

export function confirmedOnboardingStep(company: string, target: string, operation: string): boolean {
  return readJournal().receipts.some((receipt) =>
    receipt.company === company && receipt.target === target &&
    receipt.operation === operation && receipt.status === "confirmed");
}

export function latestOnboardingReceipt(company: string, target: string, operation: string): Receipt | null {
  return readJournal().receipts.filter((receipt) =>
    receipt.company === company && receipt.target === target && receipt.operation === operation).at(-1) ?? null;
}

export function getOnboardingReceipt(id: string, company: string): Receipt {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid receipt ID");
  const receipt = readJournal().receipts.find((item) => item.id === id && item.company === company);
  if (!receipt) throw new Error("Unknown onboarding receipt");
  return receipt;
}

export function listOnboardingReceipts(company: string): Receipt[] {
  return readJournal().receipts.filter((item) => item.company === company);
}

// A confirmed Private Payments deposit is Mercury's privacy-preserving
// recipient registration evidence. It proves the app observed onboarding
// without giving a Founder a reader permission over that recipient's balance.
export function hasConfirmedRecipientDeposit(recipient: string): boolean {
  return readJournal().receipts.some((receipt) => receipt.operation === "recipientDeposit" &&
    receipt.status === "confirmed" && receipt.target.startsWith(`${recipient}:`));
}

export function waitForCleanupReceipt(receipt: Receipt | null, now = Date.now()): boolean {
  if (!receipt || (receipt.status !== "built" && receipt.status !== "pending")) return false;
  const created = Date.parse(receipt.createdAt);
  if (!Number.isFinite(created)) throw new Error("Cleanup receipt has an invalid creation time");
  return now - created < 5 * 60_000;
}

export async function confirmOnboardingReceipt(id: string, signedTransactionBase64: string,
  teeToken: string, statusLookup?: (chain: "base" | "ephemeral", signature: string) =>
    Promise<{ err: unknown; confirmationStatus: string | null } | null>): Promise<Receipt> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid receipt ID");
  const receipt = readJournal().receipts.find((item) => item.id === id);
  if (!receipt) throw new Error("Unknown onboarding receipt");
  const { signature: signatureText } = validateSignedOnboardingReceipt(id, receipt.company, signedTransactionBase64);
  const connection = receipt.chain === "base"
    ? new Connection(process.env.MERCURY_BASE_SUBMIT_RPC ?? "https://api.devnet.solana.com", "confirmed")
    : teeConnection(teeToken);
  const status = statusLookup
    ? await statusLookup(receipt.chain, signatureText)
    : (await connection.getSignatureStatuses([signatureText], { searchTransactionHistory: true })).value[0];
  const latestJournal = readJournal();
  const latest = latestJournal.receipts.find((item) => item.id === id);
  if (!latest) throw new Error("Unknown onboarding receipt");
  if (latest.status === "expired") throw new Error("Onboarding transaction expired; build a new step");
  if (latest.signature && latest.signature !== signatureText) throw new Error("Receipt already has another signature");
  latest.signature = signatureText;
  if (latest.status !== "confirmed" && latest.status !== "failed") {
    latest.status = status?.err ? "failed" : status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized" ? "confirmed" : "pending";
    latest.error = status?.err ?? null;
  }
  saveJournal(latestJournal);
  return latest;
}

export async function reconcileOnboardingReceipt(id: string, company: string, teeToken: string,
  statusLookup?: (chain: "base" | "ephemeral", signature: string) =>
    Promise<{ err: unknown; confirmationStatus: string | null } | null>): Promise<Receipt> {
  const receipt = readJournal().receipts.find((item) => item.id === id && item.company === company);
  if (!receipt) throw new Error("Unknown onboarding receipt");
  if (!receipt.signature || receipt.status === "confirmed" || receipt.status === "failed") return receipt;
  const connection = receipt.chain === "base"
    ? new Connection(process.env.MERCURY_BASE_SUBMIT_RPC ?? "https://api.devnet.solana.com", "confirmed")
    : teeConnection(teeToken);
  const status = statusLookup
    ? await statusLookup(receipt.chain, receipt.signature)
    : (await connection.getSignatureStatuses([receipt.signature], { searchTransactionHistory: true })).value[0];
  const journal = readJournal();
  const latest = journal.receipts.find((item) => item.id === id && item.company === company);
  if (!latest) throw new Error("Unknown onboarding receipt");
  if (latest.signature !== receipt.signature) throw new Error("Receipt signature changed during reconciliation");
  if (latest.status === "confirmed" || latest.status === "failed") return latest;
  const next = status?.err ? "failed" : status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized" ? "confirmed" : "pending";
  if (next !== latest.status || (status?.err ?? null) !== latest.error) {
    latest.status = next;
    latest.error = status?.err ?? null;
    saveJournal(journal);
  }
  return latest;
}
