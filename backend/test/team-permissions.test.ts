import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { PROGRAM_ID, teamGrantAddress } from "../src/operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const actor = Keypair.generate().publicKey;
const company = Keypair.generate().publicKey;
const request = Keypair.generate().publicKey;
const grant = teamGrantAddress(company, actor, Keypair.generate().publicKey, new anchor.BN(0));
const program = new anchor.Program(idl, new anchor.AnchorProvider(
  new Connection("http://127.0.0.1:8899"),
  { publicKey: actor, signTransaction: async () => { throw new Error("no signing"); },
    signAllTransactions: async () => { throw new Error("no signing"); } } as unknown as anchor.Wallet,
  {},
));

test("Founder payment encodes absent grants with the Anchor optional-account sentinel", async () => {
  const approve = await program.methods.approvePayment().accountsPartial({
    actor, policy: company, request, grant: PROGRAM_ID, parentGrant: PROGRAM_ID,
  }).instruction();
  assert.equal(approve.keys.length, 5);
  assert.ok(approve.keys[3]!.pubkey.equals(PROGRAM_ID));
  assert.ok(approve.keys[4]!.pubkey.equals(PROGRAM_ID));
});

test("Finance and Manager approval instructions carry distinct grant accounts", async () => {
  const managerGrant = teamGrantAddress(company, actor, Keypair.generate().publicKey, new anchor.BN(1));
  const financeApproval = await program.methods.approvePayment().accountsPartial({
    actor, policy: company, request, grant, parentGrant: PROGRAM_ID,
  }).instruction();
  const managerApproval = await program.methods.approvePayment().accountsPartial({
    actor, policy: company, request, grant: managerGrant, parentGrant: grant,
  }).instruction();
  assert.ok(financeApproval.keys[3]!.pubkey.equals(grant));
  assert.ok(financeApproval.keys[4]!.pubkey.equals(PROGRAM_ID));
  assert.ok(managerApproval.keys[3]!.pubkey.equals(managerGrant));
  assert.ok(managerApproval.keys[4]!.pubkey.equals(grant));
});
