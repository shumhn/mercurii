import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET_USDC, asAddress, asMicroAmount, delegationStatus, teeConnection } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, snapshotAddress } from "./operations.ts";
import { confirmedOnboardingStep } from "./onboarding-journal.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);

type Policy = {
  founder: PublicKey; finance: PublicKey; mint: PublicKey; private_ready: boolean;
  monthly_limit_micro: anchor.BN; agent_cap_micro: anchor.BN;
};
type Snapshot = { company: PublicKey; private_ready: boolean };
export type OnboardingStep = {
  status: "build" | "wait" | "ready";
  operation: string | null;
  sendTo: "base" | "ephemeral" | null;
  reason: string;
};
export type OnboardingObservation = {
  companyExists: boolean; companyDelegated: boolean; companyVisibleOnTee: boolean;
  companyPermissionExists: boolean; companyPrivate: boolean; limitsMatch: boolean;
  snapshotExists: boolean; snapshotDelegated: boolean; snapshotVisibleOnTee: boolean;
  snapshotPermissionExists: boolean; snapshotPrivate: boolean;
};

const baseStep = (operation: string, reason: string): OnboardingStep => ({ status: "build", operation, sendTo: "base", reason });
const teeStep = (operation: string, reason: string): OnboardingStep => ({ status: "build", operation, sendTo: "ephemeral", reason });
const waitStep = (reason: string): OnboardingStep => ({ status: "wait", operation: null, sendTo: null, reason });

export function nextOnboardingStep(s: OnboardingObservation): OnboardingStep {
  if (!s.companyExists) return baseStep("initializeCompany", "Create the public company shell without private limits");
  if (!s.companyDelegated) return baseStep("delegateCompany", "Delegate the company shell to the selected PER");
  if (!s.companyVisibleOnTee) return waitStep("Wait for company state to appear on the selected PER");
  if (!s.companyPermissionExists) return teeStep("initCompanyPermission", "Create the ER-local company permission");
  if (!s.companyPrivate) return teeStep("activateCompanyPrivacy", "Make company state private before storing limits");
  if (!s.limitsMatch) return teeStep("configureLimits", "Set private company spending limits");
  if (!s.snapshotExists) return baseStep("createSnapshotShell", "Create the public balance snapshot shell");
  if (!s.snapshotDelegated) return baseStep("delegateSnapshot", "Delegate the snapshot shell to the selected PER");
  if (!s.snapshotVisibleOnTee) return waitStep("Wait for snapshot state to appear on the selected PER");
  if (!s.snapshotPermissionExists) return teeStep("initSnapshotPermission", "Create the ER-local snapshot permission");
  if (!s.snapshotPrivate) return teeStep("activateSnapshotPrivacy", "Restrict the snapshot to authorized readers");
  return { status: "ready", operation: null, sendTo: null, reason: "Company policy and snapshot are private; fund the treasury through private receive, then sync its snapshot" };
}

function decode<T>(account: { owner: PublicKey; data: Buffer } | null, name: string): T | null {
  if (!account) return null;
  if (!account.owner.equals(PROGRAM_ID)) throw new Error(`${name} has an unexpected owner on the selected chain`);
  return coder.decode(name, account.data) as T;
}

function assertSelectedTee(status: Record<string, unknown>): void {
  if (status.isDelegated !== true) return;
  if (typeof status.fqdn !== "string" || new URL(status.fqdn).hostname !== new URL(TEE_RPC).hostname) {
    throw new Error("Account is delegated to a different PER validator");
  }
}

