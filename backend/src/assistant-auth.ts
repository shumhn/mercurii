import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";
import { paymentId } from "./payment-journal.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";

export type X402PurchaseIntent = { serviceId: string; taskId: string; url: string;
  payTo: string; maxMicro: string };
type Challenge = { actor: string; company: string; message: string; expiresAt: number;
  x402Intent: X402PurchaseIntent | null };
type ChallengeResponse = { challengeId: string; message: string; expiresAt: string };
const challenges = new Map<string, Challenge>();
const TTL_MS = 5 * 60_000;
const MAX_PENDING = 1_024;

// MagicBlock signs this JWT with a server-held HS256 key. This checks the
// claimed wallet; the subsequent private PER read verifies the token itself.
export function assertTeeTokenActor(token: string, actorInput: unknown, now = Date.now()): void {
  const actor = asAddress(actorInput, "actor");
  const parts = token.split(".");
  if (token.length > 4096 || parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error("Invalid TEE token format");
  }
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch { throw new Error("Invalid TEE token format"); }
  const claims = payload as { pubkey?: unknown; exp?: unknown };
  if ((header as { alg?: unknown })?.alg !== "HS256" || claims?.pubkey !== actor ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now) {
    throw new Error("TEE token wallet does not match the signed actor or has expired");
  }
}

function normalizeX402Intent(intent: X402PurchaseIntent | undefined): X402PurchaseIntent | null {
  if (!intent) return null;
  if (!/^[a-z0-9_-]{1,40}$/.test(intent.serviceId) ||
      !/^https?:\/\//.test(intent.url) || !/^[1-9][0-9]*$/.test(intent.maxMicro)) {
    throw new Error("Invalid signed x402 purchase intent");
  }
  return { serviceId: intent.serviceId, taskId: paymentId(intent.taskId), url: intent.url,
    payTo: asAddress(intent.payTo, "x402 payTo"), maxMicro: intent.maxMicro };
}

export function createAssistantChallenge(companyInput: unknown, actorInput: unknown,
  now = Date.now(), purchase?: X402PurchaseIntent): ChallengeResponse {
  const company = asAddress(companyInput, "company");
  const actor = asAddress(actorInput, "actor");
  const challengeId = randomBytes(24).toString("hex");
  const expiresAt = now + TTL_MS;
  const x402Intent = normalizeX402Intent(purchase);
  const description = x402Intent ?
    `Mercury agent session (read private data, prepare unsigned drafts, and allow one isolated-wallet x402 purchase)\nX402 service: ${x402Intent.serviceId}\nX402 task: ${x402Intent.taskId}\nX402 URL: ${x402Intent.url}\nX402 recipient: ${x402Intent.payTo}\nX402 maximum: ${x402Intent.maxMicro} micro USDC` :
    "Mercury agent session (read private data and prepare unsigned drafts; never approve or pay)";
  const message = `${description}\nCompany: ${company}\nWallet: ${actor}\nNonce: ${challengeId}\nExpires: ${new Date(expiresAt).toISOString()}`;
  for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(id);
  if (challenges.size >= MAX_PENDING) challenges.delete(challenges.keys().next().value!);
  challenges.set(challengeId, { actor, company, message, expiresAt, x402Intent });
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}

function assertAssistantChallenge(args: {
  challenge: Challenge | undefined; company: unknown; actor: unknown; signature: unknown; now?: number;
  x402Intent?: X402PurchaseIntent;
}): string {
  const company = asAddress(args.company, "company");
  const actor = asAddress(args.actor, "actor");
  const challenge = args.challenge;
  if (!challenge || challenge.company !== company || challenge.actor !== actor ||
      challenge.expiresAt <= (args.now ?? Date.now())) throw new Error("Assistant challenge expired or already used");
  const intent = normalizeX402Intent(args.x402Intent);
  if (JSON.stringify(challenge.x402Intent) !== JSON.stringify(intent)) {
    throw new Error("Signed x402 purchase terms do not match the request");
  }
  if (typeof args.signature !== "string") throw new Error("Wallet signature required");
  let signature: Uint8Array;
  try { signature = bs58.decode(args.signature); } catch { throw new Error("Invalid wallet signature"); }
  if (signature.length !== nacl.sign.signatureLength ||
      !nacl.sign.detached.verify(Buffer.from(challenge.message), signature, new PublicKey(actor).toBytes())) {
    throw new Error("Wallet signature does not match the assistant challenge");
  }
  return actor;
}

export function consumeAssistantChallenge(args: {
  company: unknown; actor: unknown; challengeId: unknown; signature: unknown; now?: number;
  x402Intent?: X402PurchaseIntent;
}): string {
  if (typeof args.challengeId !== "string" || !/^[0-9a-f]{48}$/.test(args.challengeId)) {
    throw new Error("Invalid assistant challenge");
  }
  const challenge = challenges.get(args.challengeId);
  challenges.delete(args.challengeId);
  return assertAssistantChallenge({ ...args, challenge });
}

/** Durable, encrypted assistant login for a configured Supabase deployment. */
export async function createPersistentAssistantChallenge(companyInput: unknown, actorInput: unknown,
  now = Date.now(), purchase?: X402PurchaseIntent): Promise<ChallengeResponse> {
  const response = createAssistantChallenge(companyInput, actorInput, now, purchase);
  if (process.env.MERCURY_SUPABASE_PERSISTENCE !== "1") return response;
  const store = SupabasePrivateStore.fromEnvironment();
  if (!store) throw new Error("Supabase persistence is enabled but not configured");
  const challenge = challenges.get(response.challengeId);
  if (!challenge) throw new Error("Assistant challenge was not created");
  await store.put({ companyId: challenge.company, domain: "assistant-challenge", recordId: response.challengeId,
    payload: challenge, metadata: { kind: "assistant_challenge", state: "pending" } });
  return response;
}

export async function consumePersistentAssistantChallenge(args: {
  company: unknown; actor: unknown; challengeId: unknown; signature: unknown; now?: number;
  x402Intent?: X402PurchaseIntent;
}): Promise<string> {
  if (typeof args.challengeId !== "string" || !/^[0-9a-f]{48}$/.test(args.challengeId)) {
    throw new Error("Invalid assistant challenge");
  }
  if (process.env.MERCURY_SUPABASE_PERSISTENCE !== "1") return consumeAssistantChallenge(args);
  const company = asAddress(args.company, "company");
  const store = SupabasePrivateStore.fromEnvironment();
  if (!store) throw new Error("Supabase persistence is enabled but not configured");
  const stored = await store.get<Challenge>(company, "assistant-challenge", args.challengeId);
  const claimed = await store.claimPendingRecord(company, "assistant-challenge", args.challengeId, "assistant_challenge");
  if (!claimed) throw new Error("Assistant challenge expired or already used");
  return assertAssistantChallenge({ ...args, challenge: stored ?? undefined });
}
