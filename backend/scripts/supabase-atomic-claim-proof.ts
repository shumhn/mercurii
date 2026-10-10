import { randomBytes } from "node:crypto";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

const company = process.env.MERCURY_COMPANY_ADDRESS;
if (!company) throw new Error("Set MERCURY_COMPANY_ADDRESS");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set Supabase server configuration");
const challengeId = randomBytes(24).toString("hex");
await store.put({ companyId: company, domain: "assistant-challenge", recordId: challengeId,
  payload: { test: true, expiresAt: Date.now() + 60_000 },
  metadata: { kind: "assistant_challenge", state: "pending" } });
const [first, second] = [
  await store.claimPendingRecord(company, "assistant-challenge", challengeId, "assistant_challenge"),
  await store.claimPendingRecord(company, "assistant-challenge", challengeId, "assistant_challenge"),
];
if (first !== true || second !== false) throw new Error("Pending challenge was not claimed exactly once");
const stored = await store.get<{ test: boolean }>(company, "assistant-challenge", challengeId);
if (!stored?.test || stored.metadata.state !== "consumed") throw new Error("Claimed challenge state was not retained");
console.log(JSON.stringify({ result: "PASS", atomicPendingClaim: "first accepted, replay denied" }));
