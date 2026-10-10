import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { inspectManagerGrant } from "../src/manager-onboarding.ts";
import { inspectMemberGrant } from "../src/member-onboarding.ts";
import { listTeamMembers } from "../src/team-directory.ts";
import { confirmOnboardingReceipt, recordOnboardingBuild } from "../src/onboarding-journal.ts";
import { DEVNET_USDC, canonicalTokenAccount, delegationStatus, readRecipientBalance } from "../src/magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, branchScopeAddress, buildOperation,
  paymentRequestAddress, readAgentPolicy, readCompanyPolicy, readPaymentRequest,
  readTeamGrant, readTreasurySnapshot, teamGrantAddress } from "../src/operations.ts";

const dir = process.env.MERCURY_TEAM_PROOF_DIR;
if (!dir) throw new Error("MERCURY_TEAM_PROOF_DIR is required");
const publicKeys = JSON.parse(readFileSync(`${dir}/public.json`, "utf8")) as Record<string, string>;
const key = (name: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"))));
const founder = key("founder");
const finance = key("finance");
const manager = key("manager");
const requester = key("requester");
const viewer = key("viewer");
const agent = key("agent");
const company = publicKeys.company!;
const payee = "AQ7qSt9aKneMF95ajWtg7Tek9iu5QZdJh91u1SGhrGWL";
const branchId = 17;
const financeGrant = teamGrantAddress(new PublicKey(company), founder.publicKey,
  finance.publicKey, new BN(1)).toBase58();
const managerGrant = teamGrantAddress(new PublicKey(company), finance.publicKey,
  manager.publicKey, new BN(2)).toBase58();
const requesterGrant = teamGrantAddress(new PublicKey(company), founder.publicKey,
  requester.publicKey, new BN(3)).toBase58();
const viewerGrant = teamGrantAddress(new PublicKey(company), founder.publicKey,
  viewer.publicKey, new BN(4)).toBase58();
const agentPolicy = PublicKey.findProgramAddressSync([
  Buffer.from("agent-policy"), founder.publicKey.toBuffer(),
  new PublicKey(company).toBuffer(), agent.publicKey.toBuffer(),
], PROGRAM_ID)[0].toBase58();
const token = new Map<string, string>();
for (const signer of [founder, finance, manager, requester, viewer, agent]) {
  token.set(signer.publicKey.toBase58(), (await getAuthToken(TEE_RPC, signer.publicKey,
    async (message: Uint8Array) => nacl.sign.detached(message, signer.secretKey))).token);
}
const auth = (signer: Keypair): string => token.get(signer.publicKey.toBase58())!;
const tee = (teeToken: string): Connection => {
  const url = new URL(TEE_RPC);
  url.searchParams.set("token", teeToken);
  return new Connection(url.toString(), "confirmed");
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 800));

async function submit(operation: string, signer: Keypair, fields: Record<string, unknown>,
  expectFailure = false): Promise<string> {
  const built = await buildOperation({ operation, actor: signer.publicKey.toBase58(), ...fields },
    { company, founder: founder.publicKey.toBase58(), teeToken: auth(signer) });
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  tx.sign(signer);
  const target = String(fields.grant ?? fields.request ?? fields.agentPolicy ?? company);
  const receipt = !expectFailure ? recordOnboardingBuild({ company, target, operation,
    chain: built.sendTo, transactionBase64: built.transactionBase64 }) : null;
  const rpc = built.sendTo === "base" ? new Connection(BASE_RPC, "confirmed") : tee(auth(signer));
  let signature: string;
  try {
    signature = await rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: built.sendTo === "ephemeral", maxRetries: 3,
    });
  } catch (error) {
    if (expectFailure) return `rejected:${String(error).slice(0, 100)}`;
    throw error;
  }
  for (let attempt = 0; attempt < 35; attempt++) {
    const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) {
      if (expectFailure) return signature;
      throw new Error(`${operation} failed: ${JSON.stringify(status.err)} (${signature})`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (expectFailure) throw new Error(`${operation} unexpectedly succeeded`);
      const confirmed = await confirmOnboardingReceipt(receipt!.id, tx.serialize().toString("base64"), auth(signer));
      if (confirmed.status !== "confirmed") throw new Error(`${operation} receipt not confirmed`);
      process.stdout.write(`${operation}: ${signature}\n`);
      return signature;
    }
    await pause();
  }
  throw new Error(`${operation} confirmation timed out: ${signature}`);
}

