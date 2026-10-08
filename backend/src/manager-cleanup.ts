import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { recordedRequestReaders } from "./payment-flow.ts";
import { PROGRAM_ID, TEE_RPC, readCompanyPolicy, readTeamGrant } from "./operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
const requestDiscriminator = Buffer.from(idl.accounts!.find((account) => account.name === "PaymentRequest")!.discriminator);

export type ManagerCleanupScan = {
  company: string; manager: string; grant: string;
  targets: Array<{ address: string; includeFinance: boolean }>;
  managerOwnedRequests: string[]; untrackedRequests: string[];
};

export function managerCleanupReaderPlan(manager: string, recorded: {
  includeFinance: boolean; manager: string | null;
} | undefined, financeActive: boolean): { includeFinance: boolean } | null {
  if (!recorded || recorded.manager !== manager) return null;
  return { includeFinance: recorded.includeFinance && financeActive };
}

export async function scanManagerReaderCleanup(args: {
  company: unknown; founder: unknown; grant: unknown; parentGrant: unknown; teeToken: string;
}): Promise<ManagerCleanupScan> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  const grantAddress = asAddress(args.grant, "grant");
  const parentAddress = asAddress(args.parentGrant, "parentGrant");
  const [policy, grant, parent] = await Promise.all([
    readCompanyPolicy(company, args.teeToken),
    readTeamGrant(company, grantAddress, args.teeToken),
    readTeamGrant(company, parentAddress, args.teeToken),
  ]);
  if (policy.founder !== founder || grant.role !== 2 || grant.parent !== parentAddress ||
      grant.grantor !== policy.finance || grant.active !== false || grant.revoked !== true ||
      parent.member !== policy.finance || parent.grantor !== founder || parent.role !== 1 ||
      parent.parent !== PublicKey.default.toBase58()) {
    throw new Error("A revoked Manager grant under this company's Finance grant is required");
  }
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", args.teeToken);
  const accounts = await new Connection(endpoint.toString(), "confirmed").getProgramAccounts(PROGRAM_ID);
  const readers = recordedRequestReaders(company);
  const targets: ManagerCleanupScan["targets"] = [];
  const managerOwnedRequests: string[] = [];
  const untrackedRequests: string[] = [];
  let policySeen = false;
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(PROGRAM_ID)) continue;
    if (pubkey.toBase58() === company) policySeen = true;
    if (!account.data.subarray(0, 8).equals(requestDiscriminator)) continue;
    const request = coder.decode("PaymentRequest", account.data) as {
      company: PublicKey; requester: PublicKey; private_ready: boolean;
    };
    if (request.company.toBase58() !== company || !request.private_ready) continue;
    const address = pubkey.toBase58();
    if (request.requester.toBase58() === grant.member) managerOwnedRequests.push(address);
    const recorded = readers.get(address);
    if (!recorded) {
      untrackedRequests.push(address);
      continue;
    }
    const plan = managerCleanupReaderPlan(grant.member as string, recorded,
      parent.active === true && parent.revoked === false);
    if (plan) targets.push({ address, includeFinance: plan.includeFinance });
  }
  if (!policySeen) throw new Error("PER account scan did not include the company policy; cleanup would be incomplete");
  targets.sort((a, b) => a.address.localeCompare(b.address));
  return { company, manager: grant.member as string, grant: grantAddress,
    targets, managerOwnedRequests, untrackedRequests };
}
