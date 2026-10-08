import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET_USDC, asAddress, asMicroAmount, canonicalTokenAccount } from "./magicblock.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
export const PROGRAM_ID = new PublicKey(idl.address);
export const BASE_RPC = "https://rpc.magicblock.app/devnet";
export const TEE_RPC = "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

type BuildInput = Record<string, unknown> & { operation: string; actor: string };

function pub(value: unknown, label: string): PublicKey {
  return new PublicKey(asAddress(value, label));
}

function asId(value: unknown): anchor.BN {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("requestId must be a decimal string");
  const id = BigInt(value);
  if (id > (1n << 64n) - 1n) throw new Error("requestId exceeds u64");
  return new anchor.BN(value);
}

function positiveMicro(value: unknown): anchor.BN {
  return new anchor.BN(asMicroAmount(value));
}

export function paymentRequestAddress(company: PublicKey, requester: PublicKey, id: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("payment-request"), company.toBuffer(), requester.toBuffer(), id.toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID)[0];
}

function agentAddress(company: PublicKey, founder: PublicKey, agent: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("agent-policy"), founder.toBuffer(), company.toBuffer(), agent.toBuffer(),
  ], PROGRAM_ID)[0];
}

export function snapshotAddress(company: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("treasury-snapshot"), company.toBuffer()], PROGRAM_ID)[0];
}

export function teamGrantAddress(company: PublicKey, grantor: PublicKey, member: PublicKey, id: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from("team-grant"), company.toBuffer(), grantor.toBuffer(), member.toBuffer(), id.toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID)[0];
}

export function branchScopeAddress(company: PublicKey, branchId: number): PublicKey {
  if (!Number.isInteger(branchId) || branchId < 1 || branchId > 0xff_ffff) {
    throw new Error("branchId must be an integer from 1 to 16777215");
  }
  const bytes = Buffer.from([branchId & 255, (branchId >>> 8) & 255, (branchId >>> 16) & 255]);
  return PublicKey.findProgramAddressSync([Buffer.from("branch-scope"), company.toBuffer(), bytes], PROGRAM_ID)[0];
}

export function requestBranchScope(company: PublicKey, requestId: string): PublicKey {
  if (!/^\d+$/.test(requestId)) throw new Error("requestId must be a decimal string");
  const branchId = Number(BigInt(requestId) >> 40n);
  return branchScopeAddress(company, branchId);
}

async function readPrivateAccount<T>(address: PublicKey, name: string, teeToken: string): Promise<T> {
  if (!teeToken) throw new Error("TEE auth token required");
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", teeToken);
  const account = await new Connection(endpoint.toString(), "confirmed").getAccountInfo(address);
  if (!account || !account.owner.equals(PROGRAM_ID)) throw new Error(`Private ${name} unavailable`);
  return new anchor.BorshAccountsCoder(idl).decode(name, account.data) as T;
}

export async function readCompanyPolicy(companyAddress: string, teeToken: string): Promise<Record<string, unknown>> {
  const company = pub(companyAddress, "company");
  const data = await readPrivateAccount<{
    founder: PublicKey; finance: PublicKey; mint: PublicKey; private_ready: boolean;
    monthly_limit_micro: anchor.BN; agent_cap_micro: anchor.BN; period: anchor.BN;
    spent_micro: anchor.BN; reserved_micro: anchor.BN; version: anchor.BN;
  }>(company, "CompanyPolicy", teeToken);
  if (!data.private_ready) throw new Error("Company privacy is not active");
  return {
    address: company.toBase58(), founder: data.founder.toBase58(), finance: data.finance.toBase58(),
    mint: data.mint.toBase58(), monthlyLimitMicro: data.monthly_limit_micro.toString(),
    agentCapMicro: data.agent_cap_micro.toString(), period: data.period.toString(),
    spentMicro: data.spent_micro.toString(), reservedMicro: data.reserved_micro.toString(),
    version: data.version.toString(),
  };
}

