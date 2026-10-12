import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { asAddress } from "./magicblock.ts";
import { PROGRAM_ID } from "./operations.ts";

export function founderCompanyAddress(founderInput: unknown): string {
  const founder = new PublicKey(asAddress(founderInput, "founder"));
  return PublicKey.findProgramAddressSync([
    Buffer.from("company-policy"), founder.toBuffer(),
  ], PROGRAM_ID)[0].toBase58();
}

/** The submit route rebuilds the expected public instruction. The recent
 * blockhash can change between preparation and submission, but the instruction,
 * accounts, fee payer, and Founder signature must still be exact. */
export function validateSignedCompanyBootstrap(input: {
  expectedTransactionBase64: string;
  signedTransactionBase64: string;
  founder: string;
}): { bytes: Buffer; signature: string } {
  const expected = Transaction.from(Buffer.from(input.expectedTransactionBase64, "base64"));
  const bytes = Buffer.from(input.signedTransactionBase64, "base64");
  const signed = Transaction.from(bytes);
  const founder = asAddress(input.founder, "founder");
  if (expected.instructions.length !== 1 || signed.instructions.length !== 1 ||
      signed.feePayer?.toBase58() !== founder || signed.signatures.length !== 1 ||
      signed.signatures[0]?.publicKey.toBase58() !== founder || !signed.verifySignatures()) {
    throw new Error("Founder signature or bootstrap transaction shape is invalid");
  }
  const actual = signed.instructions[0]!;
  const template = expected.instructions[0]!;
  if (!actual.programId.equals(template.programId) || !actual.data.equals(template.data) ||
      actual.keys.length !== template.keys.length ||
      actual.keys.some((key, index) => !key.pubkey.equals(template.keys[index]!.pubkey) ||
        key.isSigner !== template.keys[index]!.isSigner ||
        key.isWritable !== template.keys[index]!.isWritable)) {
    throw new Error("Signed bootstrap does not match the Founder, Finance, and mint terms");
  }
  const signature = signed.signatures[0]!.signature;
  if (!signature) throw new Error("Founder signature is missing");
  return { bytes, signature: bs58.encode(signature) };
}
