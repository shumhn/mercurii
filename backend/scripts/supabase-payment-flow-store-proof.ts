import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { DatabasePaymentFlowStore } from "../src/database-payment-flow-store.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

process.env.MERCURY_PAYMENT_FLOW_STORE = "supabase";
const raw = SupabasePrivateStore.fromEnvironment();
const flows = DatabasePaymentFlowStore.fromEnvironment();
if (!raw || !flows) throw new Error("Supabase payment-flow storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const requester = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
await raw.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const id = randomUUID();
const first = await flows.getOrCreate(id, company, { requester, recipient, amountMicro: 7_500_000, includeFinance: true });
const duplicate = await flows.getOrCreate(id, company, { requester, recipient, amountMicro: 7_500_000, includeFinance: true });
const readers = await flows.recordedRequestReaders(company);
await flows.applyConfirmedReaderCleanup(company, first.flow.request, "all");
const cleaned = await flows.get(id, company);
if (first.flow.request !== duplicate.flow.request || !readers.get(first.flow.request)?.includeFinance ||
    cleaned.includeFinance !== false || cleaned.manager !== null || cleaned.includeRequester !== false) {
  throw new Error("Database-primary payment-flow proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryPaymentFlow: true, idempotentFlow: true, readerCleanupPersisted: true }));
