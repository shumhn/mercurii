import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { readRecipientBalance } from "../src/magicblock.ts";
import { TEE_RPC } from "../src/operations.ts";

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

const recipient = key("MERCURY_FINANCE_KEYPAIR");
const outsider = key("MERCURY_OUTSIDER_KEYPAIR");
const mint = "BHTANWG8igML3nxnHLcokhhzYt999W5LWjrtECFpNiv";
const recipientToken = await token(recipient);
const outsiderToken = await token(outsider);
const view = await readRecipientBalance({ owner: recipient.publicKey.toBase58(), mint, teeToken: recipientToken });
assert.equal(view.balanceMicro, "2249999");
assert.equal(view.tokenAccount, "HkDPVU5zZdFkauhCTUHw9inMV9BBjYJ2q2LL4FmsukVv");
await assert.rejects(() => readRecipientBalance({
  owner: recipient.publicKey.toBase58(), mint, teeToken: outsiderToken,
}), /unavailable|unauthorized|denied/i);
process.stdout.write(JSON.stringify({ result: "PASS", owner: view.owner, balanceMicro: view.balanceMicro, outsiderDenied: true }) + "\n");
