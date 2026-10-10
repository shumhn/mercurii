import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair } from "@solana/web3.js";
import { PROGRAM_ID, teamGrantAddress } from "../src/operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const actor = Keypair.generate().publicKey;
const company = Keypair.generate().publicKey;
const request = Keypair.generate().publicKey;
const grant = teamGrantAddress(company, actor, Keypair.generate().publicKey, new BN(0));
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
  const managerGrant = teamGrantAddress(company, actor, Keypair.generate().publicKey, new BN(1));
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

test("privacy activation encodes Founder-only readers for a revoked Finance member", async () => {
  const requestPermission = Keypair.generate().publicKey;
  const accounts = {
    founder: actor, policy: company, request, requesterGrant: PROGRAM_ID,
    permission: requestPermission, ephemeralVault: requestPermission,
    magicProgram: requestPermission, permissionProgram: requestPermission,
  };
  const requestInstruction = await program.methods.activateRequestPrivacy(false, anchor.web3.PublicKey.default)
    .accountsPartial(accounts).instruction();
  const snapshotInstruction = await program.methods.activateSnapshotPrivacy(false)
    .accountsPartial({ founder: actor, policy: company, snapshot: request,
      permission: requestPermission, ephemeralVault: requestPermission,
      magicProgram: requestPermission, permissionProgram: requestPermission }).instruction();
  assert.ok(requestInstruction.data.equals(program.coder.instruction.encode("activateRequestPrivacy", {
    includeFinance: false, manager: anchor.web3.PublicKey.default,
  })));
  assert.ok(snapshotInstruction.data.equals(program.coder.instruction.encode("activateSnapshotPrivacy", {
    includeFinance: false,
  })));
});

test("request reader reset can omit a revoked requester and require a Viewer grant", async () => {
  const requestPermission = Keypair.generate().publicKey;
  const accounts = { founder: actor, policy: company, request,
    viewerGrant: PROGRAM_ID, permission: requestPermission,
    ephemeralVault: requestPermission, magicProgram: requestPermission,
    permissionProgram: requestPermission };
  const reset = await program.methods.setRequestReadersV2(false, false,
    anchor.web3.PublicKey.default, anchor.web3.PublicKey.default)
    .accountsPartial(accounts).instruction();
  assert.ok(reset.keys[3]!.pubkey.equals(PROGRAM_ID));
  assert.ok(reset.data.equals(program.coder.instruction.encode("setRequestReadersV2", {
    includeRequester: false, includeFinance: false,
    manager: anchor.web3.PublicKey.default, viewer: anchor.web3.PublicKey.default,
  })));
});

test("AgentPolicy reader cleanup is Founder-signed and targets the private policy permission", async () => {
  const agentPolicy = Keypair.generate().publicKey;
  const permission = Keypair.generate().publicKey;
  const instruction = await program.methods.removeFinanceAgentReader().accountsPartial({
    founder: actor, policy: company, agentPolicy, permission,
    ephemeralVault: Keypair.generate().publicKey,
    magicProgram: Keypair.generate().publicKey,
    permissionProgram: Keypair.generate().publicKey,
  }).instruction();
  assert.ok(instruction.keys[0]!.pubkey.equals(actor));
  assert.equal(instruction.keys[0]!.isSigner, true);
  assert.ok(instruction.keys.some((key) => key.pubkey.equals(agentPolicy) && key.isWritable));
  assert.ok(instruction.keys.some((key) => key.pubkey.equals(permission) && key.isWritable));
});