export async function readTeamGrant(companyAddress: string, grantAddress: string, teeToken: string): Promise<Record<string, unknown>> {
  const company = pub(companyAddress, "company");
  const grant = pub(grantAddress, "grant");
  const data = await readPrivateAccount<{
    company: PublicKey; grantor: PublicKey; member: PublicKey; id: anchor.BN;
    parent: PublicKey; scope: PublicKey; role: number; private_ready: boolean;
    active: boolean; revoked: boolean; may_delegate: boolean; per_payment_cap_micro: anchor.BN;
    period_cap_micro: anchor.BN; period: anchor.BN; spent_micro: anchor.BN;
    approved_micro: anchor.BN; recipients: PublicKey[]; child_readers: PublicKey[];
  }>(grant, "TeamGrant", teeToken);
  if (!data.company.equals(company) || !data.private_ready) throw new Error("Grant is not private for this company");
  return {
    address: grant.toBase58(), company: data.company.toBase58(),
    grantor: data.grantor.toBase58(), member: data.member.toBase58(), id: data.id.toString(),
    parent: data.parent.toBase58(), scope: data.scope.toBase58(), role: data.role,
    active: data.active, revoked: data.revoked, mayDelegate: data.may_delegate,
    perPaymentCapMicro: data.per_payment_cap_micro.toString(),
    periodCapMicro: data.period_cap_micro.toString(), period: data.period.toString(),
    spentMicro: data.spent_micro.toString(), approvedMicro: data.approved_micro.toString(),
    recipients: data.recipients.map((item) => item.toBase58()),
    childReaders: data.child_readers.map((item) => item.toBase58()),
  };
}

export async function readPaymentRequest(companyAddress: string, requestAddress: string, teeToken: string): Promise<Record<string, unknown>> {
  const company = pub(companyAddress, "company");
  const request = pub(requestAddress, "request");
  const data = await readPrivateAccount<{
    company: PublicKey; requester: PublicKey; id: anchor.BN; private_ready: boolean;
    recipient: PublicKey; amount_micro: anchor.BN; status: number; approved_period: anchor.BN;
  }>(request, "PaymentRequest", teeToken);
  if (!data.company.equals(company) || !data.private_ready) throw new Error("Request is not active for this company");
  return {
    address: request.toBase58(), requester: data.requester.toBase58(), id: data.id.toString(),
    recipient: data.recipient.toBase58(), amountMicro: data.amount_micro.toString(),
    status: ["empty", "submitted", "approved", "executed", "rejected"][data.status] ?? "unknown",
    approvedPeriod: data.approved_period.toString(),
  };
}

export function paymentStatusFromRequest(request: Record<string, unknown>): Record<string, unknown> {
  const status = request.status;
  if (typeof status !== "string" || !["empty", "submitted", "approved", "executed", "rejected"].includes(status)) {
    throw new Error("Unknown private payment request status");
  }
  return {
    requestAddress: request.address,
    status,
    recipient: request.recipient,
    amountMicro: request.amountMicro,
    paymentSettled: status === "executed",
    evidence: "Mercury private request state; executed is written atomically with its SPL token transfer",
  };
}

export function paymentExecutionAccounts(companyAddress: string, actorAddress: string,
  policy: Record<string, unknown>, request: Record<string, unknown>): {
    recipient: string; amountMicro: string; treasuryToken: string; recipientToken: string;
  } {
  const company = asAddress(companyAddress, "company");
  const actor = asAddress(actorAddress, "actor");
  if (policy.address !== company || (policy.finance !== actor && policy.founder !== actor)) {
    throw new Error("Founder or Finance must act for the configured company");
  }
  if (policy.mint !== DEVNET_USDC) throw new Error("Payment builder requires Circle devnet USDC policy");
  if (request.status !== "approved") throw new Error("Payment request is not approved");
  if (request.approvedPeriod !== policy.period) throw new Error("Payment approval belongs to another budget period");
  const recipient = asAddress(request.recipient, "recipient");
  const amountMicro = String(request.amountMicro);
  if (!/^\d+$/.test(amountMicro) || BigInt(amountMicro) === 0n) throw new Error("Invalid approved payment amount");
  if (BigInt(String(policy.reservedMicro)) < BigInt(amountMicro)) throw new Error("Budget reservation is missing");
  return {
    recipient, amountMicro,
    treasuryToken: canonicalTokenAccount(company, DEVNET_USDC),
    recipientToken: canonicalTokenAccount(recipient, DEVNET_USDC),
  };
}

