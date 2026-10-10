import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { DatabasePayrollScheduleStore } from "../src/database-payroll-schedule-store.ts";
import { sealPayrollRoster } from "../src/payroll-roster-crypto.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";

process.env.MERCURY_PAYROLL_SCHEDULE_STORE = "supabase";
const raw = SupabasePrivateStore.fromEnvironment();
const schedules = DatabasePayrollScheduleStore.fromEnvironment();
if (!raw || !schedules) throw new Error("Supabase payroll schedule storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
await raw.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const now = new Date().toISOString();
const first = { scheduleId: randomUUID(), company, name: "Proof payroll", cadence: "monthly" as const,
  firstPayDate: "2026-10-30", timeZone: "UTC", encryptedRoster: sealPayrollRoster([{ employee: "private" }], "proof-passphrase"),
  paused: false, revision: 0, rosterRevision: 1, createdAt: now, updatedAt: now };
await schedules.persist(first);
const updated = { ...first, paused: true, revision: 1, updatedAt: new Date().toISOString() };
await schedules.persist(updated);
const restored = (await schedules.list(company)).find((item) => item.scheduleId === first.scheduleId);
if (!restored || restored.paused !== true || restored.revision !== 1) {
  throw new Error("Database-primary payroll schedule proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryPayrollSchedule: true, revisionPersisted: true }));
