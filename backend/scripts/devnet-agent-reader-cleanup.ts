import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { asAddress } from "../src/magicblock.ts";
import { TEE_RPC, buildOperation, readAgentPolicy, readCompanyPolicy } from "../src/operations.ts";

const company = asAddress(process.env.MERCURY_COMPANY_ADDRESS, "MERCURY_COMPANY_ADDRESS");
const agentPolicy = asAddress(process.env.MERCURY_AGENT_POLICY_ADDRESS, "MERCURY_AGENT_POLICY_ADDRESS");
function signer(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
async function token(signer: Keypair): Promise<string> {
  return (await getAuthToken(TEE_RPC, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey))).token;
}
async function canRead(teeToken: string): Promise<boolean> {
  try { await readAgentPolicy(company, agentPolicy, teeToken); return true; }
  catch { return false; }
}

const founder = signer("MERCURY_FOUNDER_KEYPAIR");
const finance = signer("MERCURY_FINANCE_KEYPAIR");
const agent = signer("MERCURY_AGENT_KEYPAIR");
const founderToken = await token(founder);
const financeToken = await token(finance);
const agentToken = await token(agent);
const [policy, target] = await Promise.all([
  readCompanyPolicy(company, founderToken), readAgentPolicy(company, agentPolicy, founderToken),
]);
assert.equal(policy.founder, founder.publicKey.toBase58());
assert.equal(target.finance, finance.publicKey.toBase58());
assert.equal(target.agent, agent.publicKey.toBase58());
assert.equal(target.revoked, true, "Use this proof only with an already revoked Agent");
assert.equal(await canRead(financeToken), true, "Finance already lacks read access");
assert.equal(await canRead(agentToken), false, "Revoked Agent unexpectedly has read access");
assert.equal(process.env.MERCURY_CONFIRM_AGENT_READER_CLEANUP, "1",
  "Set MERCURY_CONFIRM_AGENT_READER_CLEANUP=1 to sign the devnet ACL reset");

const built = await buildOperation({ operation: "removeFinanceAgentReader",
  actor: founder.publicKey.toBase58(), agentPolicy,
}, { company, founder: founder.publicKey.toBase58(), teeToken: founderToken });
assert.equal(built.sendTo, "ephemeral");
const bytes = Buffer.from(built.transactionBase64, "base64");
let signed: Buffer;
try {
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([founder]);
  signed = Buffer.from(tx.serialize());
} catch {
  const tx = Transaction.from(bytes);
  tx.sign(founder);
  signed = Buffer.from(tx.serialize());
}
const endpoint = new URL(TEE_RPC);
endpoint.searchParams.set("token", founderToken);
const rpc = new Connection(endpoint.toString(), "confirmed");
const signature = await rpc.sendRawTransaction(signed, { skipPreflight: false });
const confirmation = await rpc.confirmTransaction(signature, "confirmed");
if (confirmation.value.err) throw new Error(`ACL reset failed: ${JSON.stringify(confirmation.value.err)}`);
assert.equal(await canRead(founderToken), true);
assert.equal(await canRead(financeToken), false, "Finance can still read AgentPolicy");
assert.equal(await canRead(agentToken), false, "Revoked Agent regained AgentPolicy read access");
process.stdout.write(JSON.stringify({ status: "passed", signature, company, agentPolicy,
  founderCanRead: true, financeCanRead: false, revokedAgentCanRead: false }) + "\n");
