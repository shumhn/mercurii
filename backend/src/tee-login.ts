import { asAddress } from "./magicblock.ts";
import { assertTeeTokenActor } from "./assistant-auth.ts";
import { TEE_RPC } from "./operations.ts";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

/**
 * Wallet-driven TEE login. The backend brokers MagicBlock's challenge/login
 * flow so browser clients never hand-roll it: the wallet signs the TEE
 * challenge, the backend verifies that signature locally, forwards the login,
 * and only returns a token whose own claims name the same wallet. The TEE
 * remains the token issuer and enforcer; Mercury adds wallet/company binding
 * at its own edge.
 */
type FetchLike = typeof fetch;

type ChallengeResponse = { challenge?: unknown; error?: unknown };
type LoginResponse = { token?: unknown; expiresAt?: unknown; error?: unknown };

export async function createTeeLoginChallenge(input: {
  wallet: unknown; teeRpc?: string; fetchImpl?: FetchLike;
}): Promise<{ wallet: string; challenge: string; message: string }> {
  const wallet = asAddress(input.wallet, "wallet");
  const rpc = input.teeRpc ?? TEE_RPC;
  const response = await (input.fetchImpl ?? fetch)(
    `${rpc}/auth/challenge?pubkey=${encodeURIComponent(wallet)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const body = await response.json() as ChallengeResponse;
  if (!response.ok || typeof body.error === "string" && body.error.length > 0) {
    throw new Error(`TEE challenge failed${typeof body.error === "string" ? `: ${body.error}` : ` (${response.status})`}`);
  }
  if (typeof body.challenge !== "string" || body.challenge.length === 0 || body.challenge.length > 2_048) {
    throw new Error("TEE returned no usable challenge");
  }
  return { wallet, challenge: body.challenge,
    message: "Sign this exact challenge with your wallet to log in to the private Mercury validator" };
}

export async function completeTeeLogin(input: {
  wallet: unknown; challenge: unknown; signature: unknown; teeRpc?: string; fetchImpl?: FetchLike;
  now?: number;
}): Promise<{ wallet: string; token: string; expiresAt: number }> {
  const wallet = asAddress(input.wallet, "wallet");
  if (typeof input.challenge !== "string" || input.challenge.length === 0 || input.challenge.length > 2_048) {
    throw new Error("challenge is required");
  }
  if (typeof input.signature !== "string") throw new Error("Wallet signature required");
  let signature: Uint8Array;
  try { signature = bs58.decode(input.signature); } catch { throw new Error("Invalid wallet signature"); }
  if (signature.length !== nacl.sign.signatureLength ||
      !nacl.sign.detached.verify(Buffer.from(input.challenge, "utf8"), signature, new PublicKey(wallet).toBytes())) {
    throw new Error("Wallet signature does not match the TEE challenge");
  }
  const rpc = input.teeRpc ?? TEE_RPC;
  const response = await (input.fetchImpl ?? fetch)(`${rpc}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pubkey: wallet, challenge: input.challenge, signature: input.signature }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as LoginResponse;
  if (response.status !== 200 || typeof body.token !== "string" || body.token.length === 0) {
    throw new Error(`TEE login failed${typeof body.error === "string" ? `: ${body.error}` : ` (${response.status})`}`);
  }
  // Never hand out a token whose claims name a different wallet.
  assertTeeTokenActor(body.token, wallet, input.now);
  let expiresAt = typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt) ?
    body.expiresAt : 0;
  if (expiresAt === 0) {
    // The validator omits expiresAt; the JWT's own exp claim (seconds) is the
    // same expiry its ACL checks enforce.
    const payload = JSON.parse(Buffer.from(body.token.split(".")[1]!, "base64url").toString("utf8")) as
      { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) expiresAt = payload.exp * 1000;
  }
  return { wallet, token: body.token, expiresAt };
}
