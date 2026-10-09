import type { PaymentRecord } from "./payment-journal.ts";

export type ChainObservation = "not_found" | "processed" | "confirmed" | "failed" | "unavailable" | null;

export function paymentRecoveryAction(input: {
  record: PaymentRecord;
  requestStatus: string;
  chainStatus: ChainObservation;
  executionSlot: number | null;
  snapshotSlot: string | null;
}): string {
  const { record, requestStatus, chainStatus, executionSlot, snapshotSlot } = input;
  if (requestStatus === "executed") {
    if (chainStatus !== "confirmed") return "verify_execution_receipt";
    if (executionSlot !== null && snapshotSlot !== null && BigInt(snapshotSlot) < BigInt(executionSlot)) {
      return "sign_snapshot_sync";
    }
    return snapshotSlot === null ? "sign_snapshot_sync" : "complete";
  }
  if (requestStatus === "rejected") return "closed";
  if (requestStatus !== "approved") return "finish_or_review_request";
  if (record.state === "failed" && chainStatus === "failed") return "retry_confirmed_failure";
  if (record.state === "registered") return "prepare_payout";
  if (record.state === "prepared") return "check_blockhash_before_rebuild";
  if (chainStatus === "confirmed") return "investigate_confirmed_signature_without_execution";
  return "wait_or_investigate_original_signature";
}
