import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress, asMicroAmount, delegationStatus } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, branchScopeAddress, readCompanyPolicy,
  readTeamGrant, teamGrantAddress } from "./operations.ts";
import type { OnboardingStep } from "./onboarding.ts";
import { confirmedOnboardingStep } from "./onboarding-journal.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
type Grant = {
  company: PublicKey; grantor: PublicKey; member: PublicKey; id: anchor.BN;
  parent: PublicKey; scope: PublicKey; role: number; private_ready: boolean;
  active: boolean; revoked: boolean; may_delegate: boolean;
  per_payment_cap_micro: anchor.BN; period_cap_micro: anchor.BN; recipients: PublicKey[];
};
export type ManagerGrantObservation = {
  exists: boolean; delegated: boolean; visibleOnTee: boolean;
  permissionExists: boolean; privateReady: boolean; active: boolean;
};

export function nextManagerGrantStep(s: ManagerGrantObservation): OnboardingStep {
  if (!s.exists) return { status: "build", operation: "createGrantShell", sendTo: "base", reason: "Create the Manager grant shell" };
  if (!s.delegated) return { status: "build", operation: "delegateGrant", sendTo: "base", reason: "Delegate the grant to the company PER" };
  if (!s.visibleOnTee) return { status: "wait", operation: null, sendTo: null, reason: "Wait for the Manager grant to appear on the company PER" };
  if (!s.permissionExists) return { status: "build", operation: "initGrantPermission", sendTo: "ephemeral", reason: "Create the grant permission" };
  if (!s.privateReady) return { status: "build", operation: "activateChildGrantPrivacy", sendTo: "ephemeral", reason: "Restrict grant access before writing private limits and recipients" };
  if (!s.active) return { status: "build", operation: "configureGrant", sendTo: "ephemeral", reason: "Activate the Manager grant within Finance limits" };
  return { status: "ready", operation: null, sendTo: null, reason: "Scoped Manager approval access is active" };
}

export function assertManagerWithinFinance(args: {
  founder: string; finance: string; manager: string; parentAddress: string;
  scope: string; perCap: number; periodCap: number; recipients: string[];
  policy: Record<string, unknown>; parent: Record<string, unknown>;
}): void {
  const { founder, finance, manager, parentAddress, scope, perCap, periodCap, recipients, policy, parent } = args;
  if (policy.founder !== founder || policy.finance !== finance ||
      parent.address !== parentAddress || parent.grantor !== founder || parent.member !== finance ||
      parent.role !== 1 || parent.parent !== PublicKey.default.toBase58() ||
      parent.active !== true || parent.revoked !== false || parent.mayDelegate !== true) {
    throw new Error("An active Founder-issued Finance grant with delegation is required");
  }
  if (manager === founder || manager === finance || scope === PublicKey.default.toBase58()) {
    throw new Error("Manager and scope must be distinct, valid addresses");
  }
  if (BigInt(perCap) > BigInt(String(parent.perPaymentCapMicro)) ||
      BigInt(periodCap) > BigInt(String(parent.periodCapMicro)) ||
      (parent.scope !== PublicKey.default.toBase58() && parent.scope !== scope) ||
      recipients.some((recipient) => !(parent.recipients as string[]).includes(recipient))) {
    throw new Error("Manager grant exceeds its parent Finance grant");
  }
}

