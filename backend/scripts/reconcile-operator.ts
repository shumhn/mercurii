import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { TEE_RPC } from "../src/operations.ts";

const keyPath = process.env.MERCURY_FOUNDER_KEYPAIR;
if (!keyPath) throw new Error("MERCURY_FOUNDER_KEYPAIR is required");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const backendUrl = new URL(process.env.MERCURY_BACKEND_URL ?? "http://127.0.0.1:8787");
if (backendUrl.protocol !== "http:" && backendUrl.protocol !== "https:") throw new Error("Invalid backend URL");
if (backendUrl.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(backendUrl.hostname)) {
  throw new Error("Remote backend URL must use HTTPS for the TEE token");
}
const watch = process.argv.includes("--watch");
const intervalMs = Number(process.env.MERCURY_RECONCILIATION_INTERVAL_MS ?? "60000");
if (watch && (!Number.isSafeInteger(intervalMs) || intervalMs < 10_000)) {
  throw new Error("MERCURY_RECONCILIATION_INTERVAL_MS must be at least 10000");
}

async function sweep(): Promise<void> {
  const auth = await getAuthToken(TEE_RPC, founder.publicKey, async (message: Uint8Array) =>
    nacl.sign.detached(message, founder.secretKey));
  let paymentOffset: number | null = 0;
  let receiptOffset: number | null = 0;
  let paymentCount = 0;
  let receiptCount = 0;
  const actions: Record<string, number> = {};
  do {
    const response = await fetch(new URL("/v1/reconciliation/run", backendUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({ paymentOffset: paymentOffset ?? Number.MAX_SAFE_INTEGER,
        receiptOffset: receiptOffset ?? Number.MAX_SAFE_INTEGER, limit: 50 }),
    });
    const page = await response.json() as {
      error?: string;
      payments?: { next: string }[]; receipts?: { next: string }[];
      nextPaymentOffset?: number | null; nextReceiptOffset?: number | null;
    };
    if (!response.ok || !page.payments || !page.receipts) {
      throw new Error(`Reconciliation failed (${response.status}): ${page.error ?? "invalid response"}`);
    }
    paymentCount += page.payments.length;
    receiptCount += page.receipts.length;
    for (const item of [...page.payments, ...page.receipts]) actions[item.next] = (actions[item.next] ?? 0) + 1;
    paymentOffset = page.nextPaymentOffset ?? null;
    receiptOffset = page.nextReceiptOffset ?? null;
  } while (paymentOffset !== null || receiptOffset !== null);
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), paymentCount, receiptCount, actions }) + "\n");
}

do {
  try { await sweep(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (!watch) process.exitCode = 1;
  }
  if (watch) await new Promise((resolve) => setTimeout(resolve, intervalMs));
} while (watch);
