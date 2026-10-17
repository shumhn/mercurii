import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress, asMicroAmount, delegationStatus, teeConnection } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, readCompanyPolicy, teamGrantAddress } from "./operations.ts";
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
export type FinanceGrantObservation = {
  exists: boolean; delegated: boolean; visibleOnTee: boolean;
  permissionExists: boolean; privateReady: boolean; active: boolean;
};

export function nextFinanceGrantStep(s: FinanceGrantObservation): OnboardingStep {
  if (!s.exists) return { status: "build", operation: "prepareGrant", sendTo: "base", reason: "Create and route the Finance access record with one approval" };
  if (!s.delegated) return { status: "build", operation: "delegateGrant", sendTo: "base", reason: "Delegate the grant to the company PER" };
  if (!s.visibleOnTee) return { status: "wait", operation: null, sendTo: null, reason: "Wait for the grant to appear on the selected PER" };
  if (!s.permissionExists) return { status: "build", operation: "activateRootGrant", sendTo: "ephemeral", reason: "Protect and activate Finance access with one approval" };
  if (!s.privateReady) return { status: "build", operation: "activateRootGrantPrivacy", sendTo: "ephemeral", reason: "Make the grant private before writing recipients or caps" };
  if (!s.active) return { status: "build", operation: "configureGrant", sendTo: "ephemeral", reason: "Activate the Finance grant within company limits" };
  return { status: "ready", operation: null, sendTo: null, reason: "Scoped Finance access is active" };
}

function grantId(value: unknown): anchor.BN {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > (1n << 64n) - 1n) {
    throw new Error("grantId must be a u64 decimal string");
  }
  return new BN(value);
}

export async function inspectRootFinanceGrant(args: {
  company: unknown; founder: unknown; finance: unknown; grantId: unknown;
  perPaymentCapMicro: unknown; periodCapMicro: unknown; recipients: unknown; mayDelegate: unknown;
  teeToken: string;
}): Promise<{ grantAddress: string; observation: FinanceGrantObservation; next: OnboardingStep }> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = new PublicKey(asAddress(args.company, "company"));
  const founder = new PublicKey(asAddress(args.founder, "founder"));
  const finance = new PublicKey(asAddress(args.finance, "finance"));
  const id = grantId(args.grantId);
  const perCap = asMicroAmount(args.perPaymentCapMicro);
  const periodCap = asMicroAmount(args.periodCapMicro);
  if (perCap > periodCap) throw new Error("Finance period cap must cover one payment");
  if (!Array.isArray(args.recipients) || args.recipients.length < 1 || args.recipients.length > 16) {
    throw new Error("Finance grant needs 1 to 16 allowed recipients");
  }
  const recipients = args.recipients.map((value) => new PublicKey(asAddress(value, "recipient")));
  if (new Set(recipients.map((value) => value.toBase58())).size !== recipients.length) {
    throw new Error("Finance grant recipients must be unique");
  }
  if (typeof args.mayDelegate !== "boolean") throw new Error("mayDelegate must be boolean");
  const policy = await readCompanyPolicy(company.toBase58(), args.teeToken);
  if (policy.founder !== founder.toBase58() || policy.finance !== finance.toBase58()) {
    throw new Error("Founder or Finance does not match the private company policy");
  }
  if (BigInt(periodCap) > BigInt(String(policy.monthlyLimitMicro))) {
    throw new Error("Finance period cap exceeds the company limit");
  }
  const grant = teamGrantAddress(company, founder, finance, id);
  const route = await delegationStatus({ account: grant.toBase58() });
  if (route.isDelegated === true &&
      (typeof route.fqdn !== "string" || new URL(route.fqdn).hostname !== new URL(TEE_RPC).hostname)) {
    throw new Error("Grant is delegated to a different PER validator");
  }
  const delegated = route.isDelegated === true;
  const base = new Connection(BASE_RPC, "confirmed");
  const tee = teeConnection(args.teeToken);
  const [baseAccount, teeAccount, permission] = await Promise.all([
    base.getAccountInfo(grant),
    delegated ? tee.getAccountInfo(grant) : Promise.resolve(null),
    delegated ? tee.getAccountInfo(permissionPdaFromAccount(grant)) : Promise.resolve(null),
  ]);
  if (!baseAccount && delegated) throw new Error("Router and base disagree about grant existence");
  const account = delegated ? teeAccount : baseAccount;
  if (account && !account.owner.equals(PROGRAM_ID)) throw new Error("Grant has an unexpected owner");
  const data = account ? coder.decode("TeamGrant", account.data) as Grant : null;
  if (data && (!data.company.equals(company) || !data.grantor.equals(founder) ||
      !data.member.equals(finance) || !data.id.eq(id) ||
      (data.private_ready && (!data.parent.equals(PublicKey.default) || data.revoked)))) {
    throw new Error("Existing Finance grant identity or state does not match onboarding input");
  }
  if (data?.active && (data.role !== 1 || !data.scope.equals(PublicKey.default) ||
      data.per_payment_cap_micro.toString() !== String(perCap) ||
      data.period_cap_micro.toString() !== String(periodCap) ||
      data.may_delegate !== args.mayDelegate ||
      data.recipients.length !== recipients.length ||
      data.recipients.some((recipient, index) => !recipient.equals(recipients[index]!)))) {
    throw new Error("Existing Finance grant differs; use a new grantId for a new policy");
  }
  const observation: FinanceGrantObservation = {
    exists: baseAccount !== null, delegated, visibleOnTee: teeAccount !== null,
    permissionExists: permission !== null || data?.private_ready === true ||
      confirmedOnboardingStep(company.toBase58(), grant.toBase58(), "initGrantPermission"),
    privateReady: data?.private_ready === true, active: data?.active === true,
  };
  return { grantAddress: grant.toBase58(), observation, next: nextFinanceGrantStep(observation) };
}