export async function readAgentPolicy(companyAddress: string, agentPolicyAddress: string, teeToken: string): Promise<Record<string, unknown>> {
  const company = pub(companyAddress, "company");
  const agentPolicy = pub(agentPolicyAddress, "agentPolicy");
  const data = await readPrivateAccount<{
    company: PublicKey; founder: PublicKey; finance: PublicKey; agent: PublicKey; mint: PublicKey;
    private_ready: boolean; revoked: boolean; allowed_recipient: PublicKey;
    per_payment_cap_micro: anchor.BN; period_cap_micro: anchor.BN; period: anchor.BN; spent_micro: anchor.BN;
  }>(agentPolicy, "AgentPolicy", teeToken);
  if (!data.company.equals(company) || !data.private_ready) throw new Error("Agent policy is not active for this company");
  return {
    address: agentPolicy.toBase58(), company: data.company.toBase58(),
    founder: data.founder.toBase58(), finance: data.finance.toBase58(),
    agent: data.agent.toBase58(), mint: data.mint.toBase58(), revoked: data.revoked,
    allowedRecipient: data.allowed_recipient.toBase58(),
    perPaymentCapMicro: data.per_payment_cap_micro.toString(), periodCapMicro: data.period_cap_micro.toString(),
    period: data.period.toString(), spentMicro: data.spent_micro.toString(),
  };
}

export function agentPaymentAccounts(companyAddress: string, actorAddress: string,
  policy: Record<string, unknown>, amountInput: unknown): {
    amountMicro: number; recipient: string; agentFloatToken: string; recipientToken: string;
  } {
  const company = asAddress(companyAddress, "company");
  const actor = asAddress(actorAddress, "actor");
  if (policy.company !== company || policy.agent !== actor) throw new Error("Agent is not authorized for this company");
  if (policy.revoked !== false) throw new Error("Agent policy is revoked");
  if (policy.mint !== DEVNET_USDC) throw new Error("Agent payment requires Circle devnet USDC policy");
  const amountMicro = asMicroAmount(amountInput);
  if (BigInt(amountMicro) > BigInt(String(policy.perPaymentCapMicro)) ||
      BigInt(amountMicro) > BigInt(String(policy.periodCapMicro))) {
    throw new Error("Agent payment exceeds its onchain cap");
  }
  const recipient = asAddress(policy.allowedRecipient, "allowedRecipient");
  return {
    amountMicro, recipient,
    agentFloatToken: canonicalTokenAccount(policy.address, DEVNET_USDC),
    recipientToken: canonicalTokenAccount(recipient, DEVNET_USDC),
  };
}

export async function readTreasurySnapshot(companyAddress: string, teeToken: string): Promise<{
  address: string; mint: string; balanceMicro: string; updatedSlot: string;
}> {
  const company = pub(companyAddress, "company");
  const snapshot = snapshotAddress(company);
  const data = await readPrivateAccount<{
    company: PublicKey; mint: PublicKey; private_ready: boolean; balance_micro: anchor.BN; updated_slot: anchor.BN;
  }>(snapshot, "TreasurySnapshot", teeToken);
  if (!data.company.equals(company) || !data.private_ready || data.updated_slot.isZero()) {
    throw new Error("Private treasury snapshot has not been synchronized");
  }
  return {
    address: snapshot.toBase58(), mint: data.mint.toBase58(),
    balanceMicro: data.balance_micro.toString(), updatedSlot: data.updated_slot.toString(),
  };
}

