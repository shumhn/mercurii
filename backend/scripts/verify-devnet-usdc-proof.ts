import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, readCompanyPolicy, readPaymentRequest, readTreasurySnapshot } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const REQUEST = "Ao1hZcbqkM5DFfEHi48SVAk6zq1nYjyEbgFENPvdYDzK";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function token(signer: Keypair): Promise<string> {
  const auth = await getAuthToken(TEE_RPC, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey));
  return auth.token;
}

const finance = key("MERCURY_FINANCE_KEYPAIR");
const outsider = key("MERCURY_OUTSIDER_KEYPAIR");
const financeToken = await token(finance);
const outsiderToken = await token(outsider);
const [policy, request, snapshot, recipient] = await Promise.all([
  readCompanyPolicy(COMPANY, financeToken),
  readPaymentRequest(COMPANY, REQUEST, financeToken),
  readTreasurySnapshot(COMPANY, financeToken),
  readRecipientBalance({ owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: financeToken }),
]);
assert.equal(policy.mint, DEVNET_USDC);
assert.equal(request.status, "executed");
assert.equal(request.amountMicro, "10000");
assert.equal(snapshot.balanceMicro, "40000");
assert.equal(recipient.balanceMicro, "10000");
const base = new Connection(BASE_RPC, "confirmed");
const ata = PublicKey.findProgramAddressSync([
  finance.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(DEVNET_USDC).toBuffer(),
], ATA_PROGRAM)[0];
const baseAccount = await base.getAccountInfo(ata);
assert.ok(baseAccount && baseAccount.data.length >= 72);
assert.equal(baseAccount.data.readBigUInt64LE(64).toString(), "1000");
await assert.rejects(() => readCompanyPolicy(COMPANY, outsiderToken));
await assert.rejects(() => readPaymentRequest(COMPANY, REQUEST, outsiderToken));
await assert.rejects(() => readTreasurySnapshot(COMPANY, outsiderToken));
await assert.rejects(() => readRecipientBalance({
  owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: outsiderToken,
}));
process.stdout.write(JSON.stringify({
  result: "PASS", mint: DEVNET_USDC, company: COMPANY,
  request: { address: REQUEST, status: request.status, amountMicro: request.amountMicro },
  treasurySnapshotMicro: snapshot.balanceMicro,
  recipientPrivateMicro: recipient.balanceMicro,
  recipientBaseMicro: baseAccount.data.readBigUInt64LE(64).toString(),
  outsiderDenied: true,
}, null, 2) + "\n");
