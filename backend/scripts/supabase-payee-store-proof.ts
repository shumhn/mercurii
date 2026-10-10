import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { DatabasePayeeStore } from "../src/database-payee-store.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

process.env.MERCURY_PAYEE_STORE = "supabase";
const raw = SupabasePrivateStore.fromEnvironment();
const payees = DatabasePayeeStore.fromEnvironment();
if (!raw || !payees) throw new Error("Supabase payee storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const payeeId = randomUUID();
await raw.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const first = await payees.register(company, { payeeId, kind: "contractor", recipient, teamId: "design" });
const duplicate = await payees.register(company, { payeeId, kind: "contractor", recipient, teamId: "design" });
await payees.match(company, payeeId, recipient);
const link = await payees.linkPayment(company, randomUUID(), payeeId);
const deactivated = await payees.deactivate(company, payeeId);
let rejected = false;
try { await payees.match(company, payeeId, recipient); } catch { rejected = true; }
if (!first.active || !duplicate.active || link.payeeId !== payeeId || deactivated.active || !rejected) {
  throw new Error("Database-primary payee store proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryPayee: true, idempotentRegistration: true, inactivePayeeRejected: true }));
