import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  EPHEMERAL_VAULT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  getAuthToken,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { delegationStatus, DEVNET_USDC } from "../src/magicblock.ts";

const BASE_RPC = "https://rpc.magicblock.app/devnet";
const TEE_RPC = "https://devnet-tee.magicblock.app";
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;

function loadKey(name: string): Keypair {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function teeConnection(endpoint: string, signer: Keypair): Promise<Connection> {
  const auth = await getAuthToken(endpoint, signer.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, signer.secretKey),
  );
  const url = new URL(endpoint);
  url.searchParams.set("token", auth.token);
  return new Connection(url.toString(), "confirmed");
}

async function sendEr(provider: anchor.AnchorProvider, transaction: anchor.web3.Transaction): Promise<string> {
  transaction.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
  transaction.feePayer = provider.wallet.publicKey;
  return provider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });
}

async function waitForDelegation(address: PublicKey): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const status = await delegationStatus({ account: address.toBase58() });
    if (status.isDelegated === true) {
      assert.equal(new URL(status.fqdn as string).hostname, new URL(TEE_RPC).hostname);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`delegation did not resolve for ${address.toBase58()}`);
}

async function main(): Promise<void> {
  const founder = loadKey("MERCURY_PAYER_KEYPAIR");
  const finance = loadKey("MERCURY_FINANCE_KEYPAIR");
  const outsider = loadKey("MERCURY_OUTSIDER_KEYPAIR");
  const agent = loadKey("MERCURY_AGENT_KEYPAIR");
  const programId = new PublicKey(idl.address);
  const [policy] = PublicKey.findProgramAddressSync(
    [Buffer.from("company-policy"), founder.publicKey.toBuffer()], programId,
  );
  const permission = permissionPdaFromAccount(policy);
  const base = new Connection(BASE_RPC, "confirmed");
  const baseProvider = new anchor.AnchorProvider(base, new anchor.Wallet(founder), { commitment: "confirmed" });
  const program = new anchor.Program(idl, baseProvider);

  if (!(await base.getAccountInfo(policy))) {
    const signature = await program.methods.initializeCompany(finance.publicKey, new PublicKey(process.env.MERCURY_TEST_MINT ?? DEVNET_USDC))
      .accountsPartial({ policy, founder: founder.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    process.stdout.write(`initialize_company: ${signature}\n`);
  }

  let status = await delegationStatus({ account: policy.toBase58() });
  if (status.isDelegated !== true) {
    const transaction = await program.methods.delegatePolicy()
      .accountsPartial({ founder: founder.publicKey, policy, validator: TEE_VALIDATOR })
      .transaction();
    const signature = await baseProvider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });
    process.stdout.write(`delegate_policy: ${signature}\n`);
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      status = await delegationStatus({ account: policy.toBase58() });
      if (status.isDelegated === true) break;
    }
  }
  assert.equal(status.isDelegated, true, "policy was not delegated");
  const resolvedEndpoint = typeof status.fqdn === "string" ? status.fqdn : TEE_RPC;
  assert.equal(new URL(resolvedEndpoint).hostname, new URL(TEE_RPC).hostname, "policy was delegated outside the selected TEE endpoint");
  const er = await teeConnection(resolvedEndpoint, founder);
  const erProvider = new anchor.AnchorProvider(er, new anchor.Wallet(founder), { commitment: "confirmed" });
  const erProgram = new anchor.Program(idl, erProvider);

  const permissionAccounts = {
    founder: founder.publicKey,
    policy,
    permission,
    permissionProgram: PERMISSION_PROGRAM_ID,
    ephemeralVault: EPHEMERAL_VAULT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
  };
  const permissionOnEr = await er.getAccountInfo(permission);
  if (!permissionOnEr) {
    const transaction = await erProgram.methods.initPermission().accountsPartial(permissionAccounts).transaction();
    transaction.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    transaction.feePayer = founder.publicKey;
    const signature = await erProvider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });
    process.stdout.write(`init_permission: ${signature}\n`);
  }
  const before = await (erProgram.account as any).companyPolicy.fetch(policy);
  if (!before.privateReady) {
    const transaction = await erProgram.methods.activatePrivacy().accountsPartial(permissionAccounts).transaction();
    transaction.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
    transaction.feePayer = founder.publicKey;
    const signature = await erProvider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });
    process.stdout.write(`activate_privacy: ${signature}\n`);
  }
  const transaction = await erProgram.methods.configureLimits(new anchor.BN(100_000_000), new anchor.BN(10_000_000))
    .accountsPartial({ founder: founder.publicKey, policy }).transaction();
  transaction.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  transaction.feePayer = founder.publicKey;
  const signature = await erProvider.sendAndConfirm(transaction, [], { skipPreflight: true, commitment: "confirmed" });
  process.stdout.write(`configure_limits: ${signature}\n`);

  const authorized = await (erProgram.account as any).companyPolicy.fetch(policy);
  assert.equal(authorized.monthlyLimitMicro.toString(), "100000000");
  const outsiderEr = await teeConnection(resolvedEndpoint, outsider);
  let outsiderBlocked = false;
  try {
    outsiderBlocked = (await outsiderEr.getAccountInfo(policy)) === null;
  } catch {
    outsiderBlocked = true;
  }
  assert.equal(outsiderBlocked, true, "outsider could read the private policy");
  process.stdout.write(`PASS: private policy ${policy.toBase58()} readable by Founder and denied to outsider\n`);

  const requestId = new anchor.BN(1);
  const [request] = PublicKey.findProgramAddressSync([
    Buffer.from("payment-request"), policy.toBuffer(), founder.publicKey.toBuffer(), requestId.toArrayLike(Buffer, "le", 8),
  ], programId);
  if (!(await base.getAccountInfo(request))) {
    const sig = await program.methods.createRequestShell(policy, requestId).accountsPartial({
      request, requester: founder.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    process.stdout.write(`create_request_shell: ${sig}\n`);
  }
  if ((await delegationStatus({ account: request.toBase58() })).isDelegated !== true) {
    const tx = await program.methods.delegateRequest(policy, requestId).accountsPartial({
      request, requester: founder.publicKey, validator: TEE_VALIDATOR,
    }).transaction();
    process.stdout.write(`delegate_request: ${await baseProvider.sendAndConfirm(tx, [], { skipPreflight: true })}\n`);
  }
  await waitForDelegation(request);
  const requestPermission = permissionPdaFromAccount(request);
  const requestAccounts = {
    requester: founder.publicKey, request, permission: requestPermission,
    permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID,
  };
  if (!(await er.getAccountInfo(requestPermission))) {
    const tx = await erProgram.methods.initRequestPermission().accountsPartial(requestAccounts).transaction();
    process.stdout.write(`init_request_permission: ${await sendEr(erProvider, tx)}\n`);
  }
  let requestState = await (erProgram.account as any).paymentRequest.fetch(request);
  if (!requestState.privateReady) {
    const tx = await erProgram.methods.activateRequestPrivacy().accountsPartial({
      ...requestAccounts, founder: founder.publicKey, policy,
    }).transaction();
    process.stdout.write(`activate_request_privacy: ${await sendEr(erProvider, tx)}\n`);
  }
  requestState = await (erProgram.account as any).paymentRequest.fetch(request);
  if (requestState.status === 0) {
    const tx = await erProgram.methods.submitPayment(finance.publicKey, new anchor.BN(1_000_000))
      .accountsPartial({ requester: founder.publicKey, request }).transaction();
    process.stdout.write(`submit_payment: ${await sendEr(erProvider, tx)}\n`);
  }
  const financeEr = await teeConnection(resolvedEndpoint, finance);
  const financeProvider = new anchor.AnchorProvider(financeEr, new anchor.Wallet(finance), { commitment: "confirmed" });
  const financeProgram = new anchor.Program(idl, financeProvider);
  requestState = await (financeProgram.account as any).paymentRequest.fetch(request);
  if (requestState.status === 1) {
    const tx = await financeProgram.methods.approvePayment().accountsPartial({ finance: finance.publicKey, policy, request }).transaction();
    process.stdout.write(`approve_payment: ${await sendEr(financeProvider, tx)}\n`);
  }
  requestState = await (erProgram.account as any).paymentRequest.fetch(request);
  assert.ok(requestState.status === 2 || requestState.status === 3);
  assert.equal(requestState.amountMicro.toString(), "1000000");
  assert.equal((await outsiderEr.getAccountInfo(request)), null, "outsider could read payment request");
  process.stdout.write(`PASS: private payment request ${request.toBase58()} status ${requestState.status}; outsider denied\n`);

  if (requestState.status === 2) {
    const wrongApprover = await erProgram.methods.approvePayment().accountsPartial({
      finance: founder.publicKey, policy, request,
    }).transaction();
    let wrongApproverRejected = false;
    try {
      await sendEr(erProvider, wrongApprover);
    } catch {
      wrongApproverRejected = true;
    }
    assert.equal(wrongApproverRejected, true, "Founder unexpectedly passed the Finance signer check");
    assert.equal((await (financeProgram.account as any).paymentRequest.fetch(request)).status, 2);
    process.stdout.write("PASS: Founder cannot sign as Finance for approval\n");
  }

  const [agentPolicy] = PublicKey.findProgramAddressSync([
    Buffer.from("agent-policy"), founder.publicKey.toBuffer(), policy.toBuffer(), agent.publicKey.toBuffer(),
  ], programId);
  if (!(await base.getAccountInfo(agentPolicy))) {
    const sig = await program.methods.createAgentShell(policy, agent.publicKey).accountsPartial({
      founder: founder.publicKey, agentPolicy, systemProgram: SystemProgram.programId,
    }).rpc();
    process.stdout.write(`create_agent_shell: ${sig}\n`);
  }
  if ((await delegationStatus({ account: agentPolicy.toBase58() })).isDelegated !== true) {
    const tx = await program.methods.delegateAgent(policy, agent.publicKey).accountsPartial({
      founder: founder.publicKey, agentPolicy, validator: TEE_VALIDATOR,
    }).transaction();
    process.stdout.write(`delegate_agent: ${await baseProvider.sendAndConfirm(tx, [], { skipPreflight: true })}\n`);
  }
  await waitForDelegation(agentPolicy);
  const agentPermission = permissionPdaFromAccount(agentPolicy);
  const agentAccounts = {
    founder: founder.publicKey, agentPolicy, permission: agentPermission,
    permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID,
  };
  if (!(await er.getAccountInfo(agentPermission))) {
    const tx = await erProgram.methods.initAgentPermission().accountsPartial(agentAccounts).transaction();
    process.stdout.write(`init_agent_permission: ${await sendEr(erProvider, tx)}\n`);
  }
  let agentState = await (erProgram.account as any).agentPolicy.fetch(agentPolicy);
  if (!agentState.privateReady) {
    const tx = await erProgram.methods.activateAgentPrivacy().accountsPartial({ ...agentAccounts, policy }).transaction();
    process.stdout.write(`activate_agent_privacy: ${await sendEr(erProvider, tx)}\n`);
  }
  agentState = await (erProgram.account as any).agentPolicy.fetch(agentPolicy);
  if (agentState.perPaymentCapMicro.toString() === "0") {
    const tx = await erProgram.methods.configureAgent(finance.publicKey, new anchor.BN(500_000), new anchor.BN(2_000_000))
      .accountsPartial({ founder: founder.publicKey, agentPolicy }).transaction();
    process.stdout.write(`configure_agent: ${await sendEr(erProvider, tx)}\n`);
  }
  const agentEr = await teeConnection(resolvedEndpoint, agent);
  agentState = await (new anchor.Program(idl, new anchor.AnchorProvider(agentEr, new anchor.Wallet(agent), { commitment: "confirmed" })).account as any).agentPolicy.fetch(agentPolicy);
  assert.equal(agentState.perPaymentCapMicro.toString(), "500000");
  assert.equal((await outsiderEr.getAccountInfo(agentPolicy)), null, "outsider could read agent policy");
  process.stdout.write(`PASS: private agent policy ${agentPolicy.toBase58()} configured; Agent readable and outsider denied\n`);

  if (process.env.MERCURY_EXERCISE_REVOKE === "1") {
    const tx = await erProgram.methods.revokeAgent().accountsPartial({ ...agentAccounts, policy }).transaction();
    process.stdout.write(`revoke_agent: ${await sendEr(erProvider, tx)}\n`);
    assert.equal((await (erProgram.account as any).agentPolicy.fetch(agentPolicy)).revoked, true);
    assert.equal((await agentEr.getAccountInfo(agentPolicy)), null, "revoked Agent can still read agent policy");
    process.stdout.write("PASS: Agent revoked and PER read removed\n");
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
