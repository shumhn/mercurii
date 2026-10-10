import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { DatabaseOnboardingReceiptStore } from "../src/database-onboarding-receipt-store.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

process.env.MERCURY_ONBOARDING_RECEIPT_STORE = "supabase";
const raw = SupabasePrivateStore.fromEnvironment();
const receipts = DatabaseOnboardingReceiptStore.fromEnvironment();
if (!raw || !receipts) throw new Error("Supabase onboarding receipt storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
await raw.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const id = createHash("sha256").update(`receipt-proof:${Date.now()}:${company}`).digest("hex");
const built = { id, company, target: "private-request", operation: "submitPayment", chain: "ephemeral" as const,
  signature: null, blockhash: "proof-blockhash", status: "built" as const, createdAt: new Date().toISOString(), error: null };
await receipts.record(built);
await receipts.record(built);
const pending = await receipts.update(company, id, (receipt) => ({ ...receipt, signature: "proof-signature", status: "pending" }));
const confirmed = await receipts.update(company, id, (receipt) => ({ ...receipt, status: "confirmed" }));
const latest = await receipts.latest(company, "private-request", "submitPayment");
if (pending.status !== "pending" || confirmed.status !== "confirmed" || latest?.id !== id) {
  throw new Error("Database-primary onboarding receipt proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryOnboardingReceipt: true, idempotentBuild: true, casTransition: true }));