export async function inspectCompanyOnboarding(args: {
  company: unknown; founder: unknown; finance: unknown; mint: unknown;
  monthlyLimitMicro: unknown; agentCapMicro: unknown; teeToken: string;
}): Promise<{ companyAddress: string; snapshotAddress: string; observation: OnboardingObservation; next: OnboardingStep }> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const founder = new PublicKey(asAddress(args.founder, "founder"));
  const finance = new PublicKey(asAddress(args.finance, "finance"));
  const mint = new PublicKey(asAddress(args.mint, "mint"));
  if (!mint.equals(new PublicKey(DEVNET_USDC))) throw new Error("Onboarding currently supports Circle devnet USDC only");
  const monthlyLimitMicro = asMicroAmount(args.monthlyLimitMicro);
  const agentCapMicro = asMicroAmount(args.agentCapMicro);
  if (agentCapMicro > monthlyLimitMicro) throw new Error("Agent cap cannot exceed the company limit");
  const company = new PublicKey(asAddress(args.company, "company"));
  const derivedCompany = PublicKey.findProgramAddressSync([Buffer.from("company-policy"), founder.toBuffer()], PROGRAM_ID)[0];
  if (!company.equals(derivedCompany)) throw new Error("Company does not match the Founder policy PDA");
  const snapshot = snapshotAddress(company);
  const base = new Connection(BASE_RPC, "confirmed");
  const tee = teeConnection(args.teeToken);
  const [baseCompany, baseSnapshot, companyRoute, snapshotRoute] = await Promise.all([
    base.getAccountInfo(company), base.getAccountInfo(snapshot),
    delegationStatus({ account: company.toBase58() }), delegationStatus({ account: snapshot.toBase58() }),
  ]);
  assertSelectedTee(companyRoute);
  assertSelectedTee(snapshotRoute);
  if (!baseCompany && companyRoute.isDelegated === true) throw new Error("Router and base disagree about company existence");
  if (!baseSnapshot && snapshotRoute.isDelegated === true) throw new Error("Router and base disagree about snapshot existence");
  const companyDelegated = companyRoute.isDelegated === true;
  const snapshotDelegated = snapshotRoute.isDelegated === true;
  const [teeCompany, teeSnapshot, companyPermission, snapshotPermission] = await Promise.all([
    companyDelegated ? tee.getAccountInfo(company) : Promise.resolve(null),
    snapshotDelegated ? tee.getAccountInfo(snapshot) : Promise.resolve(null),
    companyDelegated ? tee.getAccountInfo(permissionPdaFromAccount(company)) : Promise.resolve(null),
    snapshotDelegated ? tee.getAccountInfo(permissionPdaFromAccount(snapshot)) : Promise.resolve(null),
  ]);
  const policy = decode<Policy>(companyDelegated ? teeCompany : baseCompany, "CompanyPolicy");
  const snapshotData = decode<Snapshot>(snapshotDelegated ? teeSnapshot : baseSnapshot, "TreasurySnapshot");
  if (policy && (!policy.founder.equals(founder) || !policy.finance.equals(finance) || !policy.mint.equals(mint))) {
    throw new Error("Existing company Founder, Finance, or mint does not match onboarding input");
  }
  if (snapshotData && !snapshotData.company.equals(company)) throw new Error("Snapshot belongs to another company");
  const observation: OnboardingObservation = {
    companyExists: baseCompany !== null, companyDelegated, companyVisibleOnTee: teeCompany !== null,
    companyPermissionExists: companyPermission !== null || policy?.private_ready === true ||
      confirmedOnboardingStep(company.toBase58(), company.toBase58(), "initCompanyPermission"),
    companyPrivate: policy?.private_ready === true,
    limitsMatch: policy?.monthly_limit_micro.toString() === String(monthlyLimitMicro) &&
      policy?.agent_cap_micro.toString() === String(agentCapMicro),
    snapshotExists: baseSnapshot !== null, snapshotDelegated, snapshotVisibleOnTee: teeSnapshot !== null,
    snapshotPermissionExists: snapshotPermission !== null || snapshotData?.private_ready === true ||
      confirmedOnboardingStep(company.toBase58(), snapshot.toBase58(), "initSnapshotPermission"),
    snapshotPrivate: snapshotData?.private_ready === true,
  };
  return { companyAddress: company.toBase58(), snapshotAddress: snapshot.toBase58(), observation, next: nextOnboardingStep(observation) };
}
