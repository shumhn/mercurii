import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { BN } from "@coral-xyz/anchor";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { DEVNET_USDC, asAddress } from "../src/magicblock.ts";
import { inspectCompanyOnboarding } from "../src/onboarding.ts";
import { inspectRootFinanceGrant } from "../src/finance-onboarding.ts";
import { confirmOnboardingReceipt, recordOnboardingBuild } from "../src/onboarding-journal.ts";
import { PROGRAM_ID, TEE_RPC, buildOperation, readCompanyPolicy, snapshotAddress } from "../src/operations.ts";

const BASE_SUBMIT_RPC = process.env.MERCURY_BASE_SUBMIT_RPC ?? "https://api.devnet.solana.com";

function positive(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

const keyPath = process.env.MERCURY_FOUNDER_KEYPAIR;
if (!keyPath) throw new Error("MERCURY_FOUNDER_KEYPAIR is required");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const founderAddress = founder.publicKey.toBase58();
const finance = asAddress(process.env.MERCURY_FINANCE_ADDRESS, "MERCURY_FINANCE_ADDRESS");
const company = PublicKey.findProgramAddressSync([
  Buffer.from("company-policy"), founder.publicKey.toBuffer(),
], PROGRAM_ID)[0].toBase58();
const monthlyLimitMicro = positive("MERCURY_MONTHLY_LIMIT_MICRO");
const agentCapMicro = positive("MERCURY_AGENT_CAP_MICRO");
const perPaymentCapMicro = positive("MERCURY_FINANCE_PER_PAYMENT_CAP_MICRO");
const periodCapMicro = positive("MERCURY_FINANCE_PERIOD_CAP_MICRO");
const grantId = process.env.MERCURY_GRANT_ID ?? "1";
new BN(grantId);
const recipients = (process.env.MERCURY_FINANCE_RECIPIENTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (recipients.length === 0) throw new Error("MERCURY_FINANCE_RECIPIENTS needs at least one address");
const mayDelegate = process.env.MERCURY_FINANCE_MAY_DELEGATE === "1";
const token = (await getAuthToken(TEE_RPC, founder.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, founder.secretKey))).token;

async function send(operation: string, fields: Record<string, unknown>): Promise<void> {
  const built = await buildOperation({ operation, actor: founderAddress, ...fields }, {
    company, founder: founderAddress, teeToken: token,
  });
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  const target = operation.includes("Snapshot") ? snapshotAddress(new PublicKey(company)).toBase58() :
    operation.includes("Grant") ? String(fields.grant) : company;
  const receipt = recordOnboardingBuild({
    company, target, operation, chain: built.sendTo,
    transactionBase64: built.transactionBase64,
  });
  transaction.sign(founder);
  const url = new URL(built.sendTo === "base" ? BASE_SUBMIT_RPC : TEE_RPC);
  if (built.sendTo === "ephemeral") url.searchParams.set("token", token);
  const connection = new Connection(url.toString(), "confirmed");
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: built.sendTo === "ephemeral", maxRetries: 3,
  });
  for (let i = 0; i < 30; i++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`${operation} failed: ${JSON.stringify(status.err)} (${signature})`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      const verified = await confirmOnboardingReceipt(receipt.id,
        transaction.serialize().toString("base64"), token);
      if (verified.status !== "confirmed") throw new Error(`${operation} receipt was not confirmed`);
      process.stdout.write(`${operation}: ${signature}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

let companyReady = false;
for (let i = 0; i < 60; i++) {
  const result = await inspectCompanyOnboarding({
    company, founder: founderAddress, finance, mint: DEVNET_USDC,
    monthlyLimitMicro, agentCapMicro, teeToken: token,
  });
  if (result.next.status === "ready") { companyReady = true; break; }
  if (result.next.status === "wait") {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    continue;
  }
  await send(result.next.operation!, { finance, mint: DEVNET_USDC, monthlyLimitMicro, agentCapMicro });
}
if (!companyReady) throw new Error("Company onboarding did not reach ready state");
const policy = await readCompanyPolicy(company, token);
assert.equal(policy.finance, finance);
assert.equal(policy.mint, DEVNET_USDC);

let grantReady = false;
for (let i = 0; i < 60; i++) {
  const result = await inspectRootFinanceGrant({
    company, founder: founderAddress, finance, grantId,
    perPaymentCapMicro, periodCapMicro, recipients, mayDelegate, teeToken: token,
  });
  if (result.next.status === "ready") {
    grantReady = true;
    process.stdout.write(JSON.stringify({ result: "PASS", company, financeGrant: result.grantAddress }) + "\n");
    break;
  }
  if (result.next.status === "wait") {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    continue;
  }
  await send(result.next.operation!, {
    member: finance, grantId, grant: result.grantAddress, role: "finance",
    perPaymentCapMicro, periodCapMicro, recipients, mayDelegate,
  });
}
if (!grantReady) throw new Error("Finance grant onboarding did not reach ready state");
