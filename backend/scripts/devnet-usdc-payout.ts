import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC, readRecipientBalance } from "../src/magicblock.ts";
import { TEE_RPC, readCompanyPolicy, readPaymentRequest } from "../src/operations.ts";

const COMPANY = "362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW";
const REQUEST = "Ao1hZcbqkM5DFfEHi48SVAk6zq1nYjyEbgFENPvdYDzK";
const TREASURY_TOKEN = new PublicKey("9FZSyPdFCdnUExrGwtmigbPGR9HcCehJ77osx3ctoKeH");
const RECIPIENT_TOKEN = new PublicKey("8EoZBo73yQy7jMVxoKz5QW12nEhMMwbEHT4W1kyZTj3S");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const PAYMENT_MICRO = 10_000n;

const financePath = process.env.MERCURY_FINANCE_KEYPAIR;
if (!financePath) throw new Error("MERCURY_FINANCE_KEYPAIR is required");
const finance = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(financePath, "utf8"))));
const auth = await getAuthToken(TEE_RPC, finance.publicKey, async (message: Uint8Array) =>
  nacl.sign.detached(message, finance.secretKey));
const teeUrl = new URL(TEE_RPC);
teeUrl.searchParams.set("token", auth.token);
const connection = new Connection(teeUrl.toString(), "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(finance), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const program = new anchor.Program(idl, provider);

const policy = await readCompanyPolicy(COMPANY, auth.token);
assert.equal(policy.mint, DEVNET_USDC);
assert.equal(policy.finance, finance.publicKey.toBase58());
const request = await readPaymentRequest(COMPANY, REQUEST, auth.token);
assert.equal(request.recipient, finance.publicKey.toBase58());
assert.equal(request.amountMicro, PAYMENT_MICRO.toString());
const recipientBefore = BigInt((await readRecipientBalance({
  owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: auth.token,
})).balanceMicro);
if (request.status === "executed") {
  process.stdout.write(JSON.stringify({ status: "already_executed", request: REQUEST,
    recipientBalanceMicro: recipientBefore.toString() }, null, 2) + "\n");
  process.exit(0);
}
assert.equal(request.status, "approved", "request must be approved before payout");
assert.ok(BigInt(String(policy.reservedMicro)) >= PAYMENT_MICRO, "budget reservation is missing");

const transaction = await program.methods.executePayment().accountsPartial({
  finance: finance.publicKey, policy: new PublicKey(COMPANY), request: new PublicKey(REQUEST),
  treasuryToken: TREASURY_TOKEN, recipientToken: RECIPIENT_TOKEN, tokenProgram: TOKEN_PROGRAM,
}).transaction();
transaction.feePayer = finance.publicKey;
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
const signature = await provider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });

const afterRequest = await readPaymentRequest(COMPANY, REQUEST, auth.token);
const recipientAfter = BigInt((await readRecipientBalance({
  owner: finance.publicKey.toBase58(), mint: DEVNET_USDC, teeToken: auth.token,
})).balanceMicro);
assert.equal(afterRequest.status, "executed");
assert.equal(recipientAfter, recipientBefore + PAYMENT_MICRO);
process.stdout.write(JSON.stringify({
  result: "PASS", signature, company: COMPANY, request: REQUEST, mint: DEVNET_USDC,
  amountMicro: PAYMENT_MICRO.toString(),
  recipientBeforeMicro: recipientBefore.toString(), recipientAfterMicro: recipientAfter.toString(),
}, null, 2) + "\n");
