import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEVNET_USDC, canonicalTokenAccount, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, buildOperation, readPaymentRequest } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const FINANCE = "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL";
const GRANT = "FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP";
function load(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = load("MERCURY_FOUNDER_KEYPAIR");
const finance = load("MERCURY_FINANCE_KEYPAIR");
const outsider = load("MERCURY_OUTSIDER_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
assert.equal(finance.publicKey.toBase58(), FINANCE);
const tokenFor = async (key: Keypair) => (await getAuthToken(TEE_RPC, key.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, key.secretKey))).token;
const [founderToken, financeToken] = await Promise.all([tokenFor(founder), tokenFor(finance)]);

async function send(operation: string, signer: Keypair, token: string, fields: Record<string, unknown>, fail = false): Promise<string> {
  const built = await buildOperation({ operation, actor: signer.publicKey.toBase58(), ...fields }, {
    company: COMPANY, founder: FOUNDER, teeToken: token,
  });
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  transaction.sign(signer);
  const endpoint = new URL(built.sendTo === "base" ? BASE_RPC : TEE_RPC);
  if (built.sendTo === "ephemeral") endpoint.searchParams.set("token", token);
  const connection = new Connection(endpoint.toString(), "confirmed");
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: built.sendTo === "ephemeral", maxRetries: 3,
    });
  } catch (error) {
    if (fail) return `preflight-rejected:${operation}`;
    throw error;
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) {
      if (fail) return signature;
      throw new Error(`${operation} ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      assert.equal(fail, false, `${operation} unexpectedly succeeded`);
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

async function newRequest(recipient: string, amountMicro: number): Promise<string> {
  const id = String(Date.now() + Math.floor(Math.random() * 1000));
  const request = PublicKey.findProgramAddressSync([
    Buffer.from("payment-request"), new PublicKey(COMPANY).toBuffer(), founder.publicKey.toBuffer(),
    new BN(id).toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID)[0].toBase58();
  await send("createRequestShell", founder, founderToken, { requestId: id });
  await send("delegateRequest", founder, founderToken, { requestId: id });
  await send("initRequestPermission", founder, founderToken, { request });
  await send("activateRequestPrivacy", founder, founderToken, { request });
  await send("submitPayment", founder, founderToken, { request, recipient, amountMicro });
  return request;
}

const offList = await newRequest(outsider.publicKey.toBase58(), 1);
const offListRejection = await send("approvePayment", finance, financeToken, { request: offList, grant: GRANT }, true);
assert.equal((await readPaymentRequest(COMPANY, offList, founderToken)).status, "submitted");
await send("rejectPayment", founder, founderToken, { request: offList });

const overCap = await newRequest(FINANCE, 11);
await send("approvePayment", founder, founderToken, { request: overCap });
const before = (await readRecipientBalance({ owner: FINANCE, mint: DEVNET_USDC, teeToken: financeToken })).balanceMicro;
const overCapRejection = await send("executePayment", finance, financeToken, {
  request: overCap, grant: GRANT,
  treasuryToken: canonicalTokenAccount(COMPANY, DEVNET_USDC),
  recipientToken: canonicalTokenAccount(FINANCE, DEVNET_USDC),
}, true);
assert.equal((await readPaymentRequest(COMPANY, overCap, founderToken)).status, "approved");
const after = (await readRecipientBalance({ owner: FINANCE, mint: DEVNET_USDC, teeToken: financeToken })).balanceMicro;
assert.equal(after, before, "recipient balance changed after a rejected over-cap transfer");
await send("rejectPayment", founder, founderToken, { request: overCap });
process.stdout.write(JSON.stringify({ result: "PASS", offList, offListRejection,
  overCap, overCapRejection, recipientBalanceMicro: after }, null, 2) + "\n");
