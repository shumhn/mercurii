import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { asAddress, teeConnection } from "./magicblock.ts";
import { PROGRAM_ID, readAgentPolicy } from "./operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const discriminator = Buffer.from(idl.accounts!.find((account) => account.name === "AgentPolicy")!.discriminator);
const coder = new anchor.BorshAccountsCoder(idl);

// The PER scan is a candidate list only. Return a policy after a direct,
// permissioned TEE read succeeds for the caller's token.
export async function listVisibleAgentPolicies(companyInput: unknown, teeToken: string): Promise<Record<string, unknown>[]> {
  if (!teeToken) throw new Error("TEE auth token required");
  const company = new PublicKey(asAddress(companyInput, "company"));
  const accounts = await teeConnection(teeToken).getProgramAccounts(PROGRAM_ID);
  const policies: Record<string, unknown>[] = [];
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(PROGRAM_ID) || !account.data.subarray(0, 8).equals(discriminator)) continue;
    const data = coder.decode("AgentPolicy", account.data) as { company: PublicKey; private_ready: boolean };
    if (!data.company.equals(company) || !data.private_ready) continue;
    try { policies.push(await readAgentPolicy(company.toBase58(), pubkey.toBase58(), teeToken)); }
    catch { /* Candidate was visible to the scan but not readable by this wallet. */ }
  }
  return policies.sort((a, b) => String(a.address).localeCompare(String(b.address)));
}
