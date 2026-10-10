import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { DatabasePaymentStore } from "../src/database-payment-store.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

process.env.MERCURY_PAYMENT_STATE_STORE = "supabase";
const raw = SupabasePrivateStore.fromEnvironment();
const payments = DatabasePaymentStore.fromEnvironment();
if (!raw || !payments) throw new Error("Supabase primary storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const requester = Keypair.generate().publicKey.toBase58();
const request = Keypair.generate().publicKey.toBase58();
const id = randomUUID();
await raw.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const first = await payments.register({ paymentId: id, company, request, requester, requestId: "101" });
const duplicate = await payments.register({ paymentId: id, company, request, requester, requestId: "101" });
const settled = await payments.reconcile(id, company, "executed", "confirmed");
const [loaded, rows] = await Promise.all([payments.get(id, company), payments.list(company)]);
if (first.state !== "registered" || duplicate.paymentId !== id || settled.state !== "settled" ||
    loaded.state !== "settled" || rows.length !== 1 || rows[0]!.paymentId !== id) {
  throw new Error("Database-primary payment store proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryPayment: true, idempotentRegistration: true, state: loaded.state }));
