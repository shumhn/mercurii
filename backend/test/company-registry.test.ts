import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { PROGRAM_ID } from "../src/operations.ts";
import { requestedCompanySelector, resetCompanyRegistryCache, resolveCompany,
  verifyAndRegisterCompany } from "../src/company-registry.ts";

const companyA = Keypair.generate().publicKey.toBase58();
const founderA = Keypair.generate().publicKey.toBase58();
const companyB = Keypair.generate().publicKey.toBase58();
const founderB = Keypair.generate().publicKey.toBase58();
const companyC = Keypair.generate().publicKey.toBase58();

function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const names = ["MERCURY_COMPANY_ADDRESS", "MERCURY_FOUNDER_ADDRESS", "MERCURY_COMPANY_MINT",
    "MERCURY_COMPANY_REGISTRY_JSON", "MERCURY_SUPABASE_URL", "MERCURY_SUPABASE_SECRET_KEY",
    "NEXT_PUBLIC_SUPABASE_URL"];
  const prior = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    const value = env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  resetCompanyRegistryCache();
  return run().finally(() => {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetCompanyRegistryCache();
  });
}

test("company registry falls back to the env default company", async () => {
  await withEnv({ MERCURY_COMPANY_ADDRESS: companyA, MERCURY_FOUNDER_ADDRESS: founderA,
    MERCURY_COMPANY_MINT: DEVNET_USDC }, async () => {
    const context = await resolveCompany(undefined);
    assert.equal(context.company, companyA);
    assert.equal(context.founder, founderA);
    assert.deepEqual(await resolveCompany(companyA), context);
  });
});

test("company registry resolves a static registered company and rejects unknown ones", async () => {
  await withEnv({ MERCURY_COMPANY_ADDRESS: companyA, MERCURY_FOUNDER_ADDRESS: founderA,
    MERCURY_COMPANY_MINT: DEVNET_USDC,
    MERCURY_COMPANY_REGISTRY_JSON: JSON.stringify({ [companyB]: { founder: founderB, mint: DEVNET_USDC } }) },
  async () => {
    const context = await resolveCompany(companyB);
    assert.equal(context.company, companyB);
    assert.equal(context.founder, founderB);
    await assert.rejects(() => resolveCompany(companyC), /not registered/);
    await assert.rejects(() => resolveCompany("not-an-address"), /Solana address/);
  });
});

test("company registry requires a company when no default is configured", async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => resolveCompany(undefined), /Company is required/);
    await assert.rejects(() => resolveCompany(companyB), /not registered/);
  });
});

test("conflicting company selectors in one request are rejected", async () => {
  assert.equal(requestedCompanySelector({ header: companyA, body: companyA, query: null }), companyA);
  assert.equal(requestedCompanySelector({ body: companyB }), companyB);
  assert.equal(requestedCompanySelector({}), undefined);
  assert.throws(() => requestedCompanySelector({ header: companyA, body: companyB }),
    /Conflicting company selectors/);
  assert.throws(() => requestedCompanySelector({ body: companyA, query: companyB }),
    /Conflicting company selectors/);
});

test("company registration verifies the on-chain founder-derived shell", async () => {
  const founder = Keypair.generate().publicKey;
  const finance = Keypair.generate().publicKey;
  const realCompany = PublicKey.findProgramAddressSync(
    [Buffer.from("company-policy"), founder.toBuffer()], PROGRAM_ID)[0].toBase58();
  const shell = Buffer.alloc(8 + 96);
  founder.toBuffer().copy(shell, 8);
  finance.toBuffer().copy(shell, 40);
  new PublicKey(DEVNET_USDC).toBuffer().copy(shell, 72);
  const registered: Array<Record<string, unknown>> = [];
  const store = {
    registerCompany: async (input: Record<string, unknown>) => { registered.push(input); },
  };
  const connection = {
    getAccountInfo: async () => ({ owner: PROGRAM_ID, data: shell }),
  };
  await withEnv({}, async () => {
    const context = await verifyAndRegisterCompany({
      company: realCompany, founder: founder.toBase58(),
      store: store as never, connection: connection as never,
    });
    assert.equal(context.company, realCompany);
    assert.equal(context.mint, DEVNET_USDC);
    assert.equal(registered.length, 1);
    assert.equal((registered[0] as { mintAddress: string }).mintAddress, DEVNET_USDC);
    // Wrong founder cannot claim the PDA.
    await assert.rejects(() => verifyAndRegisterCompany({
      company: realCompany, founder: Keypair.generate().publicKey.toBase58(),
      store: store as never, connection: connection as never,
    }), /not the policy PDA of this founder/);
    // Missing on-chain shell cannot register.
    await assert.rejects(() => verifyAndRegisterCompany({
      company: realCompany, founder: founder.toBase58(), store: store as never,
      connection: { getAccountInfo: async () => null } as never,
    }), /not initialized on base/);
  });
});
