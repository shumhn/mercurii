import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { base58 } from "@scure/base";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/fetch";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { configuredX402SignerSecret, filterX402Requirements, inspectX402Offer,
  parseX402Registry, purchaseX402, resolveRejectedX402Purchase,
  reconcileX402Purchase,
  verifiesX402Transfer } from "../src/x402-spender.ts";

const payTo = Keypair.generate().publicKey.toBase58();
const company = Keypair.generate().publicKey.toBase58();
const service = { url: "https://example.org/report", payTo, maxMicro: "1000",
  periodCapMicro: "1500", expiresAt: "2030-01-01T00:00:00.000Z" };
const network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const requirement = (overrides: Record<string, unknown> = {}) => ({ scheme: "exact", network,
  asset: DEVNET_USDC, payTo, amount: "1000", maxTimeoutSeconds: 60, extra: {},
  ...overrides }) as PaymentRequirements;

test("x402 signer file must be private and cannot be combined with an environment key", () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-key-"));
  const file = join(directory, "signer.key");
  const secret = base58.encode(Keypair.generate().secretKey);
  process.env.MERCURY_X402_SIGNER_FILE = file;
  try {
    writeFileSync(file, secret, { mode: 0o644 });
    assert.throws(configuredX402SignerSecret, /private regular file/);
    chmodSync(file, 0o600);
    assert.equal(configuredX402SignerSecret(), secret);
    process.env.MERCURY_X402_SIGNER_BASE58 = secret;
    assert.throws(configuredX402SignerSecret, /one x402 signer source/);
  } finally {
    delete process.env.MERCURY_X402_SIGNER_FILE;
    delete process.env.MERCURY_X402_SIGNER_BASE58;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 policy allows only exact devnet USDC to an approved service within its cap", () => {
  assert.equal(filterX402Requirements([requirement()], service).length, 1);
  for (const change of [{ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
    { scheme: "upto" }, { asset: Keypair.generate().publicKey.toBase58() },
    { payTo: Keypair.generate().publicKey.toBase58() }, { amount: "1001" }]) {
    assert.equal(filterX402Requirements([requirement(change)], service).length, 0);
  }
  assert.throws(() => parseX402Registry(JSON.stringify({ bad: { ...service,
    url: "http://example.org/report" } })), /HTTPS or local HTTP/);
});

test("x402 agent can inspect an approved price without signing or paying", async () => {
  const registry = { report: service };
  let requests = 0;
  const fetchImpl = (async () => {
    requests++;
    return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED":
      encodePaymentRequiredHeader({ x402Version: 2, resource: { url: service.url },
        accepts: [requirement()] }) } });
  }) as typeof fetch;
  const offer = await inspectX402Offer({ serviceId: "report", registry, fetchImpl });
  assert.equal(offer.priceMicro, "1000");
  assert.equal(offer.status, "paid_offer");
  assert.equal(requests, 1);
  const bad = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED":
    encodePaymentRequiredHeader({ x402Version: 2, resource: { url: service.url },
      accepts: [requirement({ amount: "2000" })] }) } })) as typeof fetch;
  await assert.rejects(inspectX402Offer({ serviceId: "report", registry, fetchImpl: bad }),
    /does not match one approved payment option/);
});

