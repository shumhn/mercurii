import { assertTeeTokenActor } from "./assistant-auth.ts";
import { asAddress } from "./magicblock.ts";
import { readCompanyPolicy } from "./operations.ts";

/**
 * A private policy read makes the TEE validate the bearer token. Only after
 * that read may we trust its wallet claim for an off-chain Founder action.
 * Checking policy.founder alone is insufficient: Finance can read the policy.
 */
export async function requireFounderPolicy(args: {
  company: string;
  founder: string;
  teeToken: string;
  readPolicy?: typeof readCompanyPolicy;
}): Promise<Record<string, unknown>> {
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  if (!args.teeToken) throw new Error("Founder TEE auth token required");
  const policy = await (args.readPolicy ?? readCompanyPolicy)(company, args.teeToken);
  if (policy.address !== company || policy.founder !== founder) {
    throw new Error("Wrong private company policy");
  }
  assertTeeTokenActor(args.teeToken, founder);
  return policy;
}
