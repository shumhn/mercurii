import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildPayrollApprovalChunk } from "../src/payroll-approval.ts";

test("approval planning chunks a roster without a four-person run limit", () => {
  const actor = Keypair.generate().publicKey;
  const policy = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const instructions = Array.from({ length: 13 }, () => new TransactionInstruction({
    programId, data: Buffer.alloc(8), keys: [
      { pubkey: actor, isSigner: true, isWritable: true },
      { pubkey: policy, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
    ],
  }));
  const blockhash = Keypair.generate().publicKey.toBase58();
  const first = buildPayrollApprovalChunk({ actor: actor.toBase58(), blockhash, instructions });
  assert.equal(first.itemCount, 8);
  assert.equal(Transaction.from(Buffer.from(first.transactionBase64, "base64")).instructions.length, 8);
  const second = buildPayrollApprovalChunk({ actor: actor.toBase58(), blockhash,
    instructions: instructions.slice(first.itemCount) });
  assert.equal(second.itemCount, 5);
  assert.equal(first.itemCount + second.itemCount, 13);
});
