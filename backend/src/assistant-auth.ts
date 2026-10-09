import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { asAddress } from "./magicblock.ts";

type Challenge = { actor: string; company: string; message: string; expiresAt: number };
const challenges = new Map<string, Challenge>();
const TTL_MS = 5 * 60_000;
const MAX_PENDING = 1_024;

export function createAssistantChallenge(companyInput: unknown, actorInput: unknown,
  now = Date.now()): { challengeId: string; message: string; expiresAt: string } {
  const company = asAddress(companyInput, "company");
  const actor = asAddress(actorInput, "actor");
  const challengeId = randomBytes(24).toString("hex");
  const expiresAt = now + TTL_MS;
  const message = `Mercury agent session (read private data and prepare unsigned drafts; never approve or pay)\nCompany: ${company}\nWallet: ${actor}\nNonce: ${challengeId}\nExpires: ${new Date(expiresAt).toISOString()}`;
  for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(id);
  if (challenges.size >= MAX_PENDING) challenges.delete(challenges.keys().next().value!);
  challenges.set(challengeId, { actor, company, message, expiresAt });
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}

export function consumeAssistantChallenge(args: {
  company: unknown; actor: unknown; challengeId: unknown; signature: unknown; now?: number;
}): string {
  const company = asAddress(args.company, "company");
  const actor = asAddress(args.actor, "actor");
  if (typeof args.challengeId !== "string" || !/^[0-9a-f]{48}$/.test(args.challengeId)) {
    throw new Error("Invalid assistant challenge");
  }
  const challenge = challenges.get(args.challengeId);
  challenges.delete(args.challengeId);
  if (!challenge || challenge.company !== company || challenge.actor !== actor ||
      challenge.expiresAt <= (args.now ?? Date.now())) throw new Error("Assistant challenge expired or already used");
  if (typeof args.signature !== "string") throw new Error("Wallet signature required");
  let signature: Uint8Array;
  try { signature = bs58.decode(args.signature); } catch { throw new Error("Invalid wallet signature"); }
  if (signature.length !== nacl.sign.signatureLength ||
      !nacl.sign.detached.verify(Buffer.from(challenge.message), signature, new PublicKey(actor).toBytes())) {
    throw new Error("Wallet signature does not match the assistant challenge");
  }
  return actor;
}
