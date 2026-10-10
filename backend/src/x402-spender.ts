import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { Connection, Keypair, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader,
  type PaymentRequirements } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { DEVNET_USDC, asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEFAULT_PATH = new URL("../.state/x402-purchases.json", import.meta.url).pathname;
const journalPath = () => process.env.MERCURY_X402_JOURNAL ?? DEFAULT_PATH;
const signerHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export type X402Service = { url: string; payTo: string; maxMicro: string;
  periodCapMicro: string; expiresAt: string };
export type X402Registry = Record<string, X402Service>;
type Purchase = { company?: string; taskId: string; serviceId: string; period: number;
  url: string; payTo: string; signerHash: string;
  reservedMicro: string; amountMicro: string | null;
  status: "pending" | "uncertain" | "rejected" | "paid" | "free";
  transaction: string | null; createdAt: string };
type Journal = { version: 1; purchases: Purchase[] };

function positiveMicro(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) ||
      BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} must be a positive safe micro amount`);
  return BigInt(value);
}

export function configuredX402SignerSecret(): string | undefined {
  const direct = process.env.MERCURY_X402_SIGNER_BASE58;
  const file = process.env.MERCURY_X402_SIGNER_FILE;
  if (direct && file) throw new Error("Configure one x402 signer source, not both");
  if (!file) return direct;
  const metadata = lstatSync(file);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("x402 signer file must be a private regular file");
  }
  const secret = readFileSync(file, "utf8").trim();
  if (base58.decode(secret).length !== 64) throw new Error("x402 signer file must contain a 64-byte keypair");
  return secret;
}

export function parseX402Registry(raw: string): X402Registry {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid x402 service registry");
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > 20) throw new Error("x402 registry requires 1 to 20 services");
  const registry: X402Registry = Object.create(null) as X402Registry;
  for (const [id, value] of entries) {
    if (!/^[a-z0-9_-]{1,40}$/.test(id) || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid x402 service entry");
    }
    const row = value as Record<string, unknown>;
    const url = new URL(String(row.url));
    if ((url.protocol !== "https:" && !(url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
        url.username || url.password || url.hash) throw new Error("x402 service URL must be HTTPS or local HTTP");
    const payTo = asAddress(row.payTo, "x402 payTo");
    const max = positiveMicro(row.maxMicro, "maxMicro");
    const cap = positiveMicro(row.periodCapMicro, "periodCapMicro");
    if (cap < max) throw new Error("x402 period cap must cover one purchase");
    if (typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) {
      throw new Error("x402 service expiry required");
    }
    registry[id] = { url: url.toString(), payTo, maxMicro: max.toString(),
      periodCapMicro: cap.toString(), expiresAt: row.expiresAt };
  }
  return registry;
}

export function filterX402Requirements(requirements: PaymentRequirements[], service: X402Service): PaymentRequirements[] {
  return requirements.filter((item) => item.scheme === "exact" && item.network === NETWORK &&
    item.asset === DEVNET_USDC && item.payTo === service.payTo &&
    typeof item.amount === "string" && /^[1-9][0-9]*$/.test(item.amount) &&
    BigInt(item.amount) <= BigInt(service.maxMicro));
}

export async function inspectX402Offer(args: { serviceId: unknown; registry: X402Registry;
  fetchImpl?: typeof fetch }): Promise<Record<string, unknown>> {
  if (typeof args.serviceId !== "string" || !Object.hasOwn(args.registry, args.serviceId)) {
    throw new Error("x402 service is not allowlisted");
  }
  const service = args.registry[args.serviceId]!;
  if (Date.parse(service.expiresAt) <= Date.now()) throw new Error("x402 service approval expired");
  const response = await (args.fetchImpl ?? fetch)(service.url, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return { serviceId: args.serviceId, status: "free",
    url: service.url, payTo: service.payTo, priceMicro: "0" };
  if (response.status !== 402) throw new Error(`x402 offer returned HTTP ${response.status}`);
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("x402 offer has no V2 payment requirement");
  const required = decodePaymentRequiredHeader(header);
  if (required.x402Version !== 2) throw new Error("x402 offer is not V2");
  const allowed = filterX402Requirements(required.accepts, service);
  if (allowed.length !== 1) throw new Error("x402 offer does not match one approved payment option");
  return { serviceId: args.serviceId, status: "paid_offer", url: service.url,
    payTo: service.payTo, priceMicro: allowed[0]!.amount, maxMicro: service.maxMicro };
}

function readJournal(): Journal {
  try {
    const value = JSON.parse(readFileSync(journalPath(), "utf8")) as Journal;
    if (value.version !== 1 || !Array.isArray(value.purchases)) throw new Error("Invalid x402 journal");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, purchases: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = journalPath();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "x402-purchases", journal, rowKeys: ["purchases"] });
}

function requireCompanyScopedPurchases(journal: Journal): void {
  if (journal.purchases.some((purchase) => !purchase.company)) {
    throw new Error("Legacy x402 purchases need an explicit company migration before this signer can be used");
  }
}

function updatePurchase(company: string, taskId: string, status: Purchase["status"],
  amountMicro: string | null, transaction: string | null,
  expectedStatus: Purchase["status"] = "pending"): Purchase {
  const journal = readJournal();
  const purchase = journal.purchases.find((item) => item.company === company && item.taskId === taskId);
  if (!purchase || purchase.status !== expectedStatus) throw new Error("x402 purchase status changed");
  purchase.status = status;
  purchase.amountMicro = amountMicro;
  purchase.transaction = transaction;
  saveJournal(journal);
  return purchase;
}

export function verifiesX402Transfer(transaction: ParsedTransactionWithMeta | null,
  payer: string, payTo: string, amountMicro: string): boolean {
  if (!transaction?.meta || transaction.meta.err !== null) return false;
  return usdcDelta(transaction, payTo) >= BigInt(amountMicro) &&
    usdcDelta(transaction, payer) <= -BigInt(amountMicro);
}

function usdcDelta(transaction: ParsedTransactionWithMeta, owner: string): bigint {
  const balances = transaction.meta!;
  const sum = (rows: typeof balances.postTokenBalances) => (rows ?? [])
    .filter((row) => row.owner === owner && row.mint === DEVNET_USDC)
    .reduce((total, row) => total + BigInt(row.uiTokenAmount.amount), 0n);
  return sum(balances.postTokenBalances) - sum(balances.preTokenBalances);
}

async function confirmedX402Transfer(rpcUrl: string, signerSecret: string,
  service: X402Service, amountMicro: string, signature: string): Promise<boolean> {
  const rpc = new Connection(rpcUrl, "confirmed");
  const status = (await rpc.getSignatureStatuses([signature],
    { searchTransactionHistory: true })).value[0];
  if (!status || status.err !== null ||
      !["confirmed", "finalized"].includes(status.confirmationStatus ?? "")) return false;
  const transaction = await rpc.getParsedTransaction(signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const payer = Keypair.fromSecretKey(base58.decode(signerSecret)).publicKey.toBase58();
  return verifiesX402Transfer(transaction, payer, service.payTo, amountMicro);
}

async function defaultPaymentFetch(service: X402Service, signerSecret: string, rpcUrl: string,
  onSelected: (amountMicro: string) => void): Promise<Response> {
  const secret = base58.decode(signerSecret);
  if (secret.length !== 64) throw new Error("Isolated x402 signer must be a 64-byte keypair");
  const signer = await createKeyPairSignerFromBytes(secret);
  const client = new x402Client();
  client.registerPolicy((_version, requirements) => {
    const allowed = filterX402Requirements(requirements, service);
    if (allowed.length > 0) onSelected(allowed[0]!.amount);
    return allowed.slice(0, 1);
  });
  client.register("solana:*", new ExactSvmScheme(signer, { rpcUrl }));
  const paidFetch = wrapFetchWithPayment((input, init) => fetch(input, { ...init,
    redirect: "error", signal: AbortSignal.timeout(45_000) }), client);
  return paidFetch(service.url, { method: "GET", redirect: "error" });
}

export async function purchaseX402(args: { company: unknown; taskId: unknown; serviceId: unknown;
  registry: X402Registry; signerSecret: string; rpcUrl: string;
  paymentFetch?: typeof defaultPaymentFetch;
  confirmTransaction?: (signature: string) => Promise<boolean>;
  now?: Date;
}): Promise<Record<string, unknown>> {
  const company = asAddress(args.company, "company");
  const taskId = paymentId(args.taskId);
  if (typeof args.serviceId !== "string" || !Object.hasOwn(args.registry, args.serviceId)) {
    throw new Error("x402 service is not allowlisted");
  }
  const service = args.registry[args.serviceId]!;
  const now = args.now ?? new Date();
  if (Date.parse(service.expiresAt) <= now.getTime()) throw new Error("x402 service approval expired");
  const period = Math.floor(now.getTime() / (30 * 24 * 60 * 60 * 1000));
  const journal = readJournal();
  requireCompanyScopedPurchases(journal);
  const existing = journal.purchases.find((item) => item.company === company && item.taskId === taskId);
  if (existing) {
    if (existing.serviceId !== args.serviceId || existing.url !== service.url ||
        existing.payTo !== service.payTo || existing.signerHash !== signerHash(args.signerSecret)) {
      throw new Error("x402 task ID is bound to different payment terms or signer");
    }
    if (existing.status === "paid" || existing.status === "free") return { ...existing, repeated: true };
    if (existing.status === "rejected") throw new Error("x402 task was rejected; use a new task after review");
    throw new Error("x402 task has an unresolved payment; reconcile before retrying");
  }
  const committed = journal.purchases.filter((item) => item.company === company && item.serviceId === args.serviceId &&
    item.period === period && !["free", "rejected"].includes(item.status)).reduce((sum, item) =>
      sum + BigInt(item.status === "paid" ? item.amountMicro! : item.reservedMicro), 0n);
  if (committed + BigInt(service.maxMicro) > BigInt(service.periodCapMicro)) {
    throw new Error("x402 period cap exhausted");
  }
  journal.purchases.push({ company, taskId, serviceId: args.serviceId, period,
    url: service.url, payTo: service.payTo, signerHash: signerHash(args.signerSecret),
    reservedMicro: service.maxMicro, amountMicro: null, status: "pending",
    transaction: null, createdAt: now.toISOString() });
  saveJournal(journal);
  let selectedAmount: string | null = null;
  let observedTransaction: string | null = null;
  try {
    const response = await (args.paymentFetch ?? defaultPaymentFetch)(service, args.signerSecret,
      args.rpcUrl, (amount) => {
        if (!/^[1-9][0-9]*$/.test(amount) || BigInt(amount) > BigInt(service.maxMicro)) {
          throw new Error("x402 selected payment exceeds the approved per-call cap");
        }
        selectedAmount = amount;
      });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      let reason = "";
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const detail = parsed.errorReason ?? parsed.error;
        if (typeof detail === "string") reason = `: ${detail.slice(0, 240)}`;
      } catch { /* The merchant may send an HTML paywall. */ }
      throw new Error(`x402 resource returned HTTP ${response.status}${reason}`);
    }
    const rawReceipt = response.headers.get("PAYMENT-RESPONSE");
    if (!rawReceipt) {
      if (selectedAmount !== null) throw new Error("Paid x402 response has no settlement receipt");
      updatePurchase(company, taskId, "free", null, null);
      return { company, taskId, serviceId: args.serviceId, status: "free", repeated: false };
    }
    const receipt = decodePaymentResponseHeader(rawReceipt);
    if (receipt.success !== true || receipt.network !== NETWORK ||
        typeof receipt.transaction !== "string" || !receipt.transaction || selectedAmount === null ||
        (receipt.amount !== undefined && receipt.amount !== selectedAmount)) {
      throw new Error("x402 settlement receipt is missing or invalid");
    }
    observedTransaction = receipt.transaction;
    const confirmed = args.confirmTransaction ? await args.confirmTransaction(receipt.transaction) :
      await confirmedX402Transfer(args.rpcUrl, args.signerSecret, service,
        selectedAmount, receipt.transaction);
    if (!confirmed) throw new Error("x402 settlement is not confirmed");
    const resourceText = (await response.text()).slice(0, 4_000);
    updatePurchase(company, taskId, "paid", selectedAmount, receipt.transaction);
    return { company, taskId, serviceId: args.serviceId, status: "paid", amountMicro: selectedAmount,
      transaction: receipt.transaction, resourceText, repeated: false };
  } catch (error) {
    updatePurchase(company, taskId, "uncertain", selectedAmount, observedTransaction);
    throw error;
  }
}

export async function reconcileX402Purchase(args: { company: unknown; taskId: unknown; serviceId: unknown;
  registry: X402Registry; signerSecret: string; rpcUrl: string;
  confirmTransaction?: (signature: string) => Promise<boolean> }): Promise<Record<string, unknown>> {
  const company = asAddress(args.company, "company");
  const taskId = paymentId(args.taskId);
  if (typeof args.serviceId !== "string" || !Object.hasOwn(args.registry, args.serviceId)) {
    throw new Error("x402 service is not allowlisted");
  }
  const journal = readJournal();
  requireCompanyScopedPurchases(journal);
  const purchase = journal.purchases.find((item) => item.company === company && item.taskId === taskId);
  if (!purchase || purchase.serviceId !== args.serviceId) throw new Error("Unknown x402 task");
  const service = args.registry[args.serviceId]!;
  if (purchase.url !== service.url || purchase.payTo !== service.payTo ||
      purchase.signerHash !== signerHash(args.signerSecret)) {
    throw new Error("x402 task payment terms or signer changed");
  }
  if (purchase.status !== "uncertain" || !purchase.transaction || !purchase.amountMicro) {
    throw new Error("x402 task has no known settlement receipt to reconcile");
  }
  if (BigInt(purchase.amountMicro) > BigInt(service.maxMicro)) throw new Error("x402 receipt exceeds current service cap");
  const confirmed = args.confirmTransaction ? await args.confirmTransaction(purchase.transaction) :
    await confirmedX402Transfer(args.rpcUrl, args.signerSecret, service,
      purchase.amountMicro, purchase.transaction);
  if (!confirmed) return { company, taskId, status: "uncertain", transaction: purchase.transaction,
    nextAction: "wait_and_recheck; do_not_retry_payment" };
  const settled = updatePurchase(company, taskId, "paid", purchase.amountMicro,
    purchase.transaction, "uncertain");
  return { ...settled, repeated: false, reconciled: true };
}

export async function resolveRejectedX402Purchase(args: { company: unknown; taskId: unknown; serviceId: unknown;
  registry: X402Registry; signerSecret: string; rpcUrl: string; now?: Date;
  scanSignerHistory?: (payer: string, sinceUnixSeconds: number) =>
    Promise<Array<ParsedTransactionWithMeta | null>> }): Promise<Record<string, unknown>> {
  const company = asAddress(args.company, "company");
  const taskId = paymentId(args.taskId);
  if (typeof args.serviceId !== "string" || !Object.hasOwn(args.registry, args.serviceId)) {
    throw new Error("x402 service is not allowlisted");
  }
  const journal = readJournal();
  requireCompanyScopedPurchases(journal);
  const purchase = journal.purchases.find((item) => item.company === company && item.taskId === taskId);
  const service = args.registry[args.serviceId]!;
  if (!purchase || purchase.serviceId !== args.serviceId || purchase.url !== service.url ||
      purchase.payTo !== service.payTo || purchase.signerHash !== signerHash(args.signerSecret)) {
    throw new Error("x402 task payment terms or signer changed");
  }
  if (purchase.status !== "uncertain" || purchase.transaction) {
    throw new Error("Only an uncertain x402 task without a receipt can be resolved as rejected");
  }
  const now = args.now ?? new Date();
  if (now.getTime() - Date.parse(purchase.createdAt) < 3 * 60_000) {
    throw new Error("Wait for the signed transaction blockhash to expire before resolving rejection");
  }
  const payer = Keypair.fromSecretKey(base58.decode(args.signerSecret)).publicKey.toBase58();
  const since = Math.floor(Date.parse(purchase.createdAt) / 1_000) - 60;
  const scan = args.scanSignerHistory ?? (async (owner: string, sinceUnixSeconds: number) => {
    const rpc = new Connection(args.rpcUrl, "finalized");
    const signatures = await rpc.getSignaturesForAddress(new PublicKey(owner),
      { limit: 1_000 }, "finalized");
    if (signatures.length === 1_000 &&
        (signatures.at(-1)!.blockTime == null || signatures.at(-1)!.blockTime! >= sinceUnixSeconds)) {
      throw new Error("x402 signer history is too long to prove no settlement");
    }
    const recent = signatures.filter((entry) => entry.blockTime == null ||
      entry.blockTime >= sinceUnixSeconds);
    return Promise.all(recent.map((entry) => rpc.getParsedTransaction(entry.signature,
      { commitment: "finalized", maxSupportedTransactionVersion: 0 })));
  });
  const history = await scan(payer, since);
  for (const transaction of history) {
    if (!transaction?.meta) throw new Error("x402 signer history could not be verified");
    const balances = [...(transaction.meta.preTokenBalances ?? []),
      ...(transaction.meta.postTokenBalances ?? [])];
    if (balances.some((row) => row.mint === DEVNET_USDC && !row.owner)) {
      throw new Error("x402 token balance owner is missing from signer history");
    }
    if (transaction.meta.err === null && usdcDelta(transaction, payer) < 0n) {
      throw new Error("x402 signer spent USDC after this attempt; reconcile manually");
    }
  }
  const rejected = updatePurchase(company, taskId, "rejected", purchase.amountMicro, null, "uncertain");
  return { ...rejected, resolution: "No finalized signer USDC debit before blockhash expiry" };
}
