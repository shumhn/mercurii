import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, canonicalTokenAccount, preparePrivateReceive, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR, buildOperation, readAgentPolicy, readCompanyPolicy, readTreasurySnapshot } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const AGENT_POLICY = "4f7HoaF7dkMJ7FcQY428nEbxU7s4854qSWnL7rbZ9qyb";
const BOOTSTRAP_MICRO = 1;
const FUND_MICRO = 5_000;
const PAY_MICRO = 1_000;

function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function auth(signer: Keypair): Promise<string> {
  const result = await getAuthToken(TEE_RPC, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey));
  return result.token;
}

function teeConnection(token: string): Connection {
  const url = new URL(TEE_RPC);
  url.searchParams.set("token", token);
  return new Connection(url.toString(), "confirmed");
}

async function sendUnsigned(transactionBase64: string, signer: Keypair, connection: Connection): Promise<string> {
  const bytes = Buffer.from(transactionBase64, "base64");
  let signed: Buffer;
  try {
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([signer]);
    signed = Buffer.from(tx.serialize());
  } catch {
    const tx = Transaction.from(bytes);
    tx.sign(signer);
    signed = Buffer.from(tx.serialize());
  }
  const signature = await connection.sendRawTransaction(signed, { skipPreflight: false });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error(`Devnet transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}

function expectedMicro(name: string, actual: bigint): void {
  const text = process.env[name];
  if (!text || !/^\d+$/.test(text)) throw new Error(`${name} must be the exact expected pre-transaction balance`);
  assert.equal(actual, BigInt(text), `${name} does not match current chain state`);
}

const step = process.env.MERCURY_AGENT_PROOF_STEP;
if (!["bootstrap", "fund", "pay", "verify"].includes(step ?? "")) {
  throw new Error("MERCURY_AGENT_PROOF_STEP must be bootstrap, fund, pay, or verify");
}
const finance = key("MERCURY_FINANCE_KEYPAIR");
const agent = key("MERCURY_AGENT_KEYPAIR");
const financeToken = await auth(finance);
const agentToken = await auth(agent);
const [company, agentPolicy] = await Promise.all([
  readCompanyPolicy(COMPANY, financeToken), readAgentPolicy(COMPANY, AGENT_POLICY, agentToken),
]);
assert.equal(company.mint, DEVNET_USDC);
assert.equal(company.finance, finance.publicKey.toBase58());
assert.equal(agentPolicy.mint, DEVNET_USDC);
assert.equal(agentPolicy.agent, agent.publicKey.toBase58());
assert.equal(agentPolicy.allowedRecipient, finance.publicKey.toBase58());
assert.equal(agentPolicy.revoked, false);
const agentFloatToken = canonicalTokenAccount(AGENT_POLICY, DEVNET_USDC);
const treasuryToken = canonicalTokenAccount(COMPANY, DEVNET_USDC);
const recipientToken = canonicalTokenAccount(finance.publicKey.toBase58(), DEVNET_USDC);
const base = new Connection(process.env.MERCURY_BASE_RPC ?? BASE_RPC, "confirmed");

if (step === "bootstrap") {
  assert.equal(process.env.MERCURY_CONFIRM_AGENT_BOOTSTRAP, "1", "Set MERCURY_CONFIRM_AGENT_BOOTSTRAP=1 for this devnet transfer");
  const source = await base.getAccountInfo(new PublicKey(recipientToken));
  assert.ok(source && source.data.length >= 72 && source.data.readBigUInt64LE(64) >= BigInt(BOOTSTRAP_MICRO),
    "Finance base wallet lacks one devnet USDC microtoken");
  expectedMicro("MERCURY_EXPECT_FINANCE_BASE_MICRO", source.data.readBigUInt64LE(64));
  const built = await preparePrivateReceive({
    payer: finance.publicKey.toBase58(), company: AGENT_POLICY, amountMicro: BOOTSTRAP_MICRO,
    expectedValidator: TEE_VALIDATOR.toBase58(),
  });
  assert.equal(built.sendTo, "base");
  assert.deepEqual(built.requiredSigners, [finance.publicKey.toBase58()]);
  const signature = await sendUnsigned(built.transactionBase64, finance, base);
  process.stdout.write(JSON.stringify({ status: "bootstrap_submitted", signature, agentFloatToken,
    note: "Run the fund step only after the agent float token account is available on the selected PER" }) + "\n");
} else if (step === "fund") {
  assert.equal(process.env.MERCURY_CONFIRM_AGENT_FUND, "1", "Set MERCURY_CONFIRM_AGENT_FUND=1 for this devnet transfer");
  const founder = key("MERCURY_FOUNDER_KEYPAIR");
  assert.equal(founder.publicKey.toBase58(), company.founder);
  const founderToken = await auth(founder);
  const before = BigInt(String(company.spentMicro));
  expectedMicro("MERCURY_EXPECT_COMPANY_SPENT_MICRO", before);
  const built = await buildOperation({
    operation: "fundAgentFloat", actor: founder.publicKey.toBase58(), agentPolicy: AGENT_POLICY,
    amountMicro: FUND_MICRO, treasuryToken, agentFloatToken,
  }, { company: COMPANY, founder: String(company.founder), teeToken: founderToken });
  assert.equal(built.sendTo, "ephemeral");
  const signature = await sendUnsigned(built.transactionBase64, founder, teeConnection(founderToken));
  const after = await readCompanyPolicy(COMPANY, founderToken);
  assert.equal(BigInt(String(after.spentMicro)), before + BigInt(FUND_MICRO));
  process.stdout.write(JSON.stringify({ result: "PASS", action: "fund_agent_float", signature,
    amountMicro: FUND_MICRO, companySpentBeforeMicro: before.toString(),
    companySpentAfterMicro: String(after.spentMicro) }) + "\n");
} else if (step === "pay") {
  assert.equal(process.env.MERCURY_CONFIRM_AGENT_PAY, "1", "Set MERCURY_CONFIRM_AGENT_PAY=1 for this devnet transfer");
  const beforePolicy = BigInt(String(agentPolicy.spentMicro));
  expectedMicro("MERCURY_EXPECT_AGENT_SPENT_MICRO", beforePolicy);
  const beforeRecipient = BigInt((await readRecipientBalance({
    owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: financeToken,
  })).balanceMicro);
  const built = await buildOperation({
    operation: "agentPay", actor: agent.publicKey.toBase58(), agentPolicy: AGENT_POLICY,
    amountMicro: PAY_MICRO, agentFloatToken, recipientToken,
  }, { company: COMPANY, founder: String(company.founder), teeToken: agentToken });
  assert.equal(built.sendTo, "ephemeral");
  const signature = await sendUnsigned(built.transactionBase64, agent, teeConnection(agentToken));
  const afterPolicy = await readAgentPolicy(COMPANY, AGENT_POLICY, agentToken);
  const afterRecipient = BigInt((await readRecipientBalance({
    owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: financeToken,
  })).balanceMicro);
  assert.equal(BigInt(String(afterPolicy.spentMicro)), beforePolicy + BigInt(PAY_MICRO));
  assert.equal(afterRecipient, beforeRecipient + BigInt(PAY_MICRO));
  process.stdout.write(JSON.stringify({ result: "PASS", action: "agent_pay", signature,
    amountMicro: PAY_MICRO, recipientBeforeMicro: beforeRecipient.toString(),
    recipientAfterMicro: afterRecipient.toString() }) + "\n");
} else {
  const outsider = key("MERCURY_OUTSIDER_KEYPAIR");
  const outsiderToken = await auth(outsider);
  const [recipient, snapshot, baseRecipient] = await Promise.all([
    readRecipientBalance({ owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: financeToken }),
    readTreasurySnapshot(COMPANY, financeToken),
    base.getAccountInfo(new PublicKey(recipientToken)),
  ]);
  assert.equal(String(company.spentMicro), process.env.MERCURY_EXPECT_COMPANY_SPENT_MICRO ?? "15000");
  assert.equal(String(agentPolicy.spentMicro), process.env.MERCURY_EXPECT_AGENT_SPENT_MICRO ?? "1000");
  assert.equal(snapshot.balanceMicro, process.env.MERCURY_EXPECT_TREASURY_MICRO ?? "35000");
  assert.equal(recipient.balanceMicro, process.env.MERCURY_EXPECT_RECIPIENT_PRIVATE_MICRO ?? "11000");
  assert.ok(baseRecipient && baseRecipient.data.length >= 72);
  assert.equal(baseRecipient.data.readBigUInt64LE(64).toString(), process.env.MERCURY_EXPECT_RECIPIENT_BASE_MICRO ?? "999");
  await assert.rejects(() => readAgentPolicy(COMPANY, AGENT_POLICY, outsiderToken));
  process.stdout.write(JSON.stringify({ result: "PASS", action: "read_only_verify",
    agentPolicy: AGENT_POLICY, agentSpentMicro: agentPolicy.spentMicro,
    companySpentMicro: company.spentMicro, treasurySnapshotMicro: snapshot.balanceMicro,
    recipientPrivateMicro: recipient.balanceMicro,
    recipientBaseMicro: baseRecipient.data.readBigUInt64LE(64).toString(), outsiderDenied: true,
    agentFloatToken }) + "\n");
}