async function ensureManager(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await inspectManagerGrant({ company, founder: founder.publicKey.toBase58(),
      finance: finance.publicKey.toBase58(), manager: manager.publicKey.toBase58(), grantId: "2",
      parentGrant: financeGrant, branchId, perPaymentCapMicro: 5, periodCapMicro: 20,
      recipients: [payee], teeToken: auth(finance) });
    if (result.next.status === "ready") return;
    if (result.next.status === "wait") { await pause(); continue; }
    await submit(result.next.operation!, finance, { member: manager.publicKey.toBase58(),
      grantId: "2", grant: managerGrant, parentGrant: financeGrant, role: "manager",
      scope: branchScopeAddress(new PublicKey(company), branchId).toBase58(),
      perPaymentCapMicro: 5, periodCapMicro: 20, recipients: [payee], mayDelegate: false });
  }
  throw new Error("Manager grant setup timed out");
}

async function ensureMember(signer: Keypair, role: "requester" | "viewer",
  grantId: string, grant: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await inspectMemberGrant({ company, founder: founder.publicKey.toBase58(),
      member: signer.publicKey.toBase58(), role, grantId, branchId, teeToken: auth(founder) });
    if (result.next.status === "ready") return;
    if (result.next.status === "wait") { await pause(); continue; }
    await submit(result.next.operation!, founder, { member: signer.publicKey.toBase58(),
      grantId, grant, role, scope: result.scopeAddress, recipients: [], mayDelegate: false });
  }
  throw new Error(`${role} grant setup timed out`);
}

async function setupAgent(): Promise<void> {
  await submit("createAgentShell", founder, { agent: agent.publicKey.toBase58() });
  await submit("delegateAgent", founder, { agent: agent.publicKey.toBase58() });
  for (let attempt = 0; attempt < 40; attempt++) {
    const route = await delegationStatus({ account: agentPolicy });
    if (route.isDelegated === true && await tee(auth(founder)).getAccountInfo(new PublicKey(agentPolicy))) break;
    if (attempt === 39) throw new Error("AgentPolicy delegation timed out");
    await pause();
  }
  await submit("initAgentPermission", founder, { agentPolicy });
  await submit("activateAgentPrivacy", founder, { agentPolicy });
  await submit("configureAgent", founder, { agentPolicy, recipient: payee,
    perPaymentCapMicro: 1, periodCapMicro: 10 });
  assert.equal((await readAgentPolicy(company, agentPolicy, auth(finance))).agent,
    agent.publicKey.toBase58());
}

async function setup(): Promise<void> {
  assert.equal((await readCompanyPolicy(company, auth(founder))).mint, DEVNET_USDC);
  assert.equal((await readTreasurySnapshot(company, auth(founder))).balanceMicro, "100");
  assert.equal((await readTeamGrant(company, financeGrant, auth(finance))).active, true);
  await ensureManager();
  await ensureMember(requester, "requester", "3", requesterGrant);
  await ensureMember(viewer, "viewer", "4", viewerGrant);
  await setupAgent();
  process.stdout.write(JSON.stringify({ phase: "setup_pass", company, financeGrant, managerGrant,
    requesterGrant, viewerGrant, agentPolicy }) + "\n");
}

async function payment(): Promise<void> {
  const requestId = String((BigInt(branchId) << 40n) | 42n);
  const request = paymentRequestAddress(new PublicKey(company), requester.publicKey, new BN(requestId)).toBase58();
  const payeeKeyPath = process.env.MERCURY_TEAM_PAYEE_KEYPAIR;
  if (!payeeKeyPath) throw new Error("MERCURY_TEAM_PAYEE_KEYPAIR is required for the payment phase");
  const payeeKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payeeKeyPath, "utf8"))));
  assert.equal(payeeKey.publicKey.toBase58(), payee);
  const payeeToken = (await getAuthToken(TEE_RPC, payeeKey.publicKey,
    async (message: Uint8Array) => nacl.sign.detached(message, payeeKey.secretKey))).token;
  const before = BigInt((await readRecipientBalance({ owner: payee, mint: DEVNET_USDC,
    teeToken: payeeToken })).balanceMicro);
  await submit("createRequestShell", requester, { requestId });
  await submit("delegateRequest", requester, { requestId });
  for (let attempt = 0; attempt < 40; attempt++) {
    const route = await delegationStatus({ account: request });
    if (route.isDelegated === true && await tee(auth(founder)).getAccountInfo(new PublicKey(request))) break;
    if (attempt === 39) throw new Error("Request delegation timed out");
    await pause();
  }
  await submit("initRequestPermission", requester, { request });
  await submit("activateRequestPrivacy", founder, { request, requesterGrant,
    includeFinance: true, manager: manager.publicKey.toBase58() });
  await submit("submitPayment", requester, { request, requesterGrant,
    recipient: payee, amountMicro: 1 });
  assert.equal((await readPaymentRequest(company, request, auth(manager))).status, "submitted");
  await submit("approvePayment", manager, { request, grant: managerGrant, parentGrant: financeGrant });
  const tokens = { treasuryToken: canonicalTokenAccount(company, DEVNET_USDC),
    recipientToken: canonicalTokenAccount(payee, DEVNET_USDC) };
  const managerDenied = await submit("executePayment", manager, { request, grant: managerGrant, ...tokens }, true);
  assert.equal((await readPaymentRequest(company, request, auth(founder))).status, "approved");
  await submit("executePayment", finance, { request, grant: financeGrant, ...tokens });
  assert.equal((await readPaymentRequest(company, request, auth(founder))).status, "executed");
  const after = BigInt((await readRecipientBalance({ owner: payee, mint: DEVNET_USDC,
    teeToken: payeeToken })).balanceMicro);
  assert.equal(after - before, 1n);
  await submit("setRequestReadersV2", founder, { request, includeRequester: true,
    includeFinance: true, manager: manager.publicKey.toBase58(),
    viewer: viewer.publicKey.toBase58(), viewerGrant });
  assert.equal((await readPaymentRequest(company, request, auth(viewer))).status, "executed");
  process.stdout.write(JSON.stringify({ phase: "payment_pass", request,
    recipientIncreaseMicro: "1", managerExecutionDenied: managerDenied }) + "\n");
}

