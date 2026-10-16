export type FundingReceiptStatus = "built" | "pending" | "confirmed" | "failed" | "expired" | null;

export type FundingJournalEntry = {
  target: string;
  operation: string;
  status: Exclude<FundingReceiptStatus, null>;
};

export function resumableFundingTarget(receipts: FundingJournalEntry[]): string | null {
  const deposit = [...receipts].reverse().find((receipt) =>
    receipt.operation === "privateReceive" && receipt.status === "confirmed");
  if (!deposit) return null;
  const completed = receipts.some((receipt) => receipt.target === deposit.target &&
    receipt.operation === "syncTreasurySnapshot" && receipt.status === "confirmed");
  return completed ? null : deposit.target;
}

export function nextTreasuryFundingStep(
  observedBalanceMicro: string | null,
  targetBalanceMicro: number,
  receiptStatus: FundingReceiptStatus,
): "ready" | "build_deposit" | "wait_for_receipt" | "build_snapshot_sync" {
  if (!Number.isSafeInteger(targetBalanceMicro) || targetBalanceMicro <= 0) {
    throw new Error("targetBalanceMicro must be a positive safe integer");
  }
  if (observedBalanceMicro !== null) {
    if (!/^\d+$/.test(observedBalanceMicro)) throw new Error("Invalid treasury snapshot balance");
    if (BigInt(observedBalanceMicro) >= BigInt(targetBalanceMicro)) return "ready";
  }
  if (receiptStatus === "built" || receiptStatus === "pending") return "wait_for_receipt";
  if (receiptStatus === "confirmed") return "build_snapshot_sync";
  return "build_deposit";
}
