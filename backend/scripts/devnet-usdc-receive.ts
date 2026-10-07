import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, preparePrivateReceive } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR, readCompanyPolicy, readTreasurySnapshot } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT = new PublicKey(DEVNET_USDC);
const COMPANY_TARGET = 50_000n;
const RECIPIENT_TARGET = 1_000n;

function loadKey(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function tokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), MINT.toBuffer()], ATA_PROGRAM,
  )[0];
}

async function tokenBalance(connection: Connection, owner: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAddress(owner));
  if (!info) return 0n;
  assert.ok(info.owner.equals(TOKEN_PROGRAM) && info.data.length >= 72, "invalid token account");
  assert.ok(new PublicKey(info.data.subarray(0, 32)).equals(MINT), "wrong token mint");
  assert.ok(new PublicKey(info.data.subarray(32, 64)).equals(owner), "wrong token owner");
  return info.data.readBigUInt64LE(64);
}

async function sendReceive(
  source: Keypair, recipient: PublicKey, amountMicro: number, base: Connection,
): Promise<string> {
  const built = await preparePrivateReceive({
    payer: source.publicKey.toBase58(), company: recipient.toBase58(), amountMicro,
    expectedValidator: TEE_VALIDATOR.toBase58(),
  });
  assert.equal(built.sendTo, "base", "expected a base-layer funding transaction");
  assert.deepEqual(built.requiredSigners, [source.publicKey.toBase58()]);
  const raw = Buffer.from(built.transactionBase64, "base64");
  let transaction: Transaction | VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(raw);
  } catch {
    transaction = Transaction.from(raw);
  }
  let signed: Buffer;
  if (transaction instanceof VersionedTransaction) {
    transaction.sign([source]);
    signed = Buffer.from(transaction.serialize());
  } else {
    transaction.sign(source);
    signed = Buffer.from(transaction.serialize());
  }
  return base.sendRawTransaction(signed, { skipPreflight: false });
}

async function waitForCredit(connection: Connection, owner: PublicKey, target: bigint): Promise<bigint> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const balance = await tokenBalance(connection, owner);
    if (balance >= target) return balance;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`private credit was not observed for ${owner.toBase58()}`);
}

const source = loadKey("MERCURY_USDC_SOURCE_KEYPAIR");
const finance = loadKey("MERCURY_FINANCE_KEYPAIR");
const company = new PublicKey(COMPANY);
const auth = await getAuthToken(TEE_RPC, finance.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, finance.secretKey));
const policy = await readCompanyPolicy(COMPANY, auth.token);
assert.equal(policy.mint, DEVNET_USDC, "company policy is not Circle devnet USDC");
assert.equal(policy.finance, finance.publicKey.toBase58(), "wrong Finance signer");
const teeUrl = new URL(TEE_RPC);
teeUrl.searchParams.set("token", auth.token);
const tee = new Connection(teeUrl.toString(), "confirmed");
const base = new Connection(BASE_RPC, "confirmed");

const initialSourceBalance = await tokenBalance(base, source.publicKey);
let companyBefore = 0n;
try {
  companyBefore = BigInt((await readTreasurySnapshot(COMPANY, auth.token)).balanceMicro);
} catch {
  // A brand-new company has no synchronized snapshot until after its first deposit.
}
const recipientBefore = await tokenBalance(tee, finance.publicKey);
const required = (companyBefore >= COMPANY_TARGET ? 0n : COMPANY_TARGET - companyBefore)
  + (recipientBefore >= RECIPIENT_TARGET ? 0n : RECIPIENT_TARGET - recipientBefore);
assert.ok(initialSourceBalance >= required, "source wallet lacks the required Circle devnet USDC");

const signatures: Record<string, string> = {};
if (companyBefore < COMPANY_TARGET) {
  assert.equal(process.env.MERCURY_CONFIRM_COMPANY_TOPUP, "1",
    "set MERCURY_CONFIRM_COMPANY_TOPUP=1 only for an intentional company top-up");
  signatures.company = await sendReceive(source, company, Number(COMPANY_TARGET - companyBefore), base);
  process.stdout.write(JSON.stringify({
    status: "company_receive_submitted", signature: signatures.company,
    message: "Synchronize and verify the Mercury treasury snapshot before running this script again",
  }, null, 2) + "\n");
  process.exit(0);
}
if (recipientBefore < RECIPIENT_TARGET) {
  signatures.recipient = await sendReceive(source, finance.publicKey, Number(RECIPIENT_TARGET - recipientBefore), base);
  await waitForCredit(tee, finance.publicKey, RECIPIENT_TARGET);
}

process.stdout.write(JSON.stringify({
  result: "PASS", company: COMPANY, mint: DEVNET_USDC,
  source: source.publicKey.toBase58(), recipient: finance.publicKey.toBase58(),
  signatures, companySnapshotMicro: companyBefore.toString(),
  recipientBeforeMicro: recipientBefore.toString(),
  recipientAfterMicro: (await tokenBalance(tee, finance.publicKey)).toString(),
  sourceAfterMicro: (await tokenBalance(base, source.publicKey)).toString(),
}, null, 2) + "\n");
