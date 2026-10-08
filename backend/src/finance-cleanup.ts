import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { PROGRAM_ID, TEE_RPC, readCompanyPolicy, readTeamGrant, snapshotAddress } from "./operations.ts";
import { recordedRequestReaders } from "./payment-flow.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
const discriminator = (name: string): Buffer => {
  const account = idl.accounts?.find((item) => item.name === name);
  if (!account) throw new Error(`IDL lacks ${name}`);
  return Buffer.from(account.discriminator);
};
const REQUEST = discriminator("PaymentRequest");
const SNAPSHOT = discriminator("TreasurySnapshot");
const AGENT = discriminator("AgentPolicy");
const POLICY = discriminator("CompanyPolicy");

export type CleanupTarget = { address: string; kind: "request" | "snapshot"; manager: string | null };
export type FinanceCleanupScan = {
  company: string; finance: string; grant: string;
  targets: CleanupTarget[];
  financeOwnedRequests: string[];
  agentPolicies: string[];
  untrackedRequests: string[];
};

export function financeCleanupReaderPlan(finance: string, requester: string,
  recorded: { includeFinance: boolean; manager: string | null } | undefined):
  { manager: string | null } | null {
  if (!recorded || (!recorded.includeFinance && requester !== finance)) return null;
  return { manager: recorded.manager };
}

export async function scanFinanceReaderCleanup(args: {
  company: unknown; founder: unknown; grant: unknown; teeToken: string;
}): Promise<FinanceCleanupScan> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  const grantAddress = asAddress(args.grant, "grant");
  const [policy, grant] = await Promise.all([
    readCompanyPolicy(company, args.teeToken), readTeamGrant(company, grantAddress, args.teeToken),
  ]);
  if (policy.founder !== founder || grant.grantor !== founder || grant.member !== policy.finance ||
      grant.role !== 1 || grant.parent !== PublicKey.default.toBase58() ||
      grant.active !== false || grant.revoked !== true) {
    throw new Error("A revoked Founder-issued Finance grant is required before cleanup");
  }
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", args.teeToken);
  const accounts = await new Connection(endpoint.toString(), "confirmed").getProgramAccounts(PROGRAM_ID);
  let policySeen = false;
  const targets: CleanupTarget[] = [];
  const financeOwnedRequests: string[] = [];
  const agentPolicies: string[] = [];
  const untrackedRequests: string[] = [];
  const readers = recordedRequestReaders(company);
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(PROGRAM_ID)) continue;
    const bytes = account.data.subarray(0, 8);
    if (bytes.equals(POLICY) && pubkey.toBase58() === company) policySeen = true;
    if (bytes.equals(REQUEST)) {
      const request = coder.decode("PaymentRequest", account.data) as {
        company: PublicKey; requester: PublicKey; private_ready: boolean;
      };
      if (!request.company.equals(new PublicKey(company)) || !request.private_ready) continue;
      if (request.requester.toBase58() === policy.finance) financeOwnedRequests.push(pubkey.toBase58());
      const recorded = readers.get(pubkey.toBase58());
      if (!recorded) {
        untrackedRequests.push(pubkey.toBase58());
        continue;
      }
      const plan = financeCleanupReaderPlan(policy.finance as string,
        request.requester.toBase58(), recorded);
      if (plan) targets.push({ address: pubkey.toBase58(), kind: "request", manager: plan.manager });
    } else if (bytes.equals(SNAPSHOT)) {
      const snapshot = coder.decode("TreasurySnapshot", account.data) as {
        company: PublicKey; private_ready: boolean;
      };
      if (snapshot.company.toBase58() === company && snapshot.private_ready &&
          pubkey.equals(snapshotAddress(new PublicKey(company)))) {
        targets.push({ address: pubkey.toBase58(), kind: "snapshot", manager: null });
      }
    } else if (bytes.equals(AGENT)) {
      const agent = coder.decode("AgentPolicy", account.data) as { company: PublicKey; private_ready: boolean };
      if (agent.company.toBase58() === company && agent.private_ready) agentPolicies.push(pubkey.toBase58());
    }
  }
  if (!policySeen) throw new Error("PER account scan did not include the company policy; cleanup would be incomplete");
  targets.sort((a, b) => a.address.localeCompare(b.address));
  return { company, finance: policy.finance as string, grant: grantAddress,
    targets, financeOwnedRequests, agentPolicies, untrackedRequests };
}