function aclAccounts(account: PublicKey): Record<string, PublicKey> {
  return {
    permission: permissionPdaFromAccount(account),
    permissionProgram: PERMISSION_PROGRAM_ID,
    ephemeralVault: EPHEMERAL_VAULT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
  };
}

const privateOperations = new Set([
  "initCompanyPermission", "activateCompanyPrivacy", "configureLimits",
  "initRequestPermission", "activateRequestPrivacy", "submitPayment", "approvePayment", "rejectPayment", "executePayment",
  "initAgentPermission", "activateAgentPrivacy", "configureAgent", "fundAgentFloat", "agentPay", "revokeAgent", "reclaimAgentFloat",
  "initSnapshotPermission", "activateSnapshotPrivacy", "syncTreasurySnapshot",
  "setSnapshotReaders", "setRequestReaders", "setRequestReadersV2",
  "initGrantPermission", "activateRootGrantPrivacy", "activateMemberGrantPrivacy", "activateChildGrantPrivacy", "restorePolicyReaders", "configureGrant", "revokeGrant",
]);

export async function buildOperation(input: BuildInput, config: {
  company: string;
  founder: string;
  teeToken?: string;
  baseRpc?: string;
  teeRpc?: string;
}): Promise<{ status: "unsigned"; operation: string; transactionBase64: string; requiredSigners: string[]; sendTo: "base" | "ephemeral"; sendRpcEndpoint: string }> {
  const actor = pub(input.actor, "actor");
  const company = pub(config.company, "company");
  const founder = pub(config.founder, "founder");
  const privateOp = privateOperations.has(input.operation);
  if (privateOp && !config.teeToken) throw new Error("TEE auth token required for private operation");
  const endpoint = new URL(privateOp ? (config.teeRpc ?? TEE_RPC) : (config.baseRpc ?? BASE_RPC));
  if (privateOp) endpoint.searchParams.set("token", config.teeToken!);
  const connection = new Connection(endpoint.toString(), "confirmed");
  const readOnlyWallet = {
    publicKey: actor,
    signTransaction: async () => { throw new Error("Mercury backend never signs transactions"); },
    signAllTransactions: async () => { throw new Error("Mercury backend never signs transactions"); },
  } as unknown as anchor.Wallet;
  const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" }));
  let tx: Transaction;
  switch (input.operation) {
    case "initializeCompany": {
      if (!actor.equals(founder)) throw new Error("Only the configured founder can initialize this company");
      const expectedCompany = PublicKey.findProgramAddressSync(
        [Buffer.from("company-policy"), founder.toBuffer()], PROGRAM_ID,
      )[0];
      if (!company.equals(expectedCompany)) throw new Error("Configured company does not match founder policy PDA");
      tx = await program.methods.initializeCompany(pub(input.finance, "finance"), pub(input.mint, "mint"))
        .accountsPartial({ founder: actor, policy: company, systemProgram: SystemProgram.programId }).transaction();
      break;
    }
    case "createSnapshotShell": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.createSnapshotShell(company).accountsPartial({
        founder: actor, snapshot, systemProgram: SystemProgram.programId,
      }).transaction();
      break;
    }
    case "delegateSnapshot": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.delegateSnapshot(company).accountsPartial({ founder: actor, snapshot, validator: TEE_VALIDATOR }).transaction();
      break;
    }
    case "initSnapshotPermission": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.initSnapshotPermission().accountsPartial({ founder: actor, snapshot, ...aclAccounts(snapshot) }).transaction();
      break;
    }
    case "activateSnapshotPrivacy": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.activateSnapshotPrivacy(input.includeFinance !== false)
        .accountsPartial({ founder: actor, policy: company, snapshot, ...aclAccounts(snapshot) }).transaction();
      break;
    }
    case "setSnapshotReaders": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.setSnapshotReaders(input.includeFinance === true).accountsPartial({
        founder: actor, policy: company, snapshot, ...aclAccounts(snapshot),
      }).transaction();
      break;
    }
    case "syncTreasurySnapshot": {
      const snapshot = snapshotAddress(company);
      tx = await program.methods.syncTreasurySnapshot().accountsPartial({
        actor, policy: company, snapshot,
        grant: input.grant ? pub(input.grant, "grant") : PROGRAM_ID,
        treasuryToken: pub(input.treasuryToken, "treasuryToken"),
      }).transaction();
      break;
    }
    case "delegateCompany":
      tx = await program.methods.delegatePolicy().accountsPartial({ founder: actor, policy: company, validator: TEE_VALIDATOR }).transaction();
      break;
    case "initCompanyPermission":
      tx = await program.methods.initPermission().accountsPartial({ founder: actor, policy: company, ...aclAccounts(company) }).transaction();
      break;
    case "activateCompanyPrivacy":
      tx = await program.methods.activatePrivacy().accountsPartial({ founder: actor, policy: company, ...aclAccounts(company) }).transaction();
      break;
    case "configureLimits":
      tx = await program.methods.configureLimits(positiveMicro(input.monthlyLimitMicro), positiveMicro(input.agentCapMicro))
        .accountsPartial({ founder: actor, policy: company }).transaction();
      break;
    case "createGrantShell": {
      const member = pub(input.member, "member");
      const id = asId(input.grantId);
      const grant = teamGrantAddress(company, actor, member, id);
      tx = await program.methods.createGrantShell(company, member, id).accountsPartial({
        grantor: actor, grant, systemProgram: SystemProgram.programId,
      }).transaction();
      break;
    }
    case "delegateGrant": {
      const member = pub(input.member, "member");
      const id = asId(input.grantId);
      const grant = teamGrantAddress(company, actor, member, id);
      tx = await program.methods.delegateGrant(company, member, id).accountsPartial({
        grantor: actor, grant, validator: TEE_VALIDATOR,
      }).transaction();
      break;
    }
    case "initGrantPermission": {
      const grant = pub(input.grant, "grant");
      tx = await program.methods.initGrantPermission().accountsPartial({
        grantor: actor, grant, ...aclAccounts(grant),
      }).transaction();
      break;
    }
    case "activateRootGrantPrivacy": {
      const grant = pub(input.grant, "grant");
      tx = await program.methods.activateRootGrantPrivacy().accountsPartial({
        founder: actor, policy: company, grant, ...aclAccounts(grant),
        policyPermission: permissionPdaFromAccount(company),
      }).transaction();
      break;
    }
    case "activateMemberGrantPrivacy": {
      const grant = pub(input.grant, "grant");
      tx = await program.methods.activateMemberGrantPrivacy().accountsPartial({
        founder: actor, policy: company, grant, ...aclAccounts(grant),
        policyPermission: permissionPdaFromAccount(company),
      }).transaction();
      break;
    }
    case "restorePolicyReaders": {
      const grant = pub(input.grant, "grant");
      tx = await program.methods.restorePolicyReaders().accountsPartial({
        founder: actor, policy: company, grant, ...aclAccounts(grant),
        policyPermission: permissionPdaFromAccount(company),
      }).transaction();
      break;
    }
    case "activateChildGrantPrivacy": {
      const grant = pub(input.grant, "grant");
      const parent = pub(input.parentGrant, "parentGrant");
      tx = await program.methods.activateChildGrantPrivacy().accountsPartial({
        grantor: actor, policy: company, grant, parent,
        ...aclAccounts(grant), parentPermission: permissionPdaFromAccount(parent),
        policyPermission: permissionPdaFromAccount(company),
      }).transaction();
      break;
    }
    case "configureGrant": {
      const grant = pub(input.grant, "grant");
      const parent = input.parentGrant ? pub(input.parentGrant, "parentGrant") : PROGRAM_ID;
      if (!Array.isArray(input.recipients)) throw new Error("recipients must be an array");
      const recipients = input.recipients.map((item) => pub(item, "recipient"));
      const role = input.role === "finance" ? 1 : input.role === "manager" ? 2 :
        input.role === "requester" ? 3 : input.role === "viewer" ? 4 : 0;
      if (role === 0) throw new Error("role must be finance, manager, requester, or viewer");
      tx = await program.methods.configureGrant(
        role, input.scope ? pub(input.scope, "scope") : PublicKey.default,
        role >= 3 ? new anchor.BN(0) : positiveMicro(input.perPaymentCapMicro),
        role >= 3 ? new anchor.BN(0) : positiveMicro(input.periodCapMicro),
        recipients, input.mayDelegate === true,
      ).accountsPartial({ grantor: actor, policy: company, grant, parent }).transaction();
      break;
    }
    case "revokeGrant": {
      const grant = pub(input.grant, "grant");
      const parent = input.parentGrant ? pub(input.parentGrant, "parentGrant") : PROGRAM_ID;
      tx = await program.methods.revokeGrant().accountsPartial({
        authority: actor, policy: company, grant, parent,
        ...aclAccounts(grant), parentPermission: parent.equals(PROGRAM_ID) ? PROGRAM_ID : permissionPdaFromAccount(parent),
        policyPermission: permissionPdaFromAccount(company),
      }).transaction();
      break;
    }
    case "createRequestShell": {
      const id = asId(input.requestId);
      const request = paymentRequestAddress(company, actor, id);
      tx = await program.methods.createRequestShell(company, id).accountsPartial({ request, requester: actor, systemProgram: SystemProgram.programId }).transaction();
      break;
    }
    case "delegateRequest": {
      const id = asId(input.requestId);
      const request = paymentRequestAddress(company, actor, id);
      tx = await program.methods.delegateRequest(company, id).accountsPartial({ request, requester: actor, validator: TEE_VALIDATOR }).transaction();
      break;
    }
    case "initRequestPermission": {
      const request = pub(input.request, "request");
      tx = await program.methods.initRequestPermission().accountsPartial({ requester: actor, request, ...aclAccounts(request) }).transaction();
      break;
    }
    case "activateRequestPrivacy": {
      const request = pub(input.request, "request");
      tx = await program.methods.activateRequestPrivacy(
        input.includeFinance !== false, input.manager ? pub(input.manager, "manager") : PublicKey.default,
      )
        .accountsPartial({ founder: actor, policy: company, request,
          requesterGrant: input.requesterGrant ? pub(input.requesterGrant, "requesterGrant") : PROGRAM_ID,
          ...aclAccounts(request) }).transaction();
      break;
    }
    case "setRequestReaders": {
      const request = pub(input.request, "request");
      tx = await program.methods.setRequestReaders(
        input.includeFinance === true,
        input.manager ? pub(input.manager, "manager") : PublicKey.default,
      ).accountsPartial({ founder: actor, policy: company, request,
        requesterGrant: PROGRAM_ID, ...aclAccounts(request) }).transaction();
      break;
    }
    case "setRequestReadersV2": {
      const request = pub(input.request, "request");
      tx = await program.methods.setRequestReadersV2(
        input.includeRequester === true, input.includeFinance === true,
        input.manager ? pub(input.manager, "manager") : PublicKey.default,
        input.viewer ? pub(input.viewer, "viewer") : PublicKey.default,
      ).accountsPartial({ founder: actor, policy: company, request,
        viewerGrant: input.viewerGrant ? pub(input.viewerGrant, "viewerGrant") : PROGRAM_ID,
        ...aclAccounts(request) }).transaction();
      break;
    }
    case "submitPayment":
      tx = await program.methods.submitPayment(pub(input.recipient, "recipient"), positiveMicro(input.amountMicro))
        .accountsPartial({ requester: actor, policy: company, request: pub(input.request, "request"),
          requesterGrant: input.requesterGrant ? pub(input.requesterGrant, "requesterGrant") : PROGRAM_ID }).transaction();
      break;
    case "approvePayment":
    case "rejectPayment":
      tx = await program.methods[input.operation]().accountsPartial({
        actor, policy: company, request: pub(input.request, "request"),
        grant: input.grant ? pub(input.grant, "grant") : PROGRAM_ID,
        parentGrant: input.parentGrant ? pub(input.parentGrant, "parentGrant") : PROGRAM_ID,
      }).transaction();
      break;
    case "executePayment":
      tx = await program.methods.executePayment().accountsPartial({
        actor, policy: company, request: pub(input.request, "request"),
        grant: input.grant ? pub(input.grant, "grant") : PROGRAM_ID,
        treasuryToken: pub(input.treasuryToken, "treasuryToken"), recipientToken: pub(input.recipientToken, "recipientToken"),
        tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      }).transaction();
      break;
    case "createAgentShell": {
      const agent = pub(input.agent, "agent");
      const agentPolicy = agentAddress(company, founder, agent);
      tx = await program.methods.createAgentShell(company, agent).accountsPartial({ founder: actor, agentPolicy, systemProgram: SystemProgram.programId }).transaction();
      break;
    }
    case "delegateAgent": {
      const agent = pub(input.agent, "agent");
      const agentPolicy = agentAddress(company, founder, agent);
      tx = await program.methods.delegateAgent(company, agent).accountsPartial({ founder: actor, agentPolicy, validator: TEE_VALIDATOR }).transaction();
      break;
    }
    case "initAgentPermission": {
      const agentPolicy = pub(input.agentPolicy, "agentPolicy");
      tx = await program.methods.initAgentPermission().accountsPartial({ founder: actor, agentPolicy, ...aclAccounts(agentPolicy) }).transaction();
      break;
    }
    case "activateAgentPrivacy":
    case "revokeAgent": {
      const agentPolicy = pub(input.agentPolicy, "agentPolicy");
      tx = await program.methods[input.operation]().accountsPartial({ founder: actor, policy: company, agentPolicy, ...aclAccounts(agentPolicy) }).transaction();
      break;
    }
    case "configureAgent":
      tx = await program.methods.configureAgent(pub(input.recipient, "recipient"), positiveMicro(input.perPaymentCapMicro), positiveMicro(input.periodCapMicro))
        .accountsPartial({ founder: actor, agentPolicy: pub(input.agentPolicy, "agentPolicy") }).transaction();
      break;
    case "fundAgentFloat":
    case "reclaimAgentFloat":
      tx = await program.methods[input.operation](positiveMicro(input.amountMicro)).accountsPartial({
        founder: actor, policy: company, agentPolicy: pub(input.agentPolicy, "agentPolicy"),
        treasuryToken: pub(input.treasuryToken, "treasuryToken"), agentFloatToken: pub(input.agentFloatToken, "agentFloatToken"),
        tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      }).transaction();
      break;
    case "agentPay":
      tx = await program.methods.agentPay(positiveMicro(input.amountMicro)).accountsPartial({
        agent: actor, agentPolicy: pub(input.agentPolicy, "agentPolicy"),
        agentFloatToken: pub(input.agentFloatToken, "agentFloatToken"), recipientToken: pub(input.recipientToken, "recipientToken"),
        tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      }).transaction();
      break;
    default:
      throw new Error("Unsupported Mercury operation");
  }
  tx.feePayer = actor;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return {
    status: "unsigned", operation: input.operation,
    transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    requiredSigners: [actor.toBase58()],
    sendTo: privateOp ? "ephemeral" : "base",
    sendRpcEndpoint: privateOp ? (config.teeRpc ?? TEE_RPC) : (config.baseRpc ?? BASE_RPC),
  };
}
