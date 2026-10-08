import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, canonicalTokenAccount } from "../src/magicblock.ts";
import {
  BASE_RPC, TEE_RPC, buildOperation, paymentExecutionAccounts, readCompanyPolicy,
  readPaymentRequest, readTeamGrant, teamGrantAddress,
} from "../src/operations.ts";
import { BN } from "@coral-xyz/anchor";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const PROGRAM = new PublicKey("34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L");
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const FINANCE = "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL";

function loadKey(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

const founder = loadKey("MERCURY_FOUNDER_KEYPAIR");
const finance = loadKey("MERCURY_FINANCE_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
assert.equal(finance.publicKey.toBase58(), FINANCE);
const auth = new Map<string, string>();
for (const signer of [founder, finance]) {
  const token = await getAuthToken(TEE_RPC, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey));
  auth.set(signer.publicKey.toBase58(), token.token);
}

async function run(operation: string, signer: Keypair, fields: Record<string, unknown>): Promise<string> {
  const actor = signer.publicKey.toBase58();
  const token = auth.get(actor);
  const built = await buildOperation({ operation, actor, ...fields }, {
    company: COMPANY, founder: FOUNDER, teeToken: token,
  });
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  transaction.sign(signer);
  const endpoint = new URL(built.sendTo === "base" ? BASE_RPC : TEE_RPC);
  if (built.sendTo === "ephemeral") endpoint.searchParams.set("token", token!);
  const connection = new Connection(endpoint.toString(), "confirmed");
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: built.sendTo === "ephemeral", maxRetries: 3,
  });
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`${operation} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      process.stdout.write(`${operation}: ${signature}\n`);
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

const founderToken = auth.get(FOUNDER)!;
const financeToken = auth.get(FINANCE)!;
const company = await readCompanyPolicy(COMPANY, founderToken);
assert.equal(company.founder, FOUNDER);
assert.equal(company.finance, FINANCE);
assert.equal(company.mint, DEVNET_USDC);
assert.ok(BigInt(String(company.monthlyLimitMicro)) >= 100n);

async function createRequest(id: string): Promise<string> {
  const request = PublicKey.findProgramAddressSync([
    Buffer.from("payment-request"), new PublicKey(COMPANY).toBuffer(), founder.publicKey.toBuffer(),
    new BN(id).toArrayLike(Buffer, "le", 8),
  ], PROGRAM)[0].toBase58();
  await run("createRequestShell", founder, { requestId: id });
  await run("delegateRequest", founder, { requestId: id });
  await run("initRequestPermission", founder, { request });
  await run("activateRequestPrivacy", founder, { request });
  await run("submitPayment", founder, { request, recipient: FINANCE, amountMicro: 1 });
  return request;
}

async function execute(request: string, signer: Keypair, grant?: string): Promise<void> {
  const token = auth.get(signer.publicKey.toBase58())!;
  const [policy, payment] = await Promise.all([
    readCompanyPolicy(COMPANY, token), readPaymentRequest(COMPANY, request, token),
  ]);
  const accounts = paymentExecutionAccounts(COMPANY, signer.publicKey.toBase58(), policy, payment);
  await run("executePayment", signer, {
    request, grant, treasuryToken: accounts.treasuryToken, recipientToken: accounts.recipientToken,
  });
  assert.equal((await readPaymentRequest(COMPANY, request, token)).status, "executed");
}

const firstRequest = await createRequest(String(Date.now()));
await run("approvePayment", founder, { request: firstRequest });
await execute(firstRequest, founder);

const grantId = String(Date.now() + 1);
const grant = teamGrantAddress(new PublicKey(COMPANY), founder.publicKey, finance.publicKey, new BN(grantId)).toBase58();
await run("createGrantShell", founder, { member: FINANCE, grantId });
await run("delegateGrant", founder, { member: FINANCE, grantId });
await run("initGrantPermission", founder, { grant });
await run("activateRootGrantPrivacy", founder, { grant });
await run("configureGrant", founder, {
  grant, role: "finance", perPaymentCapMicro: 10, periodCapMicro: 100,
  recipients: [FINANCE], mayDelegate: true,
});
assert.equal((await readTeamGrant(COMPANY, grant, financeToken)).active, true);

const secondRequest = await createRequest(String(Date.now() + 2));
await run("approvePayment", finance, { request: secondRequest, grant });
await execute(secondRequest, finance, grant);
assert.equal((await readTeamGrant(COMPANY, grant, financeToken)).spentMicro, "1");
process.stdout.write(JSON.stringify({ result: "PASS", firstRequest, secondRequest, grant,
  recipientToken: canonicalTokenAccount(FINANCE, DEVNET_USDC) }, null, 2) + "\n");
