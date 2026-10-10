import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { DEVNET_USDC } from "../src/magicblock.ts";

const companyA = Keypair.generate().publicKey.toBase58();
const founderA = Keypair.generate().publicKey.toBase58();
const companyB = Keypair.generate().publicKey.toBase58();
const founderB = Keypair.generate().publicKey.toBase58();
const companyC = Keypair.generate().publicKey.toBase58();
const otherMint = Keypair.generate().publicKey.toBase58();

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function startBackend(env: Record<string, string>, directory: string) {
  const port = await freePort();
  const backend = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      MERCURY_SUPABASE_URL: "", MERCURY_SUPABASE_SECRET_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "",
      MERCURY_PAYMENT_FLOW_JOURNAL: join(directory, "flows.json"),
      MERCURY_ONBOARDING_JOURNAL: join(directory, "receipts.json"),
      ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "backend did not start");
  return { backend, base };
}

test("multi-company requests resolve, isolate, and reject unknown companies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-multico-"));
  const existingPaymentId = crypto.randomUUID();
  writeFileSync(join(directory, "flows.json"), JSON.stringify({ version: 1, flows: [{
    paymentId: existingPaymentId, company: companyA, requester: founderA,
    request: Keypair.generate().publicKey.toBase58(), requestId: "42",
    termsHash: "a".repeat(64), createdAt: new Date().toISOString(),
    includeFinance: false, manager: null, branchId: null,
  }] }));
  const { backend, base } = await startBackend({
    MERCURY_COMPANY_ADDRESS: companyA, MERCURY_FOUNDER_ADDRESS: founderA,
    MERCURY_COMPANY_MINT: DEVNET_USDC,
    MERCURY_COMPANY_REGISTRY_JSON: JSON.stringify({
      [companyB]: { founder: founderB, mint: DEVNET_USDC },
    }),
  }, directory);
  try {
    // Health no longer implies a single company.
    const health = await (await fetch(`${base}/health`)).json() as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.multiCompany, true);
    assert.equal(health.companyAddress, companyA);

    // Unknown company is rejected before any route touches state or the PER.
    const unknown = await fetch(`${base}/v1/payroll-runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: companyC, runId: crypto.randomUUID(),
        requester: founderA, items: [] }),
    });
    assert.equal(unknown.status, 400);
    assert.match(JSON.stringify(await unknown.json()), /not registered/);

    // Conflicting selectors are rejected outright.
    const conflict = await fetch(`${base}/v1/payroll-runs`, {
      method: "POST", headers: { "content-type": "application/json", "x-mercury-company": companyA },
      body: JSON.stringify({ company: companyB, runId: crypto.randomUUID(),
        requester: founderA, items: [] }),
    });
    assert.equal(conflict.status, 400);
    assert.match(JSON.stringify(await conflict.json()), /Conflicting company selectors/);

    // Registered static company B passes resolution (fails later on TEE auth,
    // which proves the request was scoped to B rather than rejected up front).
    const scopedB = await fetch(`${base}/v1/payroll-runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: companyB, runId: crypto.randomUUID(),
        requester: founderB, items: [] }),
    });
    assert.equal(scopedB.status, 400);
    assert.doesNotMatch(JSON.stringify(await scopedB.json()), /not registered|Company is required/);

    // Default company A keeps working with no selector at all.
    const scopedDefault = await fetch(`${base}/v1/payroll-runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: crypto.randomUUID(), requester: founderA, items: [] }),
    });
    assert.equal(scopedDefault.status, 400);
    assert.doesNotMatch(JSON.stringify(await scopedDefault.json()), /not registered|Company is required/);

    // This ID really exists in A's journal; the identical ID is unavailable
    // through B's HTTP context before any private-chain read can happen.
    const flowsB = await fetch(`${base}/v1/payment-flows/${existingPaymentId}`, {
      headers: { authorization: "Bearer invalid", "x-mercury-company": companyB },
    });
    assert.equal(flowsB.status, 400);
    assert.match(JSON.stringify(await flowsB.json()), /Unknown payment flow ID/);
  } finally {
    backend.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backend without a default company requires an explicit company", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-multico-nodefault-"));
  const { backend, base } = await startBackend({
    MERCURY_COMPANY_ADDRESS: "", MERCURY_FOUNDER_ADDRESS: "", MERCURY_COMPANY_MINT: "",
    MERCURY_ENABLE_EXPERIMENTAL_RECEIVE: "1", MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS: "1",
    MERCURY_COMPANY_REGISTRY_JSON: JSON.stringify({
      [companyB]: { founder: founderB, mint: DEVNET_USDC },
      [companyC]: { founder: founderB, mint: otherMint },
    }),
  }, directory);
  try {
    const health = await (await fetch(`${base}/health`)).json() as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.companyAddress, null);
    const missing = await fetch(`${base}/v1/payroll-runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: crypto.randomUUID(), requester: founderB, items: [] }),
    });
    assert.equal(missing.status, 400);
    assert.match(JSON.stringify(await missing.json()), /Company is required/);

    // These gates must use B's registered mint even with no default mint.
    for (const route of ["/v1/onboarding/next", "/v1/onboarding/recipient/next",
      `/v1/payment-jobs/${crypto.randomUUID()}/prepare`]) {
      const response = await fetch(`${base}${route}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ company: companyB }),
      });
      assert.equal(response.status, 400, `${route} must pass the company mint gate`);
      assert.match(JSON.stringify(await response.json()), /TEE auth token required/);
    }
    const nonUsdc = await fetch(`${base}/v1/onboarding/recipient/next`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: companyC }),
    });
    assert.equal(nonUsdc.status, 503);
    assert.match(JSON.stringify(await nonUsdc.json()), /Circle devnet USDC/);

    for (const route of ["/v1/payroll-runs", "/v1/payment-jobs?limit=5"]) {
      const separator = route.includes("?") ? "&" : "?";
      const response = await fetch(`${base}${route}${separator}company=${companyB}`);
      assert.equal(response.status, 400, `${route} must route with a query company selector`);
      assert.match(JSON.stringify(await response.json()), /TEE auth token required/);
    }
  } finally {
    backend.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
