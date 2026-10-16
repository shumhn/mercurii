import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { canonicalTokenAccount, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, TEE_VALIDATOR } from "../src/operations.ts";

const PAYMENTS_URL = "https://payments.magicblock.app";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function keypair(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

async function walletToken(wallet: Keypair): Promise<string> {
  const address = wallet.publicKey.toBase58();
  const challengeUrl = new URL("/v1/spl/challenge", PAYMENTS_URL);
  challengeUrl.searchParams.set("pubkey", address);
  challengeUrl.searchParams.set("cluster", "devnet-private");
  const challengeResponse = await fetch(challengeUrl, { signal: AbortSignal.timeout(30_000) });
  const challengeRaw = await challengeResponse.text();
  if (!challengeResponse.ok) {
    throw new Error(`Payments challenge failed (${challengeResponse.status}): ${challengeRaw.slice(0, 500)}`);
  }
  const challengeBody = JSON.parse(challengeRaw) as { challenge?: unknown };
  assert.ok(typeof challengeBody.challenge === "string" && challengeBody.challenge.length > 0,
    "Payments API returned no challenge");
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(challengeBody.challenge, "utf8"), wallet.secretKey));
  const loginResponse = await fetch(new URL("/v1/spl/login", PAYMENTS_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pubkey: address,
      challenge: challengeBody.challenge,
      signature,
      cluster: "devnet-private",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const loginRaw = await loginResponse.text();
  if (!loginResponse.ok) {
    throw new Error(`Payments login failed (${loginResponse.status}): ${loginRaw.slice(0, 500)}`);
  }
  const loginBody = JSON.parse(loginRaw) as { token?: unknown };
  assert.ok(typeof loginBody.token === "string" && loginBody.token.startsWith(`${address}.`),
    "Payments API returned an unbound wallet token");
  return loginBody.token;
}

async function baseTokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const ata = new PublicKey(canonicalTokenAccount(owner.toBase58(), mint.toBase58()));
  const account = await connection.getAccountInfo(ata, "confirmed");
  if (!account) return 0n;
  assert.ok(account.owner.equals(TOKEN_PROGRAM), "base ATA is not owned by the SPL Token program");
  assert.ok(account.data.length >= 72, "base ATA data is too short");
  assert.ok(new PublicKey(account.data.subarray(0, 32)).equals(mint), "base ATA has the wrong mint");
  assert.ok(new PublicKey(account.data.subarray(32, 64)).equals(owner), "base ATA has the wrong owner");
  return account.data.readBigUInt64LE(64);
}

type BuiltTransfer = {
  kind: "transfer";
  transactionBase64: string;
  sendTo: "base";
  requiredSigners: string[];
  recentBlockhash: string;
  lastValidBlockHeight: number;
};

