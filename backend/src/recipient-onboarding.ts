import { PublicKey } from "@solana/web3.js";
import {
  DEVNET_USDC, asAddress, asMicroAmount, prepareRecipientOnboarding, readRecipientBalance,
  type UnsignedPrivateReceive,
} from "./magicblock.ts";
import { TEE_VALIDATOR } from "./operations.ts";

export async function nextRecipientOnboarding(args: {
  recipient: unknown; payer: unknown; amountMicro: unknown; teeToken: string;
  receipt?: { id: string; status: "built" | "pending" | "confirmed" | "failed" | "expired" } | null;
  readBalance?: typeof readRecipientBalance;
  buildDeposit?: typeof prepareRecipientOnboarding;
}): Promise<{
  status: "needs_deposit" | "wait" | "ready"; recipient: string;
  balanceMicro: string | null; transaction: UnsignedPrivateReceive | null;
  receiptId: string | null;
}> {
  if (!args.teeToken) throw new Error("Recipient TEE auth token required");
  const recipient = asAddress(args.recipient, "recipient");
  if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) {
    throw new Error("Recipient must be a wallet owner, not a PDA");
  }
  const payer = asAddress(args.payer, "payer");
  const amountMicro = asMicroAmount(args.amountMicro);
  try {
    const balance = await (args.readBalance ?? readRecipientBalance)({
      owner: recipient, mint: DEVNET_USDC, teeToken: args.teeToken,
    });
    return { status: "ready", recipient, balanceMicro: balance.balanceMicro, transaction: null, receiptId: null };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Private recipient token balance unavailable") throw error;
  }
  if (args.receipt && args.receipt.status !== "failed" && args.receipt.status !== "expired") {
    return { status: "wait", recipient, balanceMicro: null, transaction: null, receiptId: args.receipt.id };
  }
  const transaction = await (args.buildDeposit ?? prepareRecipientOnboarding)({
    payer, recipient, amountMicro, teeToken: args.teeToken,
    expectedValidator: TEE_VALIDATOR.toBase58(),
  });
  return { status: "needs_deposit", recipient, balanceMicro: null, transaction, receiptId: null };
}
