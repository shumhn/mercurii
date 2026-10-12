import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress, asMicroAmount, delegationStatus, teeConnection } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC } from "./operations.ts";
import { confirmedOnboardingStep } from "./onboarding-journal.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
type AgentData = { company: PublicKey; founder: PublicKey; agent: PublicKey; private_ready: boolean;
  revoked: boolean; allowed_recipient: PublicKey; per_payment_cap_micro: anchor.BN;
  period_cap_micro: anchor.BN };
type Step = { status: "build" | "wait" | "ready" | "revoked"; operation: string | null; reason: string };

export function agentPolicyAddress(company: string, founder: string, agent: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from("agent-policy"), new PublicKey(founder).toBuffer(),
    new PublicKey(company).toBuffer(), new PublicKey(agent).toBuffer()], PROGRAM_ID)[0].toBase58();
}

export async function inspectAgentOnboarding(args: { company: unknown; founder: unknown; agent: unknown;
  recipient: unknown; perPaymentCapMicro: unknown; periodCapMicro: unknown; teeToken: string }): Promise<{
  agentPolicyAddress: string; observation: { exists: boolean; delegated: boolean; visibleOnTee: boolean;
    permissionExists: boolean; privateReady: boolean; revoked: boolean; limitsMatch: boolean }; next: Step;
}> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  const agent = asAddress(args.agent, "agent");
  const recipient = asAddress(args.recipient, "recipient");
  const perPaymentCapMicro = asMicroAmount(args.perPaymentCapMicro);
  const periodCapMicro = asMicroAmount(args.periodCapMicro);
  if (periodCapMicro < perPaymentCapMicro) throw new Error("Agent period cap must cover its per-payment cap");
  const address = agentPolicyAddress(company, founder, agent);
  const key = new PublicKey(address);
  const route = await delegationStatus({ account: address });
  if (route.isDelegated === true && (typeof route.fqdn !== "string" ||
      new URL(route.fqdn).hostname !== new URL(TEE_RPC).hostname)) {
    throw new Error("Agent policy is delegated to a different PER validator");
  }
  const delegated = route.isDelegated === true;
  const base = new Connection(BASE_RPC, "confirmed");
  const tee = teeConnection(args.teeToken);
  const [baseAccount, teeAccount, permission] = await Promise.all([
    base.getAccountInfo(key), delegated ? tee.getAccountInfo(key) : Promise.resolve(null),
    delegated ? tee.getAccountInfo(permissionPdaFromAccount(key)) : Promise.resolve(null),
  ]);
  if (!baseAccount && delegated) throw new Error("Router and base disagree about agent policy existence");
  const account = delegated ? teeAccount : baseAccount;
  if (account && !account.owner.equals(PROGRAM_ID)) throw new Error("Agent policy has an unexpected owner");
  const data = account ? coder.decode("AgentPolicy", account.data) as AgentData : null;
  if (data && (!data.company.equals(new PublicKey(company)) || !data.founder.equals(new PublicKey(founder)) ||
      !data.agent.equals(new PublicKey(agent)))) throw new Error("Agent policy identity does not match this company");
  const observation = {
    exists: baseAccount !== null, delegated, visibleOnTee: teeAccount !== null,
    permissionExists: permission !== null || data?.private_ready === true ||
      confirmedOnboardingStep(company, address, "initAgentPermission"),
    privateReady: data?.private_ready === true, revoked: data?.revoked === true,
    limitsMatch: data?.allowed_recipient.equals(new PublicKey(recipient)) === true &&
      data?.per_payment_cap_micro.toString() === String(perPaymentCapMicro) &&
      data?.period_cap_micro.toString() === String(periodCapMicro),
  };
  let next: Step;
  if (!observation.exists) next = { status: "build", operation: "createAgentShell", reason: "Create the agent policy shell without private spending terms" };
  else if (!delegated) next = { status: "build", operation: "delegateAgent", reason: "Delegate the policy to the selected PER" };
  else if (!observation.visibleOnTee) next = { status: "wait", operation: null, reason: "Wait for delegated agent state to appear on the selected PER" };
  else if (!observation.permissionExists) next = { status: "build", operation: "initAgentPermission", reason: "Create the agent policy permission" };
  else if (!observation.privateReady) next = { status: "build", operation: "activateAgentPrivacy", reason: "Restrict policy readers before setting spending terms" };
  else if (observation.revoked) next = { status: "revoked", operation: null, reason: "This agent policy was revoked; use a different agent wallet for a new policy" };
  else if (!observation.limitsMatch) next = { status: "build", operation: "configureAgent", reason: "Set the allowed recipient and hard spending caps privately" };
  else next = { status: "ready", operation: null, reason: "Agent policy is private and its spending rules match" };
  return { agentPolicyAddress: address, observation, next };
}
