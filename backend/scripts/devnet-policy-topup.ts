import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { deriveLamportsPda, getAuthToken, lamportsDelegatedTransferIx } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { BASE_RPC, TEE_RPC } from "../src/operations.ts";

const COMPANY = new PublicKey("362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW");
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const AMOUNT = 10_000_000n;
const recordPath = process.env.MERCURY_TOPUP_RECORD;
const keyPath = process.env.MERCURY_FOUNDER_KEYPAIR;
if (!recordPath || !keyPath) throw new Error("MERCURY_TOPUP_RECORD and MERCURY_FOUNDER_KEYPAIR are required");
if (existsSync(recordPath)) throw new Error("Top-up record already exists; reconcile it before another attempt");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
assert.equal(founder.publicKey.toBase58(), FOUNDER);
const token = (await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey))).token;
const tee = new URL(TEE_RPC);
tee.searchParams.set("token", token);
const baseConnection = new Connection(BASE_RPC, "confirmed");
const teeConnection = new Connection(tee.toString(), "confirmed");
const delegated = await teeConnection.getAccountInfo(COMPANY);
if (!delegated) throw new Error("Company policy is not available on the TEE");
const before = delegated.lamports;
const payerBalance = await baseConnection.getBalance(founder.publicKey);
if (payerBalance < Number(AMOUNT + 1_000_000n)) throw new Error("Founder lacks SOL for the top-up and fees");
const salt = randomBytes(32);
const [lamportsPda] = deriveLamportsPda(founder.publicKey, COMPANY, salt);
writeFileSync(recordPath, JSON.stringify({ company: COMPANY.toBase58(), payer: FOUNDER,
  amountLamports: AMOUNT.toString(), saltHex: salt.toString("hex"), lamportsPda: lamportsPda.toBase58(),
  status: "prepared" }, null, 2), { mode: 0o600 });
const tx = new Transaction().add(lamportsDelegatedTransferIx(founder.publicKey, COMPANY, AMOUNT, salt));
tx.feePayer = founder.publicKey;
const signature = await sendAndConfirmTransaction(baseConnection, tx, [founder], { commitment: "confirmed" });
writeFileSync(recordPath, JSON.stringify({ company: COMPANY.toBase58(), payer: FOUNDER,
  amountLamports: AMOUNT.toString(), saltHex: salt.toString("hex"), lamportsPda: lamportsPda.toBase58(),
  status: "base_confirmed", signature }, null, 2), { mode: 0o600 });
for (let attempt = 0; attempt < 30; attempt++) {
  const account = await teeConnection.getAccountInfo(COMPANY);
  if (account && account.lamports >= before + Number(AMOUNT)) {
    writeFileSync(recordPath, JSON.stringify({ company: COMPANY.toBase58(), payer: FOUNDER,
      amountLamports: AMOUNT.toString(), saltHex: salt.toString("hex"), lamportsPda: lamportsPda.toBase58(),
      status: "credited_on_tee", signature, beforeLamports: before, afterLamports: account.lamports }, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ result: "PASS", signature, beforeLamports: before,
      afterLamports: account.lamports }, null, 2) + "\n");
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error(`Base top-up confirmed but TEE credit not observed yet: ${signature}`);
