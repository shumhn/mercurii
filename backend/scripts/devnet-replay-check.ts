import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

const founderPath = process.env.MERCURY_TEST_FOUNDER_KEYPAIR;
if (!founderPath) throw new Error("MERCURY_TEST_FOUNDER_KEYPAIR is required");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(founderPath, "utf8"))));
const teeUrl = "https://devnet-tee.magicblock.app";
const auth = await getAuthToken(teeUrl, founder.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, founder.secretKey));
const endpoint = new URL(teeUrl);
endpoint.searchParams.set("token", auth.token);
const connection = new Connection(endpoint.toString(), "confirmed");
const program = new anchor.Program(
  JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl,
  new anchor.AnchorProvider(connection, new anchor.Wallet(founder), { commitment: "confirmed" }),
);
const company = new PublicKey("EpyTeGaoxTJ6Anm1SxHFfyTkYaPdNDPHdgUvvGYXJzDB");
const request = new PublicKey("58DSegaDoCENZLVnmUp5VjNA9pzZDysoNKtDVCZ33T9F");
const treasuryToken = new PublicKey("HTe82TbbJ25vnh7pKJi3smiP3dLoDFwt21G6vzD5YSr");
const recipientToken = new PublicKey("HkDPVU5zZdFkauhCTUHw9inMV9BBjYJ2q2LL4FmsukVv");
const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const before = await connection.getAccountInfo(recipientToken);
assert.ok(before, "recipient token account unavailable");
const beforeBalance = before.data.readBigUInt64LE(64).toString();
const stateBefore = await (program.account as any).paymentRequest.fetch(request);
assert.equal(stateBefore.status, 3, "test request must already be executed");

let failure = "";
try {
  await program.methods.executePayment().accountsPartial({
    actor: founder.publicKey, policy: company, request, grant: program.programId,
    treasuryToken, recipientToken, tokenProgram,
  }).simulate();
} catch (error) {
  const response = (error as { simulationResponse?: { logs?: string[]; err?: unknown } }).simulationResponse;
  failure = [...(response?.logs ?? []), JSON.stringify(response?.err ?? null)].join("\n");
}
assert.match(failure, /WrongStatus|wrong state|0x1777|6007/i, "duplicate execution must fail with WrongStatus");

const after = await connection.getAccountInfo(recipientToken);
assert.ok(after);
assert.equal(after.data.readBigUInt64LE(64).toString(), beforeBalance);
assert.equal((await (program.account as any).paymentRequest.fetch(request)).status, 3);
process.stdout.write(JSON.stringify({ result: "PASS", duplicateExecution: "WrongStatus", recipientBalanceMicro: beforeBalance }) + "\n");