const backend = process.env.MERCURY_TEAM_BACKEND_URL ?? "http://127.0.0.1:8795";
async function api(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, backend), { method: "POST",
    headers: { authorization: `Bearer ${auth(founder)}`, "content-type": "application/json" },
    body: JSON.stringify(body) });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${String(result.error)}`);
  return result;
}

async function signHttpStep(step: { transaction?: unknown; receiptId?: unknown }): Promise<string> {
  const built = step.transaction as { transactionBase64?: string; sendTo?: string } | undefined;
  if (!built?.transactionBase64 || typeof step.receiptId !== "string") {
    throw new Error("Cleanup step lacks an unsigned transaction and receipt ID");
  }
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  tx.sign(founder);
  const rpc = built.sendTo === "base" ? new Connection(BASE_RPC, "confirmed") : tee(auth(founder));
  const signature = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: built.sendTo === "ephemeral" });
  for (let attempt = 0; attempt < 35; attempt++) {
    const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`HTTP step failed: ${JSON.stringify(status.err)} (${signature})`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") break;
    if (attempt === 34) throw new Error(`HTTP step confirmation timed out: ${signature}`);
    await pause();
  }
  const confirmed = await api(`/v1/onboarding/receipts/${step.receiptId}/confirm`,
    { signedTransactionBase64: tx.serialize().toString("base64") });
  if (confirmed.status !== "confirmed") throw new Error("HTTP receipt did not confirm");
  process.stdout.write(`signed HTTP step: ${signature}\n`);
  return signature;
}

async function revokeAndClean(grant: string): Promise<number> {
  const route = `/v1/team-grants/${grant}/revoke/next`;
  const next = await api(route, { actor: founder.publicKey.toBase58() });
  assert.equal(next.status, "sign_revoke");
  await signHttpStep(next);
  let total = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const plan = await api(route, { actor: founder.publicKey.toBase58() });
    if (plan.status === "ready") return total;
    if (plan.status === "wait_for_cleanup_receipt") {
      throw new Error(`Revocation has an unconfirmed cleanup receipt: ${String(plan.receiptId)}`);
    }
    if (plan.status !== "sign_cleanup") throw new Error("Revocation returned an unexpected cleanup step");
    await signHttpStep(plan);
    total++;
  }
  throw new Error("Revocation did not finish cleanup");
}

async function denied(action: () => Promise<unknown>, label: string): Promise<void> {
  await assert.rejects(action, `${label} was still readable after cleanup`);
}

async function revoke(): Promise<void> {
  const requestId = String((BigInt(branchId) << 40n) | 42n);
  const request = paymentRequestAddress(new PublicKey(company), requester.publicKey, new BN(requestId)).toBase58();
  assert.equal((await readPaymentRequest(company, request, auth(viewer))).status, "executed");
  assert.equal((await readAgentPolicy(company, agentPolicy, auth(finance))).revoked, false);
  const managerCleaned = await revokeAndClean(managerGrant);
  await denied(() => readPaymentRequest(company, request, auth(manager)), "Manager request");
  await submit("setRequestReadersV2", founder, { request, includeRequester: true,
    includeFinance: true, manager: null, viewer: viewer.publicKey.toBase58(), viewerGrant });
  assert.equal((await readPaymentRequest(company, request, auth(requester))).status, "executed");
  const requesterCleaned = await revokeAndClean(requesterGrant);
  await denied(() => readPaymentRequest(company, request, auth(requester)), "Requester request");
  await submit("setRequestReadersV2", founder, { request, includeRequester: false,
    includeFinance: true, manager: null, viewer: viewer.publicKey.toBase58(), viewerGrant });
  assert.equal((await readPaymentRequest(company, request, auth(viewer))).status, "executed");
  const viewerCleaned = await revokeAndClean(viewerGrant);
  await denied(() => readPaymentRequest(company, request, auth(viewer)), "Viewer request");
  const financeCleaned = await revokeAndClean(financeGrant);
  await denied(() => readCompanyPolicy(company, auth(finance)), "Finance policy");
  await denied(() => readPaymentRequest(company, request, auth(finance)), "Finance request");
  await denied(() => readTreasurySnapshot(company, auth(finance)), "Finance snapshot");
  await denied(() => readAgentPolicy(company, agentPolicy, auth(finance)), "Finance AgentPolicy");
  assert.equal((await readAgentPolicy(company, agentPolicy, auth(agent))).agent,
    agent.publicKey.toBase58());
  assert.equal((await readPaymentRequest(company, request, auth(founder))).status, "executed");
  process.stdout.write(JSON.stringify({ phase: "revoke_pass", company, request,
    cleanupCounts: { manager: managerCleaned, requester: requesterCleaned,
      viewer: viewerCleaned, finance: financeCleaned },
    denied: ["manager_request", "requester_request", "viewer_request", "finance_policy",
      "finance_request", "finance_snapshot", "finance_agent_policy"] }) + "\n");
}

async function verify(): Promise<void> {
  const requestId = String((BigInt(branchId) << 40n) | 42n);
  const request = paymentRequestAddress(new PublicKey(company), requester.publicKey, new BN(requestId)).toBase58();
  const grants = [financeGrant, managerGrant, requesterGrant, viewerGrant];
  for (const address of grants) {
    const grant = await readTeamGrant(company, address, auth(founder));
    assert.equal(grant.active, false);
    assert.equal(grant.revoked, true);
  }
  for (const [signer, address] of [[finance, financeGrant], [manager, managerGrant],
    [requester, requesterGrant], [viewer, viewerGrant]] as const) {
    await denied(() => readTeamGrant(company, address, auth(signer)), "Revoked grant");
    await denied(() => readPaymentRequest(company, request, auth(signer)), "Historical request");
  }
  await denied(() => readCompanyPolicy(company, auth(finance)), "Finance company policy");
  await denied(() => readTreasurySnapshot(company, auth(finance)), "Finance treasury snapshot");
  await denied(() => readAgentPolicy(company, agentPolicy, auth(finance)), "Finance AgentPolicy");
  assert.equal((await readPaymentRequest(company, request, auth(founder))).status, "executed");
  assert.equal((await readAgentPolicy(company, agentPolicy, auth(agent))).revoked, false);
  const outsiderPath = process.env.MERCURY_TEAM_OUTSIDER_KEYPAIR;
  if (outsiderPath) {
    const outsider = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(outsiderPath, "utf8"))));
    const outsiderToken = (await getAuthToken(TEE_RPC, outsider.publicKey,
      async (message: Uint8Array) => nacl.sign.detached(message, outsider.secretKey))).token;
    await denied(() => readCompanyPolicy(company, outsiderToken), "Outsider company policy");
    await denied(() => readTreasurySnapshot(company, outsiderToken), "Outsider treasury snapshot");
    await denied(() => readPaymentRequest(company, request, outsiderToken), "Outsider request");
    await denied(() => readAgentPolicy(company, agentPolicy, outsiderToken), "Outsider AgentPolicy");
  }
  const members = await listTeamMembers(company, auth(founder));
  assert.equal(members.reduce((count, member) => count + member.grants.length, 0), 4);
  process.stdout.write(JSON.stringify({ phase: "verify_pass", company, request,
    revokedGrants: grants.length, founderCanRead: true, agentCanReadOwnPolicy: true,
    revokedMemberPrivateReads: "denied", outsiderPrivateReads: outsiderPath ? "denied" : "not_checked" }) + "\n");
}

const phase = process.argv[2];
if (phase === "setup") await setup();
else if (phase === "payment") await payment();
else if (phase === "revoke") await revoke();
else if (phase === "verify") await verify();
else throw new Error("Choose setup, payment, revoke, or verify");
