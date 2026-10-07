import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID,
  getAuthToken, permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { delegationStatus } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC, TEE_VALIDATOR } from "../src/operations.ts";

function key(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function tee(signer: Keypair): Promise<Connection> {
  const auth = await getAuthToken(TEE_RPC, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey));
  const url = new URL(TEE_RPC);
  url.searchParams.set("token", auth.token);
  return new Connection(url.toString(), "confirmed");
}

async function send(provider: anchor.AnchorProvider, tx: Transaction): Promise<string> {
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
  tx.feePayer = provider.wallet.publicKey;
  return provider.sendAndConfirm(tx, [], { skipPreflight: true, commitment: "confirmed" });
}

const founder = key("MERCURY_TEST_FOUNDER_KEYPAIR");
const finance = key("MERCURY_FINANCE_KEYPAIR");
const outsider = key("MERCURY_OUTSIDER_KEYPAIR");
const company = new PublicKey(process.env.MERCURY_TEST_COMPANY ?? "EpyTeGaoxTJ6Anm1SxHFfyTkYaPdNDPHdgUvvGYXJzDB");
const treasuryToken = new PublicKey(process.env.MERCURY_TEST_TREASURY_TOKEN ?? "HTe82TbbJ25vnh7pKJi3smiP3dLoDFwt21G6vzD5YSr");
const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const programId = new PublicKey(idl.address);
const [snapshot] = PublicKey.findProgramAddressSync([Buffer.from("treasury-snapshot"), company.toBuffer()], programId);
const permission = permissionPdaFromAccount(snapshot);
const base = new Connection(BASE_RPC, "confirmed");
const baseProvider = new anchor.AnchorProvider(base, new anchor.Wallet(founder), { commitment: "confirmed" });
const baseProgram = new anchor.Program(idl, baseProvider);

if (!(await base.getAccountInfo(snapshot))) {
  const tx = await baseProgram.methods.createSnapshotShell(company).accountsPartial({
    founder: founder.publicKey, snapshot, systemProgram: SystemProgram.programId,
  }).transaction();
  process.stdout.write(`create_snapshot_shell: ${await send(baseProvider, tx)}\n`);
}
if ((await delegationStatus({ account: snapshot.toBase58() })).isDelegated !== true) {
  const tx = await baseProgram.methods.delegateSnapshot(company).accountsPartial({
    founder: founder.publicKey, snapshot, validator: TEE_VALIDATOR,
  }).transaction();
  process.stdout.write(`delegate_snapshot: ${await send(baseProvider, tx)}\n`);
}
let delegated = false;
for (let i = 0; i < 20; i++) {
  delegated = (await delegationStatus({ account: snapshot.toBase58() })).isDelegated === true;
  if (delegated) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
assert.equal(delegated, true);

const founderEr = await tee(founder);
const founderProvider = new anchor.AnchorProvider(founderEr, new anchor.Wallet(founder), { commitment: "confirmed" });
const founderProgram = new anchor.Program(idl, founderProvider);
const acl = {
  founder: founder.publicKey, snapshot, permission,
  permissionProgram: PERMISSION_PROGRAM_ID,
  ephemeralVault: EPHEMERAL_VAULT_ID,
  magicProgram: MAGIC_PROGRAM_ID,
};
if (!(await founderEr.getAccountInfo(permission))) {
  const tx = await founderProgram.methods.initSnapshotPermission().accountsPartial(acl).transaction();
  process.stdout.write(`init_snapshot_permission: ${await send(founderProvider, tx)}\n`);
}
let state = await (founderProgram.account as any).treasurySnapshot.fetch(snapshot);
if (!state.privateReady) {
  const tx = await founderProgram.methods.activateSnapshotPrivacy().accountsPartial({ ...acl, policy: company }).transaction();
  process.stdout.write(`activate_snapshot_privacy: ${await send(founderProvider, tx)}\n`);
}

const financeEr = await tee(finance);
const financeProvider = new anchor.AnchorProvider(financeEr, new anchor.Wallet(finance), { commitment: "confirmed" });
const financeProgram = new anchor.Program(idl, financeProvider);
const tx = await financeProgram.methods.syncTreasurySnapshot().accountsPartial({
  finance: finance.publicKey, policy: company, snapshot, treasuryToken,
}).transaction();
process.stdout.write(`sync_treasury_snapshot: ${await send(financeProvider, tx)}\n`);
state = await (financeProgram.account as any).treasurySnapshot.fetch(snapshot);
assert.equal(state.privateReady, true);
assert.ok(state.updatedSlot.toNumber() > 0);
assert.ok(state.balanceMicro.toNumber() >= 0);
const founderView = await (founderProgram.account as any).treasurySnapshot.fetch(snapshot);
assert.equal(founderView.balanceMicro.toString(), state.balanceMicro.toString());
const outsiderEr = await tee(outsider);
assert.equal(await outsiderEr.getAccountInfo(snapshot), null);
process.stdout.write(JSON.stringify({
  result: "PASS", snapshot: snapshot.toBase58(),
  balanceMicro: state.balanceMicro.toString(), updatedSlot: state.updatedSlot.toString(),
  founderAndFinanceCanRead: true, outsiderDenied: true,
}, null, 2) + "\n");
