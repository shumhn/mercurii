import { ComputeBudgetProgram, Transaction, VersionedTransaction } from "@solana/web3.js";

/** Wallets (Phantom, Solflare, …) may inject ComputeBudget priority-fee
 * instructions while signing. Those change the serialized message, which broke
 * receipt/message-hash binding. Canonical bytes strip wallet-injected budget
 * instructions so the hash still matches the backend-prepared step; the full
 * signed bytes (with the wallet's instructions) are what get broadcast.
 * Versioned messages are left untouched: stripping would renumber account
 * indexes and is unsafe. */
export function canonicalMessageBytes(transaction: Transaction | VersionedTransaction): Buffer {
  if (!(transaction instanceof Transaction)) return Buffer.from(transaction.message.serialize());
  const computeBudget = ComputeBudgetProgram.programId;
  const meaningful = transaction.instructions.filter((ix) => !ix.programId.equals(computeBudget));
  if (meaningful.length === transaction.instructions.length || meaningful.length === 0) {
    return transaction.serializeMessage();
  }
  const clone = new Transaction();
  clone.feePayer = transaction.feePayer;
  clone.recentBlockhash = transaction.recentBlockhash;
  clone.instructions = meaningful;
  return clone.serializeMessage();
}
