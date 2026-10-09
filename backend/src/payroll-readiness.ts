import { PublicKey } from "@solana/web3.js";
import { DEVNET_USDC, asAddress, asMicroAmount, canonicalTokenAccount } from "./magicblock.ts";

export type PayrollReadinessItem = {
  recipient: string; amountMicro: number;
  tokenAccount: string; status: "ready" | "needs_onboarding" | "unavailable";
};

function itemsFrom(value: unknown): Array<{ recipient: string; amountMicro: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("Payroll readiness requires 1 to 100 employees");
  }
  const recipients = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid employee at index ${index}`);
    const row = item as Record<string, unknown>;
    const recipient = asAddress(row.recipient, `items[${index}].recipient`);
    if (!PublicKey.isOnCurve(new PublicKey(recipient).toBytes())) {
      throw new Error(`items[${index}].recipient must be a wallet owner`);
    }
    if (recipients.has(recipient)) throw new Error("Each employee may appear only once in a payroll run");
    recipients.add(recipient);
    return { recipient, amountMicro: asMicroAmount(row.amountMicro) };
  });
}

export async function checkPayrollReadiness(args: {
  items: unknown;
  isRegistered?: (recipient: string) => boolean;
}): Promise<{ items: PayrollReadinessItem[]; totalMicro: string; readyCount: number }> {
  const rows = itemsFrom(args.items);
  const isRegistered = args.isRegistered ?? (() => false);
  const result: PayrollReadinessItem[] = [];
  // Keep private RPC load bounded; this is not a payroll-size or spending cap.
  for (let offset = 0; offset < rows.length; offset += 5) {
    const batch = rows.slice(offset, offset + 5).map((row) => {
      const tokenAccount = canonicalTokenAccount(row.recipient, DEVNET_USDC);
      try {
        const ready = isRegistered(row.recipient);
        return { ...row, tokenAccount, status: ready ? "ready" as const : "needs_onboarding" as const };
      } catch {
        return { ...row, tokenAccount, status: "unavailable" as const };
      }
    });
    result.push(...batch);
  }
  const total = rows.reduce((sum, row) => sum + BigInt(row.amountMicro), 0n);
  return { items: result, totalMicro: total.toString(), readyCount: result.filter((item) => item.status === "ready").length };
}
