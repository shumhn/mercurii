import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, prepareRecipientWithdrawal, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR } from "../src/operations.ts";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WITHDRAW_MICRO = 1_000n;
const financePath = process.env.MERCURY_FINANCE_KEYPAIR;
if (!financePath) throw new Error("MERCURY_FINANCE_KEYPAIR is required");
const finance = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(financePath, "utf8"))));
const owner = finance.publicKey.toBase58();
const auth = await getAuthToken(TEE_RPC, finance.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, finance.secretKey));
const base = new Connection(BASE_RPC, "confirmed");
const tokenAccount = PublicKey.findProgramAddressSync([
  finance.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(DEVNET_USDC).toBuffer(),
], ATA_PROGRAM)[0];

async function baseBalance(): Promise<bigint> {
  const info = await base.getAccountInfo(tokenAccount);
  return info ? info.data.readBigUInt64LE(64) : 0n;
}

async function privateBalance(): Promise<bigint> {
  return BigInt((await readRecipientBalance({ owner, mint: DEVNET_USDC, teeToken: auth.token })).balanceMicro);
}

const privateBefore = await privateBalance();
const baseBefore = await baseBalance();
assert.equal(privateBefore, 11_000n, "one-shot USDC proof private starting balance changed");
assert.equal(baseBefore, 0n, "one-shot USDC proof base starting balance changed");

const built = await prepareRecipientWithdrawal({
  owner, mint: DEVNET_USDC, amountMicro: Number(WITHDRAW_MICRO), validator: TEE_VALIDATOR.toBase58(),
});
assert.deepEqual(built.requiredSigners, [owner]);
const raw = Buffer.from(built.transactionBase64, "base64");
let transaction: Transaction | VersionedTransaction;
try {
  transaction = VersionedTransaction.deserialize(raw);
} catch {
  transaction = Transaction.from(raw);
}
let signed: Buffer;
if (transaction instanceof VersionedTransaction) {
  transaction.sign([finance]);
  signed = Buffer.from(transaction.serialize());
} else {
  transaction.sign(finance);
  signed = Buffer.from(transaction.serialize());
}
const signature = await base.sendRawTransaction(signed, { skipPreflight: false });
let privateAfter = privateBefore;
let baseAfter = baseBefore;
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  [privateAfter, baseAfter] = await Promise.all([privateBalance(), baseBalance()]);
  if (privateAfter === privateBefore - WITHDRAW_MICRO && baseAfter === baseBefore + WITHDRAW_MICRO) break;
}
assert.equal(privateAfter, privateBefore - WITHDRAW_MICRO);
assert.equal(baseAfter, baseBefore + WITHDRAW_MICRO);
process.stdout.write(JSON.stringify({
  result: "PASS", signature, owner, mint: DEVNET_USDC, amountMicro: WITHDRAW_MICRO.toString(),
  privateBeforeMicro: privateBefore.toString(), privateAfterMicro: privateAfter.toString(),
  baseBeforeMicro: baseBefore.toString(), baseAfterMicro: baseAfter.toString(),
}, null, 2) + "\n");
