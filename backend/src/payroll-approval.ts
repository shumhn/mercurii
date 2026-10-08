import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

// A transaction chunk is deliberately smaller than the packet maximum so PER
// has room for compute overhead. This is not a company payroll roster limit.
export const MAX_APPROVALS_PER_TRANSACTION = 8;

export function buildPayrollApprovalChunk(args: {
  actor: string; blockhash: string; instructions: TransactionInstruction[];
}): { transactionBase64: string; itemCount: number } {
  if (args.instructions.length === 0) throw new Error("No payroll approvals remain");
  const transaction = new Transaction({ feePayer: new PublicKey(args.actor), recentBlockhash: args.blockhash });
  let encoded: Buffer | null = null;
  let itemCount = 0;
  for (const instruction of args.instructions.slice(0, MAX_APPROVALS_PER_TRANSACTION)) {
    transaction.add(instruction);
    try {
      encoded = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      itemCount++;
    } catch (error) {
      transaction.instructions.pop();
      if (!/too large/i.test(String(error)) || itemCount === 0) throw error;
      break;
    }
  }
  if (!encoded) throw new Error("No payroll approval fits in a transaction");
  return { transactionBase64: encoded.toString("base64"), itemCount };
}
