import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress, delegationStatus } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, branchScopeAddress, readCompanyPolicy, teamGrantAddress } from "./operations.ts";
import { confirmedOnboardingStep } from "./onboarding-journal.ts";
import type { OnboardingStep } from "./onboarding.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
type Grant = {
  company: PublicKey; grantor: PublicKey; member: PublicKey; id: anchor.BN;
  parent: PublicKey; scope: PublicKey; role: number; private_ready: boolean;
  active: boolean; revoked: boolean; may_delegate: boolean;
  per_payment_cap_micro: anchor.BN; period_cap_micro: anchor.BN; recipients: PublicKey[];
};

export function nextMemberGrantStep(s: {
  exists: boolean; delegated: boolean; visibleOnTee: boolean;
  permissionExists: boolean; privateReady: boolean; active: boolean;
}): OnboardingStep {
  if (!s.exists) return { status: "build", operation: "createGrantShell", sendTo: "base", reason: "Create member grant shell" };
  if (!s.delegated) return { status: "build", operation: "delegateGrant", sendTo: "base", reason: "Delegate member grant" };
  if (!s.visibleOnTee) return { status: "wait", operation: null, sendTo: null, reason: "Wait for member grant on PER" };
  if (!s.permissionExists) return { status: "build", operation: "initGrantPermission", sendTo: "ephemeral", reason: "Create private grant permission" };
  if (!s.privateReady) return { status: "build", operation: "activateMemberGrantPrivacy", sendTo: "ephemeral", reason: "Restrict member grant readers" };
  if (!s.active) return { status: "build", operation: "configureGrant", sendTo: "ephemeral", reason: "Activate scoped member role" };
  return { status: "ready", operation: null, sendTo: null, reason: "Member role is active" };
}

export async function inspectMemberGrant(args: {
  company: unknown; founder: unknown; member: unknown; role: unknown;
  grantId: unknown; branchId: unknown; teeToken: string;
}): Promise<{ grantAddress: string; scopeAddress: string; next: OnboardingStep }> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = new PublicKey(asAddress(args.company, "company"));
  const founder = new PublicKey(asAddress(args.founder, "founder"));
  const member = new PublicKey(asAddress(args.member, "member"));
  if (args.role !== "requester" && args.role !== "viewer") throw new Error("role must be requester or viewer");
  if (typeof args.grantId !== "string" || !/^\d+$/.test(args.grantId) ||
      BigInt(args.grantId) > (1n << 64n) - 1n) throw new Error("grantId must be a u64 decimal string");
  const id = new BN(args.grantId);
  const scope = args.branchId === null || args.branchId === undefined ? PublicKey.default :
    branchScopeAddress(company, args.branchId as number);
  const policy = await readCompanyPolicy(company.toBase58(), args.teeToken);
  if (policy.founder !== founder.toBase58() || member.equals(founder) ||
      policy.finance === member.toBase58()) throw new Error("Member is not eligible for this grant");
  const grant = teamGrantAddress(company, founder, member, id);
  const route = await delegationStatus({ account: grant.toBase58() });
  if (route.isDelegated === true &&
      (typeof route.fqdn !== "string" || new URL(route.fqdn).hostname !== new URL(TEE_RPC).hostname)) {
    throw new Error("Member grant is delegated to a different PER validator");
  }
  const delegated = route.isDelegated === true;
  const teeUrl = new URL(TEE_RPC);
  teeUrl.searchParams.set("token", args.teeToken);
  const [baseAccount, teeAccount, permission] = await Promise.all([
    new Connection(BASE_RPC, "confirmed").getAccountInfo(grant),
    delegated ? new Connection(teeUrl.toString(), "confirmed").getAccountInfo(grant) : Promise.resolve(null),
    delegated ? new Connection(teeUrl.toString(), "confirmed").getAccountInfo(permissionPdaFromAccount(grant)) : Promise.resolve(null),
  ]);
  if (!baseAccount && delegated) throw new Error("Router and base disagree about grant existence");
  const account = delegated ? teeAccount : baseAccount;
  if (account && !account.owner.equals(PROGRAM_ID)) throw new Error("Member grant has an unexpected owner");
  const data = account ? coder.decode("TeamGrant", account.data) as Grant : null;
  if (data && (!data.company.equals(company) || !data.grantor.equals(founder) ||
      !data.member.equals(member) || !data.id.eq(id) || data.revoked ||
      (data.private_ready && !data.parent.equals(PublicKey.default)))) {
    throw new Error("Existing member grant identity differs");
  }
  if (data?.active && (data.role !== (args.role === "requester" ? 3 : 4) ||
      !data.scope.equals(scope) || data.may_delegate ||
      !data.per_payment_cap_micro.isZero() || !data.period_cap_micro.isZero() ||
      data.recipients.length !== 0)) throw new Error("Existing member grant differs; choose another grantId");
  const next = nextMemberGrantStep({
    exists: baseAccount !== null, delegated, visibleOnTee: teeAccount !== null,
    permissionExists: permission !== null || data?.private_ready === true ||
      confirmedOnboardingStep(company.toBase58(), grant.toBase58(), "initGrantPermission"),
    privateReady: data?.private_ready === true, active: data?.active === true,
  });
  return { grantAddress: grant.toBase58(), scopeAddress: scope.toBase58(), next };
}
