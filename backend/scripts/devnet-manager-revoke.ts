import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { TEE_RPC, buildOperation, readPaymentRequest, readTeamGrant } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const PARENT = "FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP";
const CHILD = "BTNm45qUUPb83MxXa376wDQkgEro2AZ4W659Scf8CQaD";
const HISTORICAL_REQUEST = "CrfJQ5MCJRAcPA87s1txH3UxqHJTZc2icKPSWfNkPfCk";

function load(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = load("MERCURY_FOUNDER_KEYPAIR");
const finance = load("MERCURY_FINANCE_KEYPAIR");
const manager = load("MERCURY_MANAGER_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
const tokenFor = async (key: Keypair) => (await getAuthToken(TEE_RPC, key.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, key.secretKey))).token;
const [founderToken, financeToken, managerToken] = await Promise.all([
  tokenFor(founder), tokenFor(finance), tokenFor(manager),
]);
assert.equal((await readTeamGrant(COMPANY, CHILD, founderToken)).active, true);
const built = await buildOperation({ operation: "revokeGrant", actor: finance.publicKey.toBase58(),
  grant: CHILD, parentGrant: PARENT }, { company: COMPANY, founder: FOUNDER, teeToken: financeToken });
const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
transaction.sign(finance);
const endpoint = new URL(TEE_RPC);
endpoint.searchParams.set("token", financeToken);
const connection = new Connection(endpoint.toString(), "confirmed");
const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
let confirmed = false;
for (let attempt = 0; attempt < 24; attempt++) {
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error(`revokeGrant failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    confirmed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}
assert.equal(confirmed, true);
const revoked = await readTeamGrant(COMPANY, CHILD, founderToken);
assert.equal(revoked.active, false);
assert.equal(revoked.revoked, true);
await assert.rejects(readTeamGrant(COMPANY, CHILD, managerToken));
const parent = await readTeamGrant(COMPANY, PARENT, financeToken);
assert.ok(Array.isArray(parent.childReaders) && !parent.childReaders.includes(manager.publicKey.toBase58()));
let historicalRequestStillReadable = false;
try {
  await readPaymentRequest(COMPANY, HISTORICAL_REQUEST, managerToken);
  historicalRequestStillReadable = true;
} catch { /* request ACL may already have been cleaned up */ }
process.stdout.write(JSON.stringify({ result: "PASS", signature, childGrant: CHILD,
  historicalRequestStillReadable }, null, 2) + "\n");
