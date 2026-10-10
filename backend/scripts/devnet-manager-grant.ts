import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEVNET_USDC, canonicalTokenAccount } from "../src/magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, branchScopeAddress, buildOperation, readCompanyPolicy,
  readPaymentRequest, readTeamGrant, teamGrantAddress } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const FINANCE = "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL";
const PARENT_GRANT = "FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP";
const BRANCH_ID = 17;

function loadKey(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = loadKey("MERCURY_FOUNDER_KEYPAIR");
const finance = loadKey("MERCURY_FINANCE_KEYPAIR");
const manager = loadKey("MERCURY_MANAGER_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
assert.equal(finance.publicKey.toBase58(), FINANCE);
assert.notEqual(manager.publicKey.toBase58(), FOUNDER);
assert.notEqual(manager.publicKey.toBase58(), FINANCE);
const tokens = new Map<string, string>();
for (const signer of [founder, finance, manager]) {
  tokens.set(signer.publicKey.toBase58(), (await getAuthToken(TEE_RPC, signer.publicKey,
    async (message: Uint8Array) => nacl.sign.detached(message, signer.secretKey))).token);
}

async function submit(operation: string, signer: Keypair, fields: Record<string, unknown>, expectError = false): Promise<string> {
  const actor = signer.publicKey.toBase58();
  const token = tokens.get(actor)!;
  const built = await buildOperation({ operation, actor, ...fields }, {
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
    if (expectError) return `rejected-before-submission:${operation}`;
    throw error;
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) {
      if (expectError) return signature;
      throw new Error(`${operation} failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      assert.equal(expectError, false, `${operation} unexpectedly succeeded`);
      process.stdout.write(`${operation}: ${signature}\n`);
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

assert.equal((await readCompanyPolicy(COMPANY, tokens.get(FOUNDER)!)).mint, DEVNET_USDC);
assert.equal((await readTeamGrant(COMPANY, PARENT_GRANT, tokens.get(FINANCE)!)).active, true);
const grantId = String(Date.now());
const managerAddress = manager.publicKey.toBase58();
const childGrant = teamGrantAddress(new PublicKey(COMPANY), finance.publicKey, manager.publicKey, new BN(grantId)).toBase58();
await submit("createGrantShell", finance, { member: managerAddress, grantId });
await submit("delegateGrant", finance, { member: managerAddress, grantId });
await submit("initGrantPermission", finance, { grant: childGrant });
await submit("activateChildGrantPrivacy", finance, { grant: childGrant, parentGrant: PARENT_GRANT });
await submit("configureGrant", finance, {
  grant: childGrant, parentGrant: PARENT_GRANT, role: "manager",
  scope: branchScopeAddress(new PublicKey(COMPANY), BRANCH_ID).toBase58(),
  perPaymentCapMicro: 2, periodCapMicro: 5, recipients: [FINANCE], mayDelegate: false,
});
assert.equal((await readTeamGrant(COMPANY, childGrant, tokens.get(managerAddress)!)).active, true);

const requestId = String((BigInt(BRANCH_ID) << 40n) | (BigInt(Date.now() + 1) & ((1n << 40n) - 1n)));
const request = PublicKey.findProgramAddressSync([
  Buffer.from("payment-request"), new PublicKey(COMPANY).toBuffer(), founder.publicKey.toBuffer(),
  new BN(requestId).toArrayLike(Buffer, "le", 8),
], PROGRAM_ID)[0].toBase58();
await submit("createRequestShell", founder, { requestId });
await submit("delegateRequest", founder, { requestId });
await submit("initRequestPermission", founder, { request });
await submit("activateRequestPrivacy", founder, { request, manager: managerAddress });
await submit("submitPayment", founder, { request, recipient: FINANCE, amountMicro: 1 });
assert.equal((await readPaymentRequest(COMPANY, request, tokens.get(managerAddress)!)).status, "submitted");
await submit("approvePayment", manager, { request, grant: childGrant, parentGrant: PARENT_GRANT });
const tokensForPayment = {
  treasuryToken: canonicalTokenAccount(COMPANY, DEVNET_USDC),
  recipientToken: canonicalTokenAccount(FINANCE, DEVNET_USDC),
};
const denied = await submit("executePayment", manager, { request, grant: childGrant, ...tokensForPayment }, true);
assert.equal((await readPaymentRequest(COMPANY, request, tokens.get(FOUNDER)!)).status, "approved");
await submit("executePayment", finance, { request, grant: PARENT_GRANT, ...tokensForPayment });
assert.equal((await readPaymentRequest(COMPANY, request, tokens.get(FOUNDER)!)).status, "executed");
process.stdout.write(JSON.stringify({ result: "PASS", childGrant, request, managerExecutionRejected: denied }, null, 2) + "\n");
