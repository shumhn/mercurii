import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { asAddress, teeConnection } from "./magicblock.ts";
import { PROGRAM_ID, TEE_RPC, readCompanyPolicy, readTeamGrant } from "./operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const discriminator = Buffer.from(idl.accounts!.find((account) => account.name === "TeamGrant")!.discriminator);
const coder = new anchor.BorshAccountsCoder(idl);

export type TeamMember = {
  member: string;
  grants: Record<string, unknown>[];
};

// Discover grants from PER state, not the local receipt journal. An existing
// historical grant remains visible after a backend restart. Each grant is
// separately fetched through the caller's TEE token before it is returned.
export async function listTeamMembers(companyInput: unknown, teeToken: string): Promise<TeamMember[]> {
  if (!teeToken) throw new Error("TEE auth token required");
  const company = asAddress(companyInput, "company");
  // Requesters and Viewers may read their own grant without permission to
  // read the company policy. Their roster is intentionally only the set of
  // grants PER allows this token to fetch.
  const canReadPolicy = await readCompanyPolicy(company, teeToken).then(() => true, () => false);
  const accounts = await teeConnection(teeToken).getProgramAccounts(PROGRAM_ID);
  if (canReadPolicy && !accounts.some(({ pubkey }) => pubkey.toBase58() === company)) {
    throw new Error("PER scan did not include the company policy; member list may be incomplete");
  }
  const grants: Record<string, unknown>[] = [];
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(PROGRAM_ID) || !account.data.subarray(0, 8).equals(discriminator)) continue;
    const decoded = coder.decode("TeamGrant", account.data) as { company: PublicKey; private_ready: boolean };
    if (!decoded.company.equals(new PublicKey(company)) || !decoded.private_ready) continue;
    try {
      grants.push(await readTeamGrant(company, pubkey.toBase58(), teeToken));
    } catch {
      // The caller may see an account in the scan but lack direct read access.
      // Never return its decoded confidential terms from the scan result.
    }
  }
  if (!canReadPolicy && grants.length === 0) {
    throw new Error("No private company grants are accessible to this wallet");
  }
  const byMember = new Map<string, TeamMember>();
  for (const grant of grants) {
    const member = String(grant.member);
    const row = byMember.get(member) ?? { member, grants: [] };
    row.grants.push(grant);
    byMember.set(member, row);
  }
  return [...byMember.values()].sort((a, b) => a.member.localeCompare(b.member));
}
