import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { delegationStatus } from "../src/magicblock.ts";
import { inspectMemberGrant } from "../src/member-onboarding.ts";
import { scanMemberReaderCleanup } from "../src/member-cleanup.ts";
import { confirmOnboardingReceipt, recordOnboardingBuild } from "../src/onboarding-journal.ts";
import { BASE_RPC, TEE_RPC, buildOperation, paymentRequestAddress,
  readCompanyPolicy, readPaymentRequest, readTeamGrant } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const BRANCH = 17;
function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = key("MERCURY_FOUNDER_KEYPAIR");
const finance = key("MERCURY_FINANCE_KEYPAIR");
const member = key("MERCURY_MEMBER_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
assert.notEqual(member.publicKey.toBase58(), FOUNDER);
const memberAddress = member.publicKey.toBase58();
const auth = async (signer: Keypair) => (await getAuthToken(TEE_RPC, signer.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, signer.secretKey))).token;
const [founderToken, memberToken] = await Promise.all([auth(founder), auth(member)]);
const financeToken = await auth(finance);
const tee = (token: string) => {
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", token);
  return new Connection(endpoint.toString(), "confirmed");
};

async function submit(operation: string, signer: Keypair, fields: Record<string, unknown>,
  expectFailure = false): Promise<string> {
  const token = signer.publicKey.equals(founder.publicKey) ? founderToken : memberToken;
  const built = await buildOperation({ operation, actor: signer.publicKey.toBase58(), ...fields },
    { company: COMPANY, founder: FOUNDER, teeToken: token });
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  const receipt = recordOnboardingBuild({ company: COMPANY,
    target: String(fields.grant ?? fields.request ?? COMPANY), operation,
    chain: built.sendTo, transactionBase64: built.transactionBase64 });
  tx.sign(signer);
  const connection = built.sendTo === "base" ? new Connection(BASE_RPC, "confirmed") : tee(token);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: built.sendTo === "ephemeral", maxRetries: 3,
    });
  } catch (error) {
    if (expectFailure) return `rejected: ${String(error).slice(0, 80)}`;
    throw error;
  }
  for (let attempt = 0; attempt < 35; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) {
      if (expectFailure) return signature;
      throw new Error(`${operation} failed: ${JSON.stringify(status.err)} (${signature})`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (expectFailure) throw new Error(`${operation} unexpectedly succeeded`);
      const confirmed = await confirmOnboardingReceipt(receipt.id, tx.serialize().toString("base64"), token);
      if (confirmed.status !== "confirmed") throw new Error(`${operation} receipt was not confirmed`);
      process.stdout.write(`${operation}: ${signature}\n`);
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

async function waitForTee(address: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const route = await delegationStatus({ account: address });
    if (route.isDelegated === true && await tee(founderToken).getAccountInfo(new PublicKey(address))) return;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`Delegation not visible: ${address}`);
}

async function createMemberGrant(role: "requester" | "viewer", branchId: number | null): Promise<string> {
  const grantId = String(Date.now() + (role === "viewer" ? 1 : 0));
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await inspectMemberGrant({ company: COMPANY, founder: FOUNDER,
      member: memberAddress, role, grantId, branchId, teeToken: founderToken });
    if (result.next.status === "ready") {
      assert.equal((await readTeamGrant(COMPANY, result.grantAddress, memberToken)).role,
        role === "requester" ? 3 : 4);
      return result.grantAddress;
    }
    if (result.next.status === "wait") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    await submit(result.next.operation!, founder, { member: memberAddress, grantId,
      grant: result.grantAddress, role, scope: result.scopeAddress,
      recipients: [], mayDelegate: false });
  }
  throw new Error(`${role} grant did not become active`);
}

assert.equal((await readCompanyPolicy(COMPANY, founderToken)).founder, FOUNDER);
const requesterGrant = await createMemberGrant("requester", BRANCH);
const requestId = String((BigInt(BRANCH) << 40n) | (BigInt(Date.now()) & ((1n << 40n) - 1n)));
const request = paymentRequestAddress(new PublicKey(COMPANY), member.publicKey, new BN(requestId)).toBase58();
await submit("createRequestShell", member, { requestId });
await submit("delegateRequest", member, { requestId });
await waitForTee(request);
await submit("initRequestPermission", member, { request });
await submit("activateRequestPrivacy", founder, { request, requesterGrant, includeFinance: false });
assert.equal((await readPaymentRequest(COMPANY, request, memberToken)).status, "empty");
await submit("revokeGrant", founder, { grant: requesterGrant });
assert.equal((await readCompanyPolicy(COMPANY, financeToken)).finance, finance.publicKey.toBase58());
const rejectedSubmit = await submit("submitPayment", member, {
  request, requesterGrant, recipient: founder.publicKey.toBase58(), amountMicro: 1,
}, true);
assert.equal((await readPaymentRequest(COMPANY, request, founderToken)).status, "empty");
const requesterScan = await scanMemberReaderCleanup({ company: COMPANY, founder: FOUNDER,
  grant: requesterGrant, teeToken: founderToken });
assert.ok(requesterScan.targets.includes(request));
await submit("setRequestReadersV2", founder, { request, includeRequester: false, includeFinance: false });
await assert.rejects(readPaymentRequest(COMPANY, request, memberToken));

const viewerGrant = await createMemberGrant("viewer", BRANCH);
await submit("setRequestReadersV2", founder, { request, includeRequester: false,
  includeFinance: false, viewer: memberAddress, viewerGrant });
assert.equal((await readPaymentRequest(COMPANY, request, memberToken)).status, "empty");
await submit("revokeGrant", founder, { grant: viewerGrant });
assert.equal((await readCompanyPolicy(COMPANY, financeToken)).finance, finance.publicKey.toBase58());
const viewerScan = await scanMemberReaderCleanup({ company: COMPANY, founder: FOUNDER,
  grant: viewerGrant, teeToken: founderToken });
assert.ok(viewerScan.targets.includes(request));
await submit("setRequestReadersV2", founder, { request, includeRequester: false, includeFinance: false });
await assert.rejects(readPaymentRequest(COMPANY, request, memberToken));
process.stdout.write(JSON.stringify({ result: "PASS", company: COMPANY, request,
  requesterGrant, viewerGrant, rejectedSubmit, requesterScanTargets: requesterScan.targets.length,
  viewerScanTargets: viewerScan.targets.length, memberReadAfterCleanup: "denied",
  financePolicyReadAfterMemberRevocation: "allowed" }) + "\n");
