import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Set MERCURY_SUPABASE_URL and MERCURY_SUPABASE_SECRET_KEY in backend/.env.local");
await store.healthcheck();
console.log(JSON.stringify({ result: "PASS", service: "supabase", privateRecords: "reachable" }));
