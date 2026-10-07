import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { readAgentPolicy, readCompanyPolicy, readPaymentRequest, readTreasurySnapshot } from "../src/operations.ts";

const financePath = process.env.MERCURY_FINANCE_KEYPAIR;
if (!financePath) throw new Error("MERCURY_FINANCE_KEYPAIR is required");
const finance = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(financePath, "utf8"))));
const auth = await getAuthToken("https://devnet-tee.magicblock.app", finance.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, finance.secretKey));
const url = new URL("https://devnet-tee.magicblock.app");
url.searchParams.set("token", auth.token);
const connection = new Connection(url.toString(), "confirmed");
const program = new anchor.Program(
  JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl,
  new anchor.AnchorProvider(connection, new anchor.Wallet(finance), { commitment: "confirmed" }),
);

const company = new PublicKey("EpyTeGaoxTJ6Anm1SxHFfyTkYaPdNDPHdgUvvGYXJzDB");
const request = new PublicKey("58DSegaDoCENZLVnmUp5VjNA9pzZDysoNKtDVCZ33T9F");
const agentPolicy = new PublicKey("BZEZKfWWGk1nLRWHCYLBgHTQiaHCQjkn6s8hgsP278nH");
const recipientToken = new PublicKey("HkDPVU5zZdFkauhCTUHw9inMV9BBjYJ2q2LL4FmsukVv");
const base = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
const snapshot = PublicKey.findProgramAddressSync([Buffer.from("treasury-snapshot"), company.toBuffer()], program.programId)[0];

const [policyState, requestState, agentState, snapshotState, recipientAccount, baseRecipientAccount] = await Promise.all([
  (program.account as any).companyPolicy.fetch(company),
  (program.account as any).paymentRequest.fetch(request),
  (program.account as any).agentPolicy.fetch(agentPolicy),
  (program.account as any).treasurySnapshot.fetch(snapshot),
  connection.getAccountInfo(recipientToken),
  base.getAccountInfo(recipientToken),
]);
assert.ok(recipientAccount, "recipient token account unavailable");
assert.ok(baseRecipientAccount, "base recipient token account unavailable");
assert.equal(policyState.mint.toBase58(), "BHTANWG8igML3nxnHLcokhhzYt999W5LWjrtECFpNiv");
assert.equal(policyState.spentMicro.toString(), "1500000");
assert.equal(policyState.reservedMicro.toString(), "0");
assert.equal(requestState.status, 3);
assert.equal(requestState.amountMicro.toString(), "1000000");
assert.equal(agentState.spentMicro.toString(), "250000");
assert.equal(agentState.revoked, true);
assert.equal(recipientAccount.data.readBigUInt64LE(64).toString(), "2249999");
assert.equal(baseRecipientAccount.data.readBigUInt64LE(64).toString(), "1");
assert.equal(snapshotState.company.toBase58(), company.toBase58());
assert.equal(snapshotState.privateReady, true);
assert.equal(snapshotState.balanceMicro.toString(), "750001");
assert.ok(snapshotState.updatedSlot.toNumber() > 0);
const [policyView, requestView, agentView, treasuryView] = await Promise.all([
  readCompanyPolicy(company.toBase58(), auth.token),
  readPaymentRequest(company.toBase58(), request.toBase58(), auth.token),
  readAgentPolicy(company.toBase58(), agentPolicy.toBase58(), auth.token),
  readTreasurySnapshot(company.toBase58(), auth.token),
]);
assert.equal(policyView.spentMicro, "1500000");
assert.equal(requestView.status, "executed");
assert.equal(agentView.revoked, true);
assert.equal(treasuryView.balanceMicro, "750001");
process.stdout.write(JSON.stringify({
  result: "PASS",
  mint: policyState.mint.toBase58(),
  company: company.toBase58(),
  request: { status: "executed", amountMicro: requestState.amountMicro.toString() },
  companyBudget: { spentMicro: policyState.spentMicro.toString(), reservedMicro: policyState.reservedMicro.toString() },
  agent: { revoked: true, spentMicro: agentState.spentMicro.toString() },
  recipientPrivateBalanceMicro: recipientAccount.data.readBigUInt64LE(64).toString(),
  recipientBaseBalanceMicro: baseRecipientAccount.data.readBigUInt64LE(64).toString(),
  treasurySnapshot: { balanceMicro: snapshotState.balanceMicro.toString(), updatedSlot: snapshotState.updatedSlot.toString() },
}, null, 2) + "\n");
