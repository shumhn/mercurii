import { Connection, PublicKey } from "@solana/web3.js";

const DEFAULT_PAYMENTS_URL = "https://payments.magicblock.app";
const DEFAULT_ROUTER_URL = "https://devnet-router.magicblock.app";
const DEFAULT_TEE_RPC = "https://devnet-tee.magicblock.app";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export type UnsignedPrivateReceive = {
  kind: "transfer";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  sendRpcEndpoint?: string;
  requiredSigners: string[];
  validator?: string;
};

export type UnsignedRecipientWithdrawal = {
  kind: "withdraw";
  transactionBase64: string;
  sendTo: "base";
  requiredSigners: string[];
  validator: string;
};

export function asAddress(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a Solana address`);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${label} must be a Solana address`);
  }
}

export function asMicroAmount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("amountMicro must be a positive safe integer");
  }
  return value as number;
}

export function canonicalTokenAccount(owner: unknown, mint: unknown): string {
  const ownerKey = new PublicKey(asAddress(owner, "owner"));
  const mintKey = new PublicKey(asAddress(mint, "mint"));
  return PublicKey.findProgramAddressSync(
    [ownerKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKey.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0].toBase58();
}

export async function preparePrivateReceive(args: {
  payer: unknown;
  company: unknown;
  amountMicro: unknown;
  teeToken?: string;
  fetchImpl?: typeof fetch;
  paymentsUrl?: string;
  cluster?: string;
  expectedValidator?: string;
}): Promise<UnsignedPrivateReceive> {
  const payer = asAddress(args.payer, "payer");
  const company = asAddress(args.company, "company");
  return buildPrivateDeposit({ ...args, payer, destination: company });
}

export async function prepareRecipientOnboarding(args: {
  payer: unknown;
  recipient: unknown;
  amountMicro: unknown;
  teeToken?: string;
  fetchImpl?: typeof fetch;
  paymentsUrl?: string;
  cluster?: string;
  expectedValidator?: string;
}): Promise<UnsignedPrivateReceive> {
  const payer = asAddress(args.payer, "payer");
  const recipient = asAddress(args.recipient, "recipient");
  if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) {
    throw new Error("Recipient onboarding requires a wallet owner, not a PDA");
  }
  return buildPrivateDeposit({ ...args, payer, destination: recipient });
}

async function buildPrivateDeposit(args: {
  payer: string;
  destination: string;
  amountMicro: unknown;
  teeToken?: string;
  fetchImpl?: typeof fetch;
  paymentsUrl?: string;
  cluster?: string;
  expectedValidator?: string;
}): Promise<UnsignedPrivateReceive> {
  const { payer, destination } = args;
  const amount = asMicroAmount(args.amountMicro);
  const mint = DEVNET_USDC;
  const cluster = args.cluster ?? "devnet-private";
  const endpoint = new URL("/v1/spl/transfer", args.paymentsUrl ?? DEFAULT_PAYMENTS_URL);
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(args.teeToken ? { authorization: `Bearer ${args.teeToken}` } : {}),
    },
    body: JSON.stringify({
      from: payer,
      to: destination,
      mint,
      amount,
      visibility: "private",
      fromBalance: "base",
      toBalance: "ephemeral",
      cluster,
      ...(args.expectedValidator ? { validator: asAddress(args.expectedValidator, "expectedValidator") } : {}),
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = (await response.text()).slice(0, 500);
    throw new Error(`MagicBlock receive builder failed (${response.status}): ${error}`);
  }
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid builder response");
  const tx = payload as Record<string, unknown>;
  if (
    tx.kind !== "transfer" ||
    typeof tx.transactionBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(tx.transactionBase64) ||
    (tx.sendTo !== "base" && tx.sendTo !== "ephemeral") ||
    !Array.isArray(tx.requiredSigners) ||
    !tx.requiredSigners.includes(payer)
  ) {
    throw new Error("Builder response is not an unsigned transfer for the payer");
  }
  if (args.expectedValidator && tx.validator !== asAddress(args.expectedValidator, "expectedValidator")) {
    throw new Error("Builder selected a different PER validator");
  }
  return {
    kind: "transfer",
    transactionBase64: tx.transactionBase64,
    sendTo: tx.sendTo,
    sendRpcEndpoint: typeof tx.sendRpcEndpoint === "string" ? tx.sendRpcEndpoint : undefined,
    requiredSigners: tx.requiredSigners as string[],
    validator: typeof tx.validator === "string" ? tx.validator : undefined,
  };
}

