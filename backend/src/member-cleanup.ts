import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { PROGRAM_ID, TEE_RPC, readCompanyPolicy, readTeamGrant } from "./operations.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
const requestDiscriminator = Buffer.from(idl.accounts!.find((account) => account.name === "PaymentRequest")!.discriminator);

export async function scanMemberReaderCleanup(args: {
  company: unknown; founder: unknown; grant: unknown; teeToken: string;
}): Promise<{ company: string; grant: string; member: string; role: "requester" | "viewer";
  targets: string[]; strategy: string }> {
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  const grantAddress = asAddress(args.grant, "grant");
  const [policy, grant] = await Promise.all([
    readCompanyPolicy(company, args.teeToken), readTeamGrant(company, grantAddress, args.teeToken),
  ]);
  if (policy.founder !== founder || grant.grantor !== founder ||
      grant.parent !== PublicKey.default.toBase58() || ![3, 4].includes(grant.role as number) ||
      grant.active !== false || grant.revoked !== true) {
    throw new Error("A revoked Founder-issued Requester or Viewer grant is required");
  }
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", args.teeToken);
  const accounts = await new Connection(endpoint.toString(), "confirmed").getProgramAccounts(PROGRAM_ID);
  if (!accounts.some(({ pubkey }) => pubkey.toBase58() === company)) {
    throw new Error("PER scan did not include the company policy; cleanup would be incomplete");
  }
  const targets: string[] = [];
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(PROGRAM_ID) ||
        !account.data.subarray(0, 8).equals(requestDiscriminator)) continue;
    const request = coder.decode("PaymentRequest", account.data) as {
      company: PublicKey; requester: PublicKey; private_ready: boolean;
    };
    if (!request.company.equals(new PublicKey(company)) || !request.private_ready) continue;
    if (grant.role === 3 && request.requester.toBase58() !== grant.member) continue;
    targets.push(pubkey.toBase58());
  }
  targets.sort();
  return { company, grant: grantAddress, member: grant.member as string,
    role: grant.role === 3 ? "requester" : "viewer", targets,
    strategy: "Reset affected private requests to Founder-only readers; explicitly re-share active members afterwards" };
}
