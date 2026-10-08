import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, canonicalTokenAccount } from "../src/magicblock.ts";
import { TEE_RPC, buildOperation, readTreasurySnapshot } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const GRANT = "FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP";
const path = process.env.MERCURY_FINANCE_KEYPAIR;
if (!path) throw new Error("MERCURY_FINANCE_KEYPAIR is required");
const finance = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const token = (await getAuthToken(TEE_RPC, finance.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, finance.secretKey))).token;
const endpoint = new URL(TEE_RPC);
endpoint.searchParams.set("token", token);
const connection = new Connection(endpoint.toString(), "confirmed");
const treasuryToken = canonicalTokenAccount(COMPANY, DEVNET_USDC);

async function submit(grant?: string): Promise<{ signature: string; failed: boolean }> {
  const built = await buildOperation({ operation: "syncTreasurySnapshot", actor: finance.publicKey.toBase58(),
    treasuryToken, grant }, { company: COMPANY, founder: FOUNDER, teeToken: token });
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  transaction.sign(finance);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) return { signature, failed: true };
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { signature, failed: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`syncTreasurySnapshot confirmation timed out: ${signature}`);
}
const denied = await submit();
assert.equal(denied.failed, true, "Finance without a grant must be rejected");
const allowed = await submit(GRANT);
assert.equal(allowed.failed, false, "Finance with its active grant must sync the snapshot");
const snapshot = await readTreasurySnapshot(COMPANY, token);
assert.equal(snapshot.mint, DEVNET_USDC);
process.stdout.write(JSON.stringify({ result: "PASS", deniedSignature: denied.signature,
  allowedSignature: allowed.signature, snapshotUpdatedSlot: snapshot.updatedSlot }, null, 2) + "\n");
