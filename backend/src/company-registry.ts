import { Connection, PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress } from "./magicblock.ts";
import { BASE_RPC, PROGRAM_ID, TEE_VALIDATOR } from "./operations.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

/**
 * Multi-company request context. The backend no longer serves exactly one
 * env-configured company: each request names its company, and the registry
 * resolves the founder/mint/validator that routes are allowed to act on.
 *
 * Resolution order for a requested company:
 *   1. The env default company (MERCURY_COMPANY_ADDRESS), when configured.
 *   2. A static operator registry (MERCURY_COMPANY_REGISTRY_JSON).
 *   3. The Supabase `mercury_companies` table (registered on-chain shells).
 * Anything else is rejected before a route can touch journals or the PER.
 */
export type CompanyContext = {
  company: string;
  founder: string;
  mint: string;
  validator: string;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { context: CompanyContext; expiresAt: number }>();

function defaultContext(): CompanyContext | null {
  const company = process.env.MERCURY_COMPANY_ADDRESS;
  const founder = process.env.MERCURY_FOUNDER_ADDRESS;
  if (!company && !founder) return null;
  if (!company || !founder) {
    throw new Error("Set both MERCURY_COMPANY_ADDRESS and MERCURY_FOUNDER_ADDRESS, or neither");
  }
  return {
    company: asAddress(company, "MERCURY_COMPANY_ADDRESS"),
    founder: asAddress(founder, "MERCURY_FOUNDER_ADDRESS"),
    mint: asAddress(process.env.MERCURY_COMPANY_MINT, "MERCURY_COMPANY_MINT"),
    validator: TEE_VALIDATOR.toBase58(),
  };
}

function staticRegistry(): Record<string, { founder: unknown; mint: unknown }> {
  const raw = process.env.MERCURY_COMPANY_REGISTRY_JSON;
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MERCURY_COMPANY_REGISTRY_JSON must be an object keyed by company address");
  }
  return parsed as Record<string, { founder: unknown; mint: unknown }>;
}

/** Picks the single company a request names; conflicting selectors are rejected. */
export function requestedCompanySelector(input: {
  header?: string | undefined; body?: unknown; query?: string | null;
}): unknown {
  const found = [input.header, input.body, input.query ?? undefined]
    .filter((value) => typeof value === "string" && value.length > 0);
  if (new Set(found).size > 1) throw new Error("Conflicting company selectors in one request");
  return found[0];
}

export async function resolveCompany(selector: unknown): Promise<CompanyContext> {
  const fallback = defaultContext();
  if (selector === undefined || selector === null || selector === "") {
    if (fallback) return fallback;
    throw new Error("Company is required; pass company or configure MERCURY_COMPANY_ADDRESS");
  }
  const company = asAddress(selector, "company");
  if (fallback && company === fallback.company) return fallback;
  const staticEntry = staticRegistry()[company];
  if (staticEntry) {
    return {
      company,
      founder: asAddress(staticEntry.founder, "registry founder"),
      mint: asAddress(staticEntry.mint, "registry mint"),
      validator: TEE_VALIDATOR.toBase58(),
    };
  }
  const cached = cache.get(company);
  if (cached && cached.expiresAt > Date.now()) return cached.context;
  const store = SupabasePrivateStore.fromEnvironment();
  if (!store) throw new Error("Company is not registered");
  const row = await store.getCompany(company);
  if (!row) throw new Error("Company is not registered");
  if (row.policyAddress !== company) throw new Error("Registered company policy address mismatch");
  const context: CompanyContext = {
    company,
    founder: asAddress(row.founderWallet, "registry founder"),
    mint: asAddress(row.mintAddress, "registry mint"),
    validator: TEE_VALIDATOR.toBase58(),
  };
  cache.set(company, { context, expiresAt: Date.now() + CACHE_MS });
  return context;
}

/** Test-only: drops the registry cache between scenarios. */
export function resetCompanyRegistryCache(): void {
  cache.clear();
}

/**
 * Registers a company after proving its on-chain shell: the policy PDA must
 * derive from the claimed founder, exist on base, be program-owned, and carry
 * the same founder/mint in its public (non-confidential) header. This verifies
 * deployment shape only; private policy fields stay behind the PER.
 */
export async function verifyAndRegisterCompany(input: {
  company: unknown; founder: unknown; store?: SupabasePrivateStore;
  connection?: Pick<Connection, "getAccountInfo">;
}): Promise<CompanyContext> {
  const company = asAddress(input.company, "company");
  const founder = asAddress(input.founder, "founder");
  const derived = PublicKey.findProgramAddressSync(
    [Buffer.from("company-policy"), new PublicKey(founder).toBuffer()], PROGRAM_ID,
  )[0];
  if (derived.toBase58() !== company) {
    throw new Error("Company address is not the policy PDA of this founder");
  }
  const connection = input.connection ?? new Connection(BASE_RPC, "confirmed");
  const account = await connection.getAccountInfo(new PublicKey(company), "confirmed");
  // A live Mercury company is program-owned on base; a delegated one is owned
  // by the delegation program while its data clones run on the PER. Both are
  // valid registrations — the data layout is identical in both states.
  const owner = account?.owner.toBase58();
  if (!account || account.data.length < 8 + 96 ||
      (owner !== PROGRAM_ID.toBase58() && owner !== DELEGATION_PROGRAM_ID.toBase58())) {
    throw new Error("Company policy shell is not initialized on base");
  }
  if (!new PublicKey(account.data.subarray(8, 40)).equals(new PublicKey(founder))) {
    throw new Error("On-chain policy founder does not match the registration");
  }
  const mint = new PublicKey(account.data.subarray(72, 104)).toBase58();
  const store = input.store ?? SupabasePrivateStore.fromEnvironment();
  if (!store) throw new Error("Company registration requires the Supabase private store");
  await store.registerCompany({
    companyId: company, founderWallet: founder, policyAddress: company,
    mintAddress: mint, perValidator: TEE_VALIDATOR.toBase58(),
  });
  const context = { company, founder, mint, validator: TEE_VALIDATOR.toBase58() };
  cache.set(company, { context, expiresAt: Date.now() + CACHE_MS });
  return context;
}