async function buildPrivateTransfer(payer: PublicKey, recipient: PublicKey, mint: PublicKey,
  amountMicro: number): Promise<BuiltTransfer> {
  const response = await fetch(new URL("/v1/spl/transfer", PAYMENTS_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from: payer.toBase58(),
      to: recipient.toBase58(),
      mint: mint.toBase58(),
      amount: amountMicro,
      visibility: "private",
      fromBalance: "base",
      toBalance: "ephemeral",
      cluster: "devnet-private",
      validator: TEE_VALIDATOR.toBase58(),
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Private Payments transfer builder failed (${response.status}): ${raw.slice(0, 500)}`);
  const built = JSON.parse(raw) as Partial<BuiltTransfer>;
  assert.equal(built.kind, "transfer");
  assert.equal(built.sendTo, "base");
  assert.ok(typeof built.transactionBase64 === "string" && built.transactionBase64.length > 0);
  assert.deepEqual(built.requiredSigners, [payer.toBase58()]);
  assert.ok(typeof built.recentBlockhash === "string" && built.recentBlockhash.length > 0);
  assert.ok(Number.isSafeInteger(built.lastValidBlockHeight));
  return built as BuiltTransfer;
}

async function signAndSubmit(built: BuiltTransfer, payer: Keypair, base: Connection): Promise<string> {
  const serialized = Buffer.from(built.transactionBase64, "base64");
  let signed: Buffer;
  try {
    const transaction = VersionedTransaction.deserialize(serialized);
    transaction.sign([payer]);
    signed = Buffer.from(transaction.serialize());
  } catch {
    const transaction = Transaction.from(serialized);
    transaction.sign(payer);
    signed = Buffer.from(transaction.serialize());
  }
  const signature = await base.sendRawTransaction(signed, { skipPreflight: false, maxRetries: 5 });
  const confirmation = await base.confirmTransaction({
    signature,
    blockhash: built.recentBlockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
  }, "confirmed");
  assert.equal(confirmation.value.err, null, `base transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}

async function waitForPrivateBalance(owner: PublicKey, mint: PublicKey, teeToken: string,
  minimum: bigint): Promise<bigint> {
  let last = 0n;
  for (let attempt = 0; attempt < 45; attempt++) {
    const view = await readRecipientBalance({
      owner: owner.toBase58(), mint: mint.toBase58(), teeToken,
    });
    last = BigInt(view.balanceMicro);
    if (last >= minimum) return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`private balance did not reach ${minimum}; last observed ${last}`);
}

const payer = keypair("MERCURY_E2E_PAYER_KEYPAIR");
const recipient = keypair("MERCURY_E2E_RECIPIENT_KEYPAIR");
const mint = new PublicKey(process.env.MERCURY_E2E_MINT ?? "");
const amountMicro = positiveInteger("MERCURY_E2E_AMOUNT_MICRO", 3_000_000);
const base = new Connection(BASE_RPC, "confirmed");

const recipientToken = await walletToken(recipient);
const payerToken = await walletToken(payer);
const payerBaseBefore = await baseTokenBalance(base, payer.publicKey, mint);
const recipientBaseBefore = await baseTokenBalance(base, recipient.publicKey, mint);
const recipientPrivateBefore = BigInt((await readRecipientBalance({
  owner: recipient.publicKey.toBase58(), mint: mint.toBase58(), teeToken: recipientToken,
})).balanceMicro);
assert.ok(payerBaseBefore >= BigInt(amountMicro), "payer does not have enough base tokens");

await assert.rejects(() => readRecipientBalance({
  owner: recipient.publicKey.toBase58(), mint: mint.toBase58(), teeToken: payerToken,
}), /unavailable|identity|mismatch|forbidden|denied|another wallet/i);

const built = await buildPrivateTransfer(payer.publicKey, recipient.publicKey, mint, amountMicro);
const signature = await signAndSubmit(built, payer, base);
const recipientPrivateAfter = await waitForPrivateBalance(
  recipient.publicKey, mint, recipientToken, recipientPrivateBefore + BigInt(amountMicro),
);
const payerBaseAfter = await baseTokenBalance(base, payer.publicKey, mint);
const recipientBaseAfter = await baseTokenBalance(base, recipient.publicKey, mint);

assert.ok(payerBaseAfter < payerBaseBefore, "payer base balance did not decrease");
assert.ok(payerBaseBefore - payerBaseAfter >= BigInt(amountMicro), "payer base debit is smaller than the transfer");
assert.equal(recipientBaseAfter, recipientBaseBefore, "recipient public balance changed during a private credit");
assert.ok(recipientPrivateAfter - recipientPrivateBefore >= BigInt(amountMicro),
  "recipient ephemeral balance did not receive the transfer");

await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify({
  result: "PASS",
  payer: payer.publicKey.toBase58(),
  recipient: recipient.publicKey.toBase58(),
  mint: mint.toBase58(),
  amountMicro,
  signature,
  explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  payerBaseBefore: payerBaseBefore.toString(),
  payerBaseAfter: payerBaseAfter.toString(),
  recipientPublicBefore: recipientBaseBefore.toString(),
  recipientPublicAfter: recipientBaseAfter.toString(),
  recipientPrivateBefore: recipientPrivateBefore.toString(),
  recipientPrivateAfter: recipientPrivateAfter.toString(),
  outsiderTokenDenied: true,
}, null, 2) + "\n", (error) => error ? reject(error) : resolve()));
// confirmTransaction opens a WebSocket subscription in web3.js 1.x. The
// proof is fully observed above; exit explicitly so the one-shot check does
// not wait for that keep-alive socket.
process.exit(0);
