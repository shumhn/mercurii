import { randomUUID } from "node:crypto";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

const company = process.env.MERCURY_COMPANY_ADDRESS;
if (!company) throw new Error("Set MERCURY_COMPANY_ADDRESS");
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set Supabase server configuration");
const recordId = `cas-${randomUUID()}`;
await store.put({ companyId: company, domain: "cas-proof", recordId, payload: { phase: "created" },
  metadata: { kind: "proof" } });
const initial = await store.get<{ phase: string }>(company, "cas-proof", recordId);
if (!initial || initial.recordVersion !== 1) throw new Error("Initial record version missing");
const updated = await store.compareAndSwap({ companyId: company, domain: "cas-proof", recordId,
  expectedVersion: initial.recordVersion, payload: { phase: "updated" }, metadata: { kind: "proof" } });
const stale = await store.compareAndSwap({ companyId: company, domain: "cas-proof", recordId,
  expectedVersion: initial.recordVersion, payload: { phase: "stale" }, metadata: { kind: "proof" } });
const final = await store.get<{ phase: string }>(company, "cas-proof", recordId);
if (updated !== 2 || stale !== null || final?.phase !== "updated" || final.recordVersion !== 2) {
  throw new Error("Compare-and-swap proof failed");
}
console.log(JSON.stringify({ result: "PASS", optimisticConcurrency: "first update accepted, stale update denied" }));
