import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { prepareRecipientWithdrawal } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR } from "../src/operations.ts";

const financePath = process.env.MERCURY_FINANCE_KEYPAIR;
if (!financePath) throw new Error("MERCURY_FINANCE_KEYPAIR is required");
const amountMicro = Number(process.env.MERCURY_TEST_WITHDRAW_MICRO ?? "0");
if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 || amountMicro > 1_000_000) {
  throw new Error("MERCURY_TEST_WITHDRAW_MICRO must be 1..1000000 test microtokens");
}
const finance = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(financePath, "utf8"))));
const owner = finance.publicKey.toBase58();
const mint = "BHTANWG8igML3nxnHLcokhhzYt999W5LWjrtECFpNiv";
const recipientToken = new PublicKey("HkDPVU5zZdFkauhCTUHw9inMV9BBjYJ2q2LL4FmsukVv");
const auth = await getAuthToken(TEE_RPC, finance.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, finance.secretKey));
const teeEndpoint = new URL(TEE_RPC);
teeEndpoint.searchParams.set("token", auth.token);
const tee = new Connection(teeEndpoint.toString(), "confirmed");
const base = new Connection(BASE_RPC, "confirmed");

async function balance(connection: Connection): Promise<bigint> {
  const account = await connection.getAccountInfo(recipientToken);
  return account ? account.data.readBigUInt64LE(64) : 0n;
}

const privateBefore = await balance(tee);
const baseBefore = await balance(base);
assert.equal(amountMicro, 1, "this one-shot proof withdraws exactly one test microtoken");
assert.equal(privateBefore, 2_250_000n, "proof starting private balance changed; refusing a second withdrawal");
assert.equal(baseBefore, 0n, "proof starting base balance changed; refusing a second withdrawal");
const built = await prepareRecipientWithdrawal({
  owner, mint, amountMicro, validator: TEE_VALIDATOR.toBase58(),
});
assert.deepEqual(built.requiredSigners, [owner]);

const raw = Buffer.from(built.transactionBase64, "base64");
let tx: Transaction | VersionedTransaction;
try {
  tx = VersionedTransaction.deserialize(raw);
} catch {
  tx = Transaction.from(raw);
}
let serialized: Buffer;
if (tx instanceof VersionedTransaction) {
  tx.sign([finance]);
  serialized = Buffer.from(tx.serialize());
} else {
  tx.sign(finance);
  serialized = Buffer.from(tx.serialize());
}
const signature = await base.sendRawTransaction(serialized, { skipPreflight: false });
process.stdout.write(`withdraw_submitted: ${signature}\n`);

let privateAfter = privateBefore;
let baseAfter = baseBefore;
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  [privateAfter, baseAfter] = await Promise.all([balance(tee), balance(base)]);
  if (privateAfter <= privateBefore - BigInt(amountMicro) && baseAfter >= baseBefore + BigInt(amountMicro)) break;
}
assert.ok(privateAfter <= privateBefore - BigInt(amountMicro), "private balance did not fall by withdrawal amount");
assert.ok(baseAfter >= baseBefore + BigInt(amountMicro), "base balance did not rise by withdrawal amount");
process.stdout.write(JSON.stringify({
  result: "PASS", signature, owner, mint, amountMicro,
  privateBefore: privateBefore.toString(), privateAfter: privateAfter.toString(),
  baseBefore: baseBefore.toString(), baseAfter: baseAfter.toString(),
}, null, 2) + "\n");