test("x402 purchase keeps one task idempotent and enforces the period budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-"));
  process.env.MERCURY_X402_JOURNAL = join(directory, "purchases.json");
  try {
    const registry = parseX402Registry(JSON.stringify({ report: service }));
    let requests = 0;
    const taskId = randomUUID();
    const args = { company, taskId, serviceId: "report", registry, signerSecret: "not-used-by-mock", rpcUrl: "http://localhost",
      now: new Date("2026-10-09T00:00:00.000Z"),
      paymentFetch: (async (_service: unknown, _key: string, _rpc: string,
        onSelected: (amount: string) => void) => {
        requests++;
        onSelected("1000");
        return new Response("result", { status: 200, headers: { "PAYMENT-RESPONSE":
          encodePaymentResponseHeader({ success: true, transaction: "dummy-signature", network }) } });
      }) as NonNullable<Parameters<typeof purchaseX402>[0]["paymentFetch"]>,
      confirmTransaction: async () => true,
    };
    const paid = await purchaseX402(args);
    assert.equal(paid.status, "paid");
    assert.equal(paid.amountMicro, "1000");
    const repeated = await purchaseX402(args);
    assert.equal(repeated.repeated, true);
    assert.equal(requests, 1);
    const otherCompany = Keypair.generate().publicKey.toBase58();
    const isolated = await purchaseX402({ ...args, company: otherCompany });
    assert.equal(isolated.status, "paid");
    assert.equal(isolated.repeated, false);
    assert.equal(requests, 2);
    const persisted = JSON.parse(readFileSync(process.env.MERCURY_X402_JOURNAL!, "utf8")) as {
      purchases: Array<{ company?: string }> };
    assert.ok(persisted.purchases.some((purchase) => purchase.company === company));
    assert.ok(persisted.purchases.some((purchase) => purchase.company === otherCompany));
    await assert.rejects(purchaseX402({ ...args, signerSecret: "changed-key" }),
      /different payment terms or signer/);
    await assert.rejects(purchaseX402({ ...args, registry: { report: { ...service,
      payTo: Keypair.generate().publicKey.toBase58() } } }), /different payment terms or signer/);
    await assert.rejects(purchaseX402({ ...args, taskId: randomUUID() }), /period cap exhausted/);
  } finally {
    delete process.env.MERCURY_X402_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 blocks unscoped legacy purchases instead of assigning them to a company", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-"));
  process.env.MERCURY_X402_JOURNAL = join(directory, "purchases.json");
  try {
    writeFileSync(process.env.MERCURY_X402_JOURNAL, JSON.stringify({ version: 1, purchases: [{
      taskId: randomUUID(), serviceId: "report", period: 1, url: service.url, payTo,
      signerHash: "legacy", reservedMicro: "1000", amountMicro: null, status: "uncertain",
      transaction: null, createdAt: "2026-10-09T00:00:00.000Z",
    }] }));
    await assert.rejects(purchaseX402({ company, taskId: randomUUID(), serviceId: "report",
      registry: { report: service }, signerSecret: "not-used-by-mock", rpcUrl: "http://localhost" }),
    /Legacy x402 purchases/);
  } finally {
    delete process.env.MERCURY_X402_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 uncertain settlement cannot be automatically retried", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-"));
  process.env.MERCURY_X402_JOURNAL = join(directory, "purchases.json");
  try {
    const registry = parseX402Registry(JSON.stringify({ report: service }));
    const taskId = randomUUID();
    const args = { company, taskId, serviceId: "report", registry, signerSecret: "not-used-by-mock", rpcUrl: "http://localhost",
      now: new Date("2026-10-09T00:00:00.000Z"),
      paymentFetch: (async (_service: unknown, _key: string, _rpc: string,
        onSelected: (amount: string) => void) => {
        onSelected("1000");
        return new Response("result", { status: 200 });
      }) as NonNullable<Parameters<typeof purchaseX402>[0]["paymentFetch"]>,
      confirmTransaction: async () => true,
    };
    await assert.rejects(purchaseX402(args), /no settlement receipt/);
    await assert.rejects(purchaseX402(args), /unresolved payment/);
  } finally {
    delete process.env.MERCURY_X402_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 rejected task releases its reservation only after expiry and signer-history scan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-"));
  process.env.MERCURY_X402_JOURNAL = join(directory, "purchases.json");
  try {
    const registry = parseX402Registry(JSON.stringify({ report: service }));
    const taskId = randomUUID();
    const signerSecret = base58.encode(Keypair.generate().secretKey);
    const args = { company, taskId, serviceId: "report", registry, signerSecret, rpcUrl: "http://localhost",
      now: new Date("2026-10-09T00:00:00.000Z"),
      paymentFetch: (async (_service: unknown, _key: string, _rpc: string,
        onSelected: (amount: string) => void) => {
        onSelected("1000");
        return new Response(JSON.stringify({ error: "verification failed" }), { status: 402 });
      }) as NonNullable<Parameters<typeof purchaseX402>[0]["paymentFetch"]>,
    };
    await assert.rejects(purchaseX402(args), /verification failed/);
    const resolution = { company, taskId, serviceId: "report", registry, signerSecret, rpcUrl: "http://localhost",
      scanSignerHistory: async () => [] };
    await assert.rejects(resolveRejectedX402Purchase({ ...resolution,
      now: new Date("2026-10-09T00:02:00.000Z") }), /Wait for/);
    const payer = Keypair.fromSecretKey(base58.decode(signerSecret)).publicKey.toBase58();
    const balance = (amount: string) => ({ owner: payer, mint: DEVNET_USDC,
      uiTokenAmount: { amount } });
    type Parsed = NonNullable<Parameters<typeof verifiesX402Transfer>[0]>;
    await assert.rejects(resolveRejectedX402Purchase({ ...resolution,
      now: new Date("2026-10-09T00:04:00.000Z"),
      scanSignerHistory: async () => [{ meta: { err: null,
        preTokenBalances: [balance("1000")], postTokenBalances: [balance("0")] } } as Parsed],
    }), /spent USDC/);
    const rejected = await resolveRejectedX402Purchase({ ...resolution,
      now: new Date("2026-10-09T00:04:00.000Z") });
    assert.equal(rejected.status, "rejected");
    await assert.rejects(purchaseX402(args), /was rejected/);
    const next = await purchaseX402({ ...args, taskId: randomUUID(), paymentFetch: (async () =>
      new Response("free", { status: 200 })) as NonNullable<Parameters<typeof purchaseX402>[0]["paymentFetch"]> });
    assert.equal(next.status, "free");
  } finally {
    delete process.env.MERCURY_X402_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 known receipt can be reconciled without buying the resource again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-x402-"));
  process.env.MERCURY_X402_JOURNAL = join(directory, "purchases.json");
  try {
    const registry = parseX402Registry(JSON.stringify({ report: service }));
    const taskId = randomUUID();
    let requests = 0;
    const args = { company, taskId, serviceId: "report", registry, signerSecret: "not-used-by-mock",
      rpcUrl: "http://localhost", now: new Date("2026-10-09T00:00:00.000Z"),
      paymentFetch: (async (_service: unknown, _key: string, _rpc: string,
        onSelected: (amount: string) => void) => {
        requests++;
        onSelected("1000");
        return new Response("resource", { status: 200, headers: { "PAYMENT-RESPONSE":
          encodePaymentResponseHeader({ success: true, transaction: "settled-signature", network }) } });
      }) as NonNullable<Parameters<typeof purchaseX402>[0]["paymentFetch"]>,
      confirmTransaction: async () => false,
    };
    await assert.rejects(purchaseX402(args), /not confirmed/);
    await assert.rejects(purchaseX402(args), /unresolved payment/);
    const pending = await reconcileX402Purchase({ ...args, confirmTransaction: async () => false });
    assert.equal(pending.status, "uncertain");
    const settled = await reconcileX402Purchase({ ...args, confirmTransaction: async () => true });
    assert.equal(settled.status, "paid");
    assert.equal(settled.transaction, "settled-signature");
    const repeat = await purchaseX402(args);
    assert.equal(repeat.repeated, true);
    assert.equal(requests, 1);
  } finally {
    delete process.env.MERCURY_X402_JOURNAL;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("x402 receipt needs a confirmed USDC debit and matching recipient credit", () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const balance = (owner: string, amount: string) => ({ owner, mint: DEVNET_USDC,
    uiTokenAmount: { amount } });
  const transaction = { meta: { err: null,
    preTokenBalances: [balance(payer, "5000"), balance(payTo, "1000")],
    postTokenBalances: [balance(payer, "4000"), balance(payTo, "2000")] } };
  type Parsed = Parameters<typeof verifiesX402Transfer>[0];
  assert.equal(verifiesX402Transfer(transaction as Parsed, payer, payTo, "1000"), true);
  assert.equal(verifiesX402Transfer(transaction as Parsed, payer, address(), "1000"), false);
  assert.equal(verifiesX402Transfer(transaction as Parsed, payer, payTo, "1001"), false);
  assert.equal(verifiesX402Transfer({ meta: { ...transaction.meta, err: { InstructionError: [0, "Custom"] } } } as unknown as Parsed,
    payer, payTo, "1000"), false);
});

function address(): string { return Keypair.generate().publicKey.toBase58(); }
