import { Keypair } from "@solana/web3.js";
import { appendAgentAudit, listAgentAudit, loadAgentSession, saveAgentSession } from "../src/agent-records.ts";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { TEE_VALIDATOR } from "../src/operations.ts";
import { SupabasePrivateStore } from "../src/supabase-private-store.ts";

process.env.MERCURY_AGENT_RECORD_STORE = "supabase";
const store = SupabasePrivateStore.fromEnvironment();
if (!store) throw new Error("Supabase agent record storage is not configured");
const company = Keypair.generate().publicKey.toBase58();
const founder = Keypair.generate().publicKey.toBase58();
const actor = Keypair.generate().publicKey.toBase58();
await store.registerCompany({ companyId: company, founderWallet: founder, policyAddress: company,
  mintAddress: DEVNET_USDC, perValidator: TEE_VALIDATOR.toBase58() });
const identity = { company, actor, access: { actor, role: "finance" as const, scope: null }, grant: null };
const id = await saveAgentSession({ ...identity, data: { requestAddress: null, payrollRunId: null,
  verifiedAnswers: ["Verified private answer"] } });
const recovered = await loadAgentSession({ ...identity, id });
await appendAgentAudit({ company, actor, grant: null, event: "tool", tool: "get_treasury_snapshot",
  details: { private: true } });
const audit = await listAgentAudit(company, actor, null);
if (recovered.verifiedAnswers[0] !== "Verified private answer" || audit[0]?.tool !== "get_treasury_snapshot") {
  throw new Error("Database-primary agent record proof failed");
}
console.log(JSON.stringify({ result: "PASS", encryptedDbPrimaryAgentRecords: true, sessionId: id }));
