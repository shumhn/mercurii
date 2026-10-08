import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { TEE_RPC, buildOperation, readCompanyPolicy, readTeamGrant } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const GRANT = "FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP";
function load(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
const founder = load("MERCURY_FOUNDER_KEYPAIR");
const finance = load("MERCURY_FINANCE_KEYPAIR");
const token = async (key: Keypair) => (await getAuthToken(TEE_RPC, key.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, key.secretKey))).token;
const founderToken = await token(founder);
const financeToken = await token(finance);
const policy = await readCompanyPolicy(COMPANY, founderToken);
const grant = await readTeamGrant(COMPANY, GRANT, founderToken);
assert.equal(policy.founder, founder.publicKey.toBase58());
assert.equal(policy.finance, finance.publicKey.toBase58());
assert.equal(grant.role, 1);
assert.equal(grant.active, true);
assert.equal(grant.revoked, false);
const built = await buildOperation({ operation: "restorePolicyReaders",
  actor: policy.founder as string, grant: GRANT },
{ company: COMPANY, founder: policy.founder as string, teeToken: founderToken });
const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
tx.sign(founder);
const endpoint = new URL(TEE_RPC);
endpoint.searchParams.set("token", founderToken);
const connection = new Connection(endpoint.toString(), "confirmed");
const simulation = await connection.simulateTransaction(tx);
if (simulation.value.err) throw new Error(`Policy ACL restoration simulation: ${JSON.stringify({
  error: simulation.value.err, logs: simulation.value.logs,
})}`);
const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
for (let attempt = 0; attempt < 35; attempt++) {
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error(`Policy ACL restoration failed: ${JSON.stringify(status.err)} (${signature})`);
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    assert.equal((await readCompanyPolicy(COMPANY, financeToken)).finance, finance.publicKey.toBase58());
    process.stdout.write(JSON.stringify({ result: "PASS", signature, financeRead: "allowed" }) + "\n");
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
}
throw new Error(`Policy ACL restoration timed out: ${signature}`);