export async function inspectManagerGrant(args: {
  company: unknown; founder: unknown; finance: unknown; manager: unknown;
  grantId: unknown; parentGrant: unknown; branchId: unknown;
  perPaymentCapMicro: unknown; periodCapMicro: unknown; recipients: unknown;
  teeToken: string;
}): Promise<{ grantAddress: string; scopeAddress: string;
  observation: ManagerGrantObservation; next: OnboardingStep }> {
  if (!args.teeToken) throw new Error("Finance TEE auth token required");
  const company = new PublicKey(asAddress(args.company, "company"));
  const founder = asAddress(args.founder, "founder");
  const finance = asAddress(args.finance, "finance");
  const manager = new PublicKey(asAddress(args.manager, "manager"));
  const parentAddress = asAddress(args.parentGrant, "parentGrant");
  if (typeof args.branchId !== "number") throw new Error("branchId must be a number");
  const scope = branchScopeAddress(company, args.branchId);
  if (typeof args.grantId !== "string" || !/^\d+$/.test(args.grantId) ||
      BigInt(args.grantId) > (1n << 64n) - 1n) throw new Error("grantId must be a u64 decimal string");
  const id = new BN(args.grantId);
  const perCap = asMicroAmount(args.perPaymentCapMicro);
  const periodCap = asMicroAmount(args.periodCapMicro);
  if (perCap > periodCap) throw new Error("Manager period cap must cover one payment");
  if (!Array.isArray(args.recipients) || args.recipients.length < 1 || args.recipients.length > 16) {
    throw new Error("Manager grant needs 1 to 16 allowed recipients");
  }
  const recipients = args.recipients.map((value) => new PublicKey(asAddress(value, "recipient")));
  if (recipients.some((recipient) => recipient.equals(PublicKey.default)) ||
      new Set(recipients.map((recipient) => recipient.toBase58())).size !== recipients.length) {
    throw new Error("Manager grant recipients must be valid and unique");
  }
  const [policy, parent] = await Promise.all([
    readCompanyPolicy(company.toBase58(), args.teeToken),
    readTeamGrant(company.toBase58(), parentAddress, args.teeToken),
  ]);
  assertManagerWithinFinance({
    founder, finance, manager: manager.toBase58(), parentAddress,
    scope: scope.toBase58(), perCap, periodCap,
    recipients: recipients.map((recipient) => recipient.toBase58()), policy, parent,
  });
  const grant = teamGrantAddress(company, new PublicKey(finance), manager, id);
  const route = await delegationStatus({ account: grant.toBase58() });
  if (route.isDelegated === true &&
      (typeof route.fqdn !== "string" || new URL(route.fqdn).hostname !== new URL(TEE_RPC).hostname)) {
    throw new Error("Manager grant is delegated to a different PER validator");
  }
  const delegated = route.isDelegated === true;
  const teeUrl = new URL(TEE_RPC);
  teeUrl.searchParams.set("token", args.teeToken);
  const base = new Connection(BASE_RPC, "confirmed");
  const tee = new Connection(teeUrl.toString(), "confirmed");
  const [baseAccount, teeAccount, permission] = await Promise.all([
    base.getAccountInfo(grant),
    delegated ? tee.getAccountInfo(grant) : Promise.resolve(null),
    delegated ? tee.getAccountInfo(permissionPdaFromAccount(grant)) : Promise.resolve(null),
  ]);
  if (!baseAccount && delegated) throw new Error("Router and base disagree about grant existence");
  const account = delegated ? teeAccount : baseAccount;
  if (account && !account.owner.equals(PROGRAM_ID)) throw new Error("Manager grant has an unexpected owner");
  const data = account ? coder.decode("TeamGrant", account.data) as Grant : null;
  if (data && (!data.company.equals(company) || !data.grantor.equals(new PublicKey(finance)) ||
      !data.member.equals(manager) || !data.id.eq(id) || data.revoked ||
      (data.private_ready && !data.parent.equals(new PublicKey(parentAddress))))) {
    throw new Error("Existing Manager grant identity or parent does not match onboarding input");
  }
  if (data?.active && (data.role !== 2 || !data.scope.equals(scope) || data.may_delegate ||
      data.per_payment_cap_micro.toString() !== String(perCap) ||
      data.period_cap_micro.toString() !== String(periodCap) ||
      data.recipients.length !== recipients.length ||
      data.recipients.some((recipient, index) => !recipient.equals(recipients[index]!)))) {
    throw new Error("Existing Manager grant differs; use a new grantId for a new policy");
  }
  if (!data?.private_ready && (parent.childReaders as string[]).length >= 8) {
    throw new Error("Finance grant already has the maximum number of Manager readers");
  }
  if (!data?.private_ready && (parent.childReaders as string[]).includes(manager.toBase58())) {
    throw new Error("Manager already reads this Finance grant; use the existing active grant");
  }
  const observation: ManagerGrantObservation = {
    exists: baseAccount !== null, delegated, visibleOnTee: teeAccount !== null,
    permissionExists: permission !== null || data?.private_ready === true ||
      confirmedOnboardingStep(company.toBase58(), grant.toBase58(), "initGrantPermission"),
    privateReady: data?.private_ready === true, active: data?.active === true,
  };
  return { grantAddress: grant.toBase58(), scopeAddress: scope.toBase58(),
    observation, next: nextManagerGrantStep(observation) };
}
