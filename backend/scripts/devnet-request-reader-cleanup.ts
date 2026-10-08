import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { TEE_RPC, buildOperation, readPaymentRequest } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const FOUNDER = "3PC5PmujJNELpq85NDVX6gUepUL8JRvZKkHm6sDtHEZX";
const REQUEST = "CrfJQ5MCJRAcPA87s1txH3UxqHJTZc2icKPSWfNkPfCk";
function load(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = load("MERCURY_FOUNDER_KEYPAIR");
const manager = load("MERCURY_MANAGER_KEYPAIR");
assert.equal(founder.publicKey.toBase58(), FOUNDER);
const tokenFor = async (key: Keypair) => (await getAuthToken(TEE_RPC, key.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, key.secretKey))).token;
const [founderToken, managerToken] = await Promise.all([tokenFor(founder), tokenFor(manager)]);
assert.equal((await readPaymentRequest(COMPANY, REQUEST, managerToken)).status, "executed");
const built = await buildOperation({ operation: "setRequestReaders", actor: FOUNDER,
  request: REQUEST, includeFinance: true }, { company: COMPANY, founder: FOUNDER, teeToken: founderToken });
const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
transaction.sign(founder);
const endpoint = new URL(TEE_RPC);
endpoint.searchParams.set("token", founderToken);
const connection = new Connection(endpoint.toString(), "confirmed");
const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
let confirmed = false;
for (let attempt = 0; attempt < 24; attempt++) {
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error(`setRequestReaders ${signature} failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    confirmed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}
assert.equal(confirmed, true);
assert.equal((await readPaymentRequest(COMPANY, REQUEST, founderToken)).status, "executed");
await assert.rejects(readPaymentRequest(COMPANY, REQUEST, managerToken));
process.stdout.write(JSON.stringify({ result: "PASS", signature, request: REQUEST,
  managerReadAfterCleanup: "denied" }, null, 2) + "\n");