export async function prepareRecipientWithdrawal(args: {
  owner: unknown;
  mint: unknown;
  amountMicro: unknown;
  validator: unknown;
  fetchImpl?: typeof fetch;
  paymentsUrl?: string;
  cluster?: string;
}): Promise<UnsignedRecipientWithdrawal> {
  const owner = asAddress(args.owner, "owner");
  if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes())) {
    throw new Error("Recipient withdrawal requires a wallet owner, not a PDA");
  }
  const mint = asAddress(args.mint, "mint");
  const validator = asAddress(args.validator, "validator");
  const amount = asMicroAmount(args.amountMicro);
  const endpoint = new URL("/v1/spl/withdraw", args.paymentsUrl ?? DEFAULT_PAYMENTS_URL);
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner, mint, amount, cluster: args.cluster ?? "devnet-private", validator,
      initAtasIfMissing: true, idempotent: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = (await response.text()).slice(0, 500);
    throw new Error(`MagicBlock withdrawal builder failed (${response.status}): ${error}`);
  }
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid withdrawal builder response");
  const tx = payload as Record<string, unknown>;
  if (
    tx.kind !== "withdraw" ||
    typeof tx.transactionBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(tx.transactionBase64) ||
    tx.sendTo !== "base" ||
    !Array.isArray(tx.requiredSigners) ||
    !tx.requiredSigners.includes(owner) ||
    tx.validator !== validator
  ) {
    throw new Error("Builder response is not a wallet-signed withdrawal for the selected PER validator");
  }
  return {
    kind: "withdraw",
    transactionBase64: tx.transactionBase64,
    sendTo: "base",
    requiredSigners: tx.requiredSigners as string[],
    validator,
  };
}

export async function readRecipientBalance(args: {
  owner: unknown;
  mint: unknown;
  teeToken: string;
  teeRpc?: string;
}): Promise<{ owner: string; mint: string; tokenAccount: string; location: "ephemeral"; balanceMicro: string }> {
  const owner = new PublicKey(asAddress(args.owner, "owner"));
  if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error("Recipient must be a wallet owner");
  const mint = new PublicKey(asAddress(args.mint, "mint"));
  if (!args.teeToken) throw new Error("TEE auth token required");
  const tokenAccount = new PublicKey(canonicalTokenAccount(owner.toBase58(), mint.toBase58()));
  const endpoint = new URL(args.teeRpc ?? DEFAULT_TEE_RPC);
  endpoint.searchParams.set("token", args.teeToken);
  const account = await new Connection(endpoint.toString(), "confirmed").getAccountInfo(tokenAccount);
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length < 72) {
    throw new Error("Private recipient token balance unavailable");
  }
  if (!new PublicKey(account.data.subarray(0, 32)).equals(mint) ||
      !new PublicKey(account.data.subarray(32, 64)).equals(owner)) {
    throw new Error("Recipient token account mint or owner mismatch");
  }
  return {
    owner: owner.toBase58(), mint: mint.toBase58(), tokenAccount: tokenAccount.toBase58(),
    location: "ephemeral", balanceMicro: account.data.readBigUInt64LE(64).toString(),
  };
}

export async function delegationStatus(args: {
  account: unknown;
  fetchImpl?: typeof fetch;
  routerUrl?: string;
}): Promise<Record<string, unknown>> {
  const account = asAddress(args.account, "account");
  const endpoint = new URL("/getDelegationStatus", args.routerUrl ?? DEFAULT_ROUTER_URL);
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [account] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Router request failed (${response.status})`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new Error("Invalid router response");
  }
  const result = (body as { result: unknown }).result;
  if (typeof result !== "object" || result === null) throw new Error("Invalid delegation status");
  return result as Record<string, unknown>;
}

export { DEVNET_USDC };
