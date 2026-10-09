import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { requestBranchScope, readCompanyPolicy, readPaymentRequest, readTeamGrant, readTreasurySnapshot } from "./operations.ts";

export type AssistantRole = "founder" | "finance" | "manager" | "requester" | "viewer";
export type AssistantIntent = "treasury_balance" | "payment_status" | "unsupported";
export type AssistantAccess = { actor: string; role: AssistantRole; scope: string | null };

function formatUsdc(micro: unknown): string {
  if (typeof micro !== "string" || !/^\d+$/.test(micro)) throw new Error("Invalid private USDC amount");
  const amount = BigInt(micro);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}

export async function resolveAssistantAccess(args: {
  company: string; founder: string; actor: unknown; grant?: unknown; teeToken: string;
  readPolicy?: typeof readCompanyPolicy; readGrant?: typeof readTeamGrant;
}): Promise<AssistantAccess> {
  const company = asAddress(args.company, "company");
  const founder = asAddress(args.founder, "founder");
  const actor = asAddress(args.actor, "actor");
  if (!args.teeToken) throw new Error("TEE auth token required");
  const readPolicy = args.readPolicy ?? readCompanyPolicy;
  const readGrant = args.readGrant ?? readTeamGrant;
  if (actor === founder) {
    const policy = await readPolicy(company, args.teeToken);
    if (policy.founder !== founder || policy.address !== company) throw new Error("Wrong private company policy");
    return { actor, role: "founder", scope: null };
  }
  const address = asAddress(args.grant, "grant");
  const grant = await readGrant(company, address, args.teeToken);
  if (grant.member !== actor || grant.company !== company || grant.active !== true || grant.revoked !== false) {
    throw new Error("Active grant for this wallet is required");
  }
  const zero = PublicKey.default.toBase58();
  const role = Number(grant.role);
  if (role === 1) {
    const policy = await readPolicy(company, args.teeToken);
    if (policy.founder !== founder || policy.finance !== actor || grant.grantor !== founder ||
        grant.parent !== zero || grant.scope !== zero) throw new Error("Active root Finance grant required");
    return { actor, role: "finance", scope: null };
  }
  if (role === 2) {
    const parentAddress = asAddress(grant.parent, "parent grant");
    if (parentAddress === zero || grant.scope === zero) throw new Error("Manager needs a branch grant");
    const parent = await readGrant(company, parentAddress, args.teeToken);
    if (parent.role !== 1 || parent.active !== true || parent.revoked !== false ||
        parent.member !== grant.grantor || parent.grantor !== founder || parent.parent !== zero ||
        parent.scope !== zero || parent.company !== company) throw new Error("Manager parent grant is inactive");
    return { actor, role: "manager", scope: String(grant.scope) };
  }
  if ((role === 3 || role === 4) && grant.grantor === founder && grant.parent === zero) {
    return { actor, role: role === 3 ? "requester" : "viewer",
      scope: grant.scope === zero ? null : asAddress(grant.scope, "scope") };
  }
  throw new Error("Grant role or delegation is not supported by the assistant");
}

export async function answerAssistantQuestion(args: {
  company: string; access: AssistantAccess; teeToken: string; intent: AssistantIntent;
  requestAddress?: unknown; readSnapshot?: typeof readTreasurySnapshot;
  readRequest?: typeof readPaymentRequest;
}): Promise<Record<string, unknown>> {
  const company = asAddress(args.company, "company");
  if (args.intent === "treasury_balance") {
    if (args.access.role !== "founder" && args.access.role !== "finance") {
      throw new Error("This role cannot view the company treasury balance");
    }
    const snapshot = await (args.readSnapshot ?? readTreasurySnapshot)(company, args.teeToken);
    return { intent: args.intent, role: args.access.role, facts: {
      balanceMicro: snapshot.balanceMicro, updatedSlot: snapshot.updatedSlot,
    }, answer: `Last synced company treasury balance: ${formatUsdc(snapshot.balanceMicro)} USDC (slot ${snapshot.updatedSlot}). The balance may have changed since then.` };
  }
  if (args.intent === "payment_status") {
    const requestAddress = asAddress(args.requestAddress, "requestAddress");
    const request = await (args.readRequest ?? readPaymentRequest)(company, requestAddress, args.teeToken);
    if (args.access.role === "manager" || args.access.scope) {
      const branch = requestBranchScope(new PublicKey(company), String(request.id)).toBase58();
      if (branch !== args.access.scope) throw new Error("Payment is outside this member's branch");
    }
    if (args.access.role === "requester" && request.requester !== args.access.actor) {
      throw new Error("Requester can only view their own payment requests");
    }
    return { intent: args.intent, role: args.access.role, facts: {
      requestAddress, status: request.status, amountMicro: request.amountMicro,
      recipient: request.recipient,
    }, answer: `Payment of ${formatUsdc(request.amountMicro)} USDC is ${request.status}. This is the private request state; check payout reconciliation for the final receipt.` };
  }
  return { intent: "unsupported", role: args.access.role, facts: {},
    answer: "I can check the treasury snapshot or a specific private payment request. Select a payment to ask about its status." };
}

export async function classifyAssistantQuestion(args: {
  question: unknown; modelUrl: string; modelName: string; modelApiKey?: string;
  allowRemoteModel?: boolean; fetchImpl?: typeof fetch;
}): Promise<AssistantIntent> {
  if (typeof args.question !== "string" || args.question.trim().length < 3 || args.question.length > 1000) {
    throw new Error("Question must be 3 to 1000 characters");
  }
  const endpoint = new URL(args.modelUrl);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Model URL must use HTTP(S)");
  if (!args.allowRemoteModel && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("Remote model requires an explicit privacy opt-in");
  }
  if (!args.modelName.trim()) throw new Error("Model name required");
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST", headers: { "content-type": "application/json",
      ...(args.modelApiKey ? { authorization: `Bearer ${args.modelApiKey}` } : {}) },
    body: JSON.stringify({ model: args.modelName, temperature: 0, messages: [
      { role: "system", content: "Classify the user's question. Return JSON only: {\"intent\":\"treasury_balance\"|\"payment_status\"|\"unsupported\"}. Do not invent account data or request an action. Payment creation, approval and signing are unsupported here." },
      { role: "user", content: args.question },
    ] }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Assistant model failed (${response.status})`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Assistant model returned no text");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("Assistant model returned invalid JSON"); }
  const intent = (parsed as { intent?: unknown })?.intent;
  if (intent !== "treasury_balance" && intent !== "payment_status" && intent !== "unsupported") {
    throw new Error("Assistant model returned an unsupported intent");
  }
  return intent;
}
