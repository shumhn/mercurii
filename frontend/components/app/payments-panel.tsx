"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, FileClock, ShieldCheck } from "lucide-react";
import { parseUsdc, shortAddress, type PaymentRow } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, DataState, inputClass, Notice, PaymentItem, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof, TxProof } from "./tx-proof";

type ReceiptState = { id: string; signed: string; status: string;
  signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

export type PaymentDraft = { recipient: string; amountMicro: number; paymentId?: string };
type FlowResult = { paymentId: string; request?: string; step: { status: string; operation?: string | null; actor?: string | null; reason?: string };
  observation?: { status?: string }; transaction?: PreparedTransaction | null; receiptId?: string;
  paymentJob?: { prepare: string; status: string }; record?: { state: string } };
type ReceiptResult = { status?: string; receipt?: { status?: string;
  signature?: string | null; chain?: "base" | "ephemeral" }; next?: string };
type ExecutionStatus = { record: { state: string; signature: string | null }; requestStatus: string;
  chainStatus: string | null; integrityWarning: string | null; snapshotNeedsSync: boolean | null };
type RejectionStep = { status: "build" | "wait" | "ready"; receiptId?: string;
  receiptStatus?: string; transaction?: PreparedTransaction };

function validAddress(value: string) { try { return new PublicKey(value).toBase58() === value; } catch { return false; } }
function errorText(cause: unknown) { return cause instanceof Error ? cause.message : "Action failed"; }

export function PaymentsPanel({ app, draft, onDraftChange }: { app: MercuriiController; draft: PaymentDraft | null;
  onDraftChange: (draft: PaymentDraft | null) => void }) {
  const session = app.session!;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [includeFinance, setIncludeFinance] = useState(true);
  const [manager, setManager] = useState("");
  const [managerGrant, setManagerGrant] = useState("");
  const [branchId, setBranchId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [flow, setFlow] = useState<FlowResult | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [executionSigned, setExecutionSigned] = useState<{ paymentId: string; bytes: string; broadcast: string } | null>(null);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus | null>(null);
  const [rejection, setRejection] = useState<RejectionStep | null>(null);
  const [rejectionSigned, setRejectionSigned] = useState<{ id: string; bytes: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = draft?.paymentId ? draft : null;
  const displayRecipient = draft?.recipient ?? recipient;
  const displayAmount = draft ? (draft.amountMicro / 1_000_000).toString() : amount;
  const currentId = selected?.paymentId ?? paymentId;
  const unresolvedSignature = Boolean(receipt && !["confirmed", "failed"].includes(receipt.status)) ||
    Boolean(rejectionSigned && !["confirmed", "failed", "expired"].includes(rejectionSigned.status)) ||
    Boolean(executionSigned && executionStatus?.requestStatus !== "executed");

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  function createTerms() {
    if (!validAddress(displayRecipient)) throw new Error("Enter a valid Solana recipient address");
    const amountMicro = draft?.amountMicro ?? parseUsdc(displayAmount);
    if (session.role !== "founder" && !session.grantAddress) throw new Error("An active requester grant is required");
    if (manager && !validAddress(manager)) throw new Error("Enter a valid manager address");
    if (managerGrant && !validAddress(managerGrant)) throw new Error("Enter a valid manager grant address");
    const branch = branchId ? Number(branchId) : undefined;
    if (manager && (branch === undefined || !Number.isInteger(branch) || branch < 1 || branch > 0xffffff)) {
      throw new Error("Manager approval requires a numeric branch ID from 1 to 16777215");
    }
    return { actor: session.address, requester: session.address, recipient: displayRecipient,
      amountMicro, includeFinance, ...(payeeId ? { payeeId } : {}),
      ...(manager ? { manager, branchId: branch } : {}),
      ...(session.role !== "founder" ? { requesterGrant: session.grantAddress } : {}),
      ...(managerGrant ? { grant: managerGrant } : {}) };
  }

  async function next(id = currentId, input = terms) {
    if (!id || !input) throw new Error("Prepare a payment first");
    const result = await app.request<FlowResult>(`/v1/payment-flows/${id}/next`, input);
    setFlow(result); setPaymentId(id);
    setReceipt((prior) => prior?.status === "confirmed" && result.receiptId !== prior.id ? null : prior);
    setMessage(result.step.status === "wait" ? "Previous signed step is still settling. Reconcile its receipt before continuing." :
      result.step.status === "ready_to_execute" ? "Approved. The payment is ready for a separate execution signature." : null);
  }

  async function prepare() {
    if (unresolvedSignature) throw new Error("Reconcile the signed payment or inspect its settlement before starting another request.");
    const input = createTerms();
    const id = selected?.paymentId ?? crypto.randomUUID();
    setTerms(input); setPaymentId(id); setFlow(null); setReceipt(null); setExecutionSigned(null); setExecutionStatus(null);
    setRejection(null); setRejectionSigned(null);
    const result = await app.request<FlowResult>(`/v1/payment-flows/${id}/next`, input);
    setFlow(result);
  }

  async function loadExisting(id: string) {
    if (unresolvedSignature && id !== currentId) throw new Error("Finish the current signed payment before opening another request.");
    const result = await app.request<FlowResult & { requester: string; terms?: {
      requester: string; recipient: string; amountMicro: string; includeFinance: boolean;
      manager: string | null; branchId: number | null } }>(`/v1/payment-flows/${id}`);
    if (!result.terms) throw new Error("Private terms are not ready or this wallet has no read access");
    const t = result.terms;
    setRecipient(t.recipient); setAmount((Number(t.amountMicro) / 1_000_000).toString());
    setIncludeFinance(t.includeFinance); setManager(t.manager ?? ""); setBranchId(t.branchId?.toString() ?? "");
    const activeGrant = app.members.value?.flatMap((entry) => entry.grants)
      .find((grant) => grant.address === session.grantAddress);
    setTerms({ actor: session.address, requester: t.requester, recipient: t.recipient,
      amountMicro: Number(t.amountMicro), includeFinance: t.includeFinance,
      ...(t.manager ? { manager: t.manager, branchId: t.branchId } : {}),
      ...(session.role !== "founder" && session.grantAddress ? { grant: session.grantAddress,
        ...(t.requester === session.address ? { requesterGrant: session.grantAddress } : {}),
        ...(session.role === "manager" && activeGrant ? { parentGrant: activeGrant.parent } : {}) } : {}) });
    setPaymentId(id); setFlow(result);
    if (id !== currentId) { setReceipt(null); setExecutionSigned(null); setExecutionStatus(null);
      setRejection(null); setRejectionSigned(null); }
    onDraftChange(null);
    setMessage("Private request loaded. Review the terms before signing the next step.");
  }

  async function signStep() {
    if (!flow?.transaction || !flow.receiptId || !app.wallet) throw new Error("No prepared step is available");
    if (receipt?.id === flow.receiptId) throw new Error("This step was already signed. Reconcile its original receipt.");
    if (flow.step.actor && flow.step.actor !== session.address) throw new Error(`This step requires ${shortAddress(flow.step.actor)}`);
    const signed = await signPrepared(app.wallet, session.address, flow.transaction);
    const id = flow.receiptId;
    // Keep the exact signed bytes in memory. An uncertain network response must
    // be reconciled against this receipt, never silently rebuilt.
    setReceipt({ id, signed: signed.signedTransactionBase64, status: "signed" });
    const confirmed = await app.request<ReceiptResponse & { broadcast: string }>(`/v1/onboarding/receipts/${id}/submit`,
      { signedTransactionBase64: signed.signedTransactionBase64 });
    setReceipt({ id, signed: signed.signedTransactionBase64, status: confirmed.receipt.status,
      signature: confirmed.receipt.signature ?? null, chain: confirmed.receipt.chain });
    setMessage(`Receipt ${confirmed.receipt.status} · broadcast ${confirmed.broadcast}. Continue when the private state has settled.`);
    await app.refresh();
  }

  async function reconcile() {
    const id = receipt?.id ?? flow?.receiptId;
    if (!id) throw new Error("There is no receipt to reconcile");
    const result = await app.request<ReceiptResult>(`/v1/onboarding/receipts/${id}/reconcile`,
      receipt ? { signedTransactionBase64: receipt.signed } : {});
    if (receipt) setReceipt({ ...receipt, status: result.receipt?.status ?? result.status ?? "pending",
      signature: result.receipt?.signature ?? receipt.signature, chain: result.receipt?.chain ?? receipt.chain });
    setMessage(result.next ?? "Receipt reconciled");
    await app.refresh();
  }

  async function execute() {
    if (!app.capabilities.paymentExecution) throw new Error("Payment execution is disabled on this backend");
    if (!app.wallet || !currentId) throw new Error("Select an approved payment");
    const prepared = await app.request<{ transaction?: PreparedTransaction | null; next?: string }>(
      `/v1/payment-jobs/${currentId}/prepare`, { actor: session.address,
        ...(session.role !== "founder" && session.grantAddress ? { grant: session.grantAddress } : {}) });
    if (!prepared.transaction) { setMessage(prepared.next ?? "This request is not ready for execution."); return; }
    const signed = await signPrepared(app.wallet, session.address, prepared.transaction);
    setExecutionSigned({ paymentId: currentId, bytes: signed.signedTransactionBase64, broadcast: "signed" });
    const outcome = await app.request<{ broadcast: string }>(`/v1/payment-jobs/${currentId}/submit`,
      { signedTransactionBase64: signed.signedTransactionBase64 });
    setExecutionSigned({ paymentId: currentId, bytes: signed.signedTransactionBase64, broadcast: outcome.broadcast });
    setMessage(outcome.broadcast === "uncertain" ? "Broadcast is uncertain. Check payment status before retrying; keep this tab open." :
      "Signed payment submitted. Check settlement status.");
    await app.refresh();
  }
  async function retryOriginalExecution() {
    if (!executionSigned || executionSigned.paymentId !== currentId) throw new Error("Original signed payment is not available");
    const outcome = await app.request<{ broadcast: string }>(`/v1/payment-jobs/${currentId}/submit`,
      { signedTransactionBase64: executionSigned.bytes });
    setExecutionSigned({ ...executionSigned, broadcast: outcome.broadcast });
    setMessage(`Original signed payment: ${outcome.broadcast}. Check chain status before any new attempt.`);
    await app.refresh();
  }
  async function inspectExecution() {
    if (!currentId) throw new Error("Select a payment first");
    const status = await app.request<ExecutionStatus>(`/v1/payment-jobs/${currentId}`);
    setExecutionStatus(status);
    setMessage(`Private request ${status.requestStatus} · chain ${status.chainStatus ?? "unavailable"} · job ${status.record.state}`);
    await app.refresh();
  }
  async function rebuildExpiredExecution() {
    if (!currentId) throw new Error("Select a payment first");
    const result = await app.request<{ record: { state: string } }>(`/v1/payment-jobs/${currentId}/rebuild`, {});
    setExecutionSigned(null);
    setExecutionStatus(null);
    setMessage(`Prior blockhash verified expired. Job is ${result.record.state}; inspect and prepare again when safe.`);
    await app.refresh();
  }
  async function prepareRejection() {
    if (!currentId || flow?.observation?.status !== "submitted") throw new Error("Open a submitted payment first");
    if (receipt && !["confirmed", "failed"].includes(receipt.status)) throw new Error("Reconcile the payment step first");
    if (rejectionSigned) throw new Error("Reconcile the original rejection signature first");
    const result = await app.request<RejectionStep>(`/v1/payment-flows/${currentId}/reject`, {
      actor: session.address,
      ...(session.role !== "founder" && session.grantAddress ? { grant: session.grantAddress } : {}),
      ...(session.role === "manager" ? { parentGrant: app.members.value?.flatMap((entry) => entry.grants)
        .find((grant) => grant.address === session.grantAddress)?.parent } : {}),
    });
    setRejection(result);
    setMessage(result.status === "build" ? "Review this irreversible rejection and sign with the authorized wallet." :
      result.status === "wait" ? "A rejection receipt is already in progress. Check its original signature before continuing." :
      "Request is already rejected.");
  }
  async function signRejection() {
    if (!rejection?.transaction || !rejection.receiptId || !app.wallet || rejectionSigned) throw new Error("No unsigned rejection is ready");
    const signed = await signPrepared(app.wallet, session.address, rejection.transaction);
    const original = { id: rejection.receiptId, bytes: signed.signedTransactionBase64, status: "signed" };
    setRejectionSigned(original);
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${original.id}/submit`, { signedTransactionBase64: original.bytes });
    setRejectionSigned({ ...original, status: result.receipt.status });
    setMessage(`Rejection ${result.receipt.status} · broadcast ${result.broadcast}. Reconcile before another action.`);
  }
  async function reconcileRejection() {
    if (!rejectionSigned) throw new Error("Original rejection signature is unavailable in this tab");
    const result = await app.request<{ receipt: { status: string }; next: string }>(
      `/v1/onboarding/receipts/${rejectionSigned.id}/reconcile`,
      { signedTransactionBase64: rejectionSigned.bytes });
    setRejectionSigned({ ...rejectionSigned, status: result.receipt.status });
    setMessage(`Rejection receipt ${result.receipt.status} · ${result.next.replaceAll("_", " ")}.`);
    if (result.receipt.status === "confirmed") { await app.refresh(); await next(); }
  }
  async function retryRejection() {
    if (!rejectionSigned) throw new Error("Original rejection signature is unavailable");
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${rejectionSigned.id}/submit`,
      { signedTransactionBase64: rejectionSigned.bytes });
    setRejectionSigned({ ...rejectionSigned, status: result.receipt.status });
    setMessage(`Same rejection signature: ${result.receipt.status} · ${result.broadcast}.`);
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      {session.role === "manager" ? <Notice title="Approve a branch request" detail="Open a private request ID shared with your branch. A matching active Manager grant and Finance parent are required." /> : <section className={`${cardClass} p-5 sm:p-7`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-brand">01 / Request</p>
        <h2 className="mt-2 text-xl font-semibold">Create a private payment</h2><p className="mt-1 text-sm text-app-muted">Terms stay in this tab while each private step is signed.</p></div>
        {draft && <button className={secondaryButtonClass} disabled={unresolvedSignature} onClick={() => onDraftChange(null)}>Clear payroll selection</button>}</div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Recipient wallet<input className={`${inputClass} mt-2 font-mono`} value={displayRecipient} onChange={(e) => draft ? onDraftChange({ ...draft, recipient: e.target.value }) : setRecipient(e.target.value)} placeholder="Solana address" /></label>
          <label className="text-sm font-medium">Amount (USDC)<input className={`${inputClass} mt-2`} value={displayAmount} readOnly={Boolean(draft)} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
          <label className="text-sm font-medium">Registered payee ID <span className="font-normal text-app-muted">optional</span><select className={`${inputClass} mt-2`} value={payeeId} onChange={(e) => setPayeeId(e.target.value)}><option value="">No registry link</option>{app.payees.value?.filter((item) => item.active).map((item) => <option key={item.payeeId} value={item.payeeId}>{item.kind} · {shortAddress(item.payeeId)}</option>)}</select></label>
          <label className="text-sm font-medium">Manager address <span className="font-normal text-app-muted">optional</span><input className={`${inputClass} mt-2 font-mono`} value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Branch approval signer" /></label>
          {manager && <><label className="text-sm font-medium">Manager grant<input className={`${inputClass} mt-2 font-mono`} value={managerGrant} onChange={(e) => setManagerGrant(e.target.value)} placeholder="Grant PDA" /></label><label className="text-sm font-medium">Branch ID<input className={`${inputClass} mt-2`} value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="Branch scope" /></label></>}
        </div><label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={includeFinance} onChange={(e) => setIncludeFinance(e.target.checked)} className="size-4 accent-brand" />Include Finance in private request readers</label>
        <div className="mt-6 flex flex-wrap gap-3"><button className={buttonClass} disabled={busy || unresolvedSignature} onClick={() => void run(prepare)}>Prepare request <ArrowRight className="size-4" /></button>
          {currentId && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(() => next())}>Check next step</button>}</div>
      </section>}
      <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-base font-semibold">Open an existing request</h2><p className="mt-1 text-sm text-app-muted">Use its private payment ID to review terms and continue from the confirmed step.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><label htmlFor="payment-lookup" className="sr-only">Payment ID</label><input id="payment-lookup" className={`${inputClass} font-mono`} value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Payment UUID" />
          <button className={secondaryButtonClass} disabled={busy || !lookupId.trim() || unresolvedSignature && lookupId.trim() !== currentId} onClick={() => void run(() => loadExisting(lookupId.trim()))}>Open request</button></div></section>
      {currentId && <section className={`${cardClass} p-5 sm:p-7`}><p className="text-xs font-semibold uppercase tracking-wider text-brand">02 / Signed workflow</p>
        <h2 className="mt-2 text-xl font-semibold">Request {shortAddress(currentId)}</h2>
        <p className="mt-2 text-sm text-app-muted">{flow?.step.reason ?? `Next: ${flow?.step.status.replaceAll("_", " ") ?? "Check state"}`}</p>
        {flow?.transaction && <div className="mt-5 rounded-xl border border-app-line bg-app-canvas p-4 text-sm"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand" />Sign {flow.transaction.operation ?? flow.step.operation}</div>
          <p className="mt-2 text-app-muted">Signer: {shortAddress(flow.step.actor ?? session.address)} · {flow.transaction.sendTo === "ephemeral" ? "Private Ephemeral Rollup" : "Solana devnet"}</p></div>}
        <div className="mt-5 flex flex-wrap gap-3">{flow?.transaction && <button className={buttonClass} disabled={busy || Boolean(receipt) || Boolean(flow.step.actor && flow.step.actor !== session.address)} onClick={() => void run(signStep)}>{receipt ? "Step signed · reconcile" : "Review & sign in wallet"}</button>}
          {(receipt || flow?.receiptId) && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(reconcile)}>Check status</button>}
          {flow?.step.status === "ready_to_execute" && (app.capabilities.paymentExecution ?
            <button className={buttonClass} disabled={busy || executionSigned?.paymentId === currentId} onClick={() => void run(execute)}>{executionSigned?.paymentId === currentId ? "Execution signed · inspect" : "Sign & submit payment"}</button> :
            <span className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">Execution is disabled on this backend</span>)}
          {flow?.paymentJob && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(inspectExecution)}>Inspect settlement</button>}</div>
        {flow?.observation?.status === "submitted" && ["founder", "finance", "manager"].includes(session.role) &&
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm"><p className="font-semibold text-red-900">Reject this request</p>
            <p className="mt-1 text-red-800">The authorized approver signs a private rejection. It cannot be executed afterward.</p>
            <div className="mt-3 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy || unresolvedSignature || Boolean(rejection)} onClick={() => void run(prepareRejection)}>Prepare rejection</button>
              {rejection?.transaction && <button className={buttonClass} disabled={busy || Boolean(rejectionSigned)} onClick={() => void run(signRejection)}>Review & sign rejection</button>}
              {rejectionSigned && <><button className={secondaryButtonClass} disabled={busy} onClick={() => void run(reconcileRejection)}>Reconcile rejection</button>
                {rejectionSigned.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(retryRejection)}>Retry same signature</button>}</>}</div></div>}
        {receipt && <div className="mt-4"><ReceiptProof receipt={receipt} label="Request step" /></div>}
        {!receipt && flow?.receiptId && <p className="mt-3 text-xs text-app-muted">Receipt pending signature · check status to continue</p>}
        {executionSigned?.paymentId === currentId && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-950">Original signed execution · {executionSigned.broadcast}</p>
          <p className="mt-1 text-amber-900">Keep this tab open until the chain status is known. A retry uses these exact signed bytes.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={() => void run(inspectExecution)}>Check chain status</button>
            {executionSigned.broadcast === "uncertain" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(retryOriginalExecution)}>Retry same signature</button>}</div>
        </div>}
        {executionStatus && <div className="mt-4 rounded-xl border border-app-line bg-app-canvas p-4 text-sm">
          <p className="font-semibold">Request {executionStatus.requestStatus.replaceAll("_", " ")} · chain {executionStatus.chainStatus ?? "unavailable"}</p>
          <p className="mt-1 text-app-muted">Job: {executionStatus.record.state.replaceAll("_", " ")}</p>
          {executionStatus.record.signature && <div className="mt-3"><TxProof signature={executionStatus.record.signature} label="Settlement transaction" status={executionStatus.chainStatus} /></div>}
          {executionStatus.integrityWarning && <p role="alert" className="mt-2 text-red-700">{executionStatus.integrityWarning}</p>}
          {executionStatus.snapshotNeedsSync && <p className="mt-2 text-amber-800">Founder must sync the treasury snapshot from Records.</p>}
          {executionStatus.requestStatus === "approved" && executionStatus.record.state === "prepared" &&
            <button className={`${secondaryButtonClass} mt-3`} disabled={busy} onClick={() => void run(rebuildExpiredExecution)}>Verify expiry before rebuilding</button>}
        </div>}
      </section>}
      {(error || message) && <div role={error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-brand/20 bg-brand/5 text-brand"}`}>{error ?? message}</div>}
    </div>
    <section className={`${cardClass} h-fit p-5`}><div className="flex items-center gap-2"><FileClock className="size-4 text-brand" /><h2 className="text-base font-semibold">Payment ledger</h2></div>
      <p className="mt-1 text-xs leading-5 text-app-muted">Visible only when your private role permits company payment history.</p>
      {session.role === "founder" || session.role === "finance" ? <div className="mt-5"><DataState resource={app.payments} empty="No private payment records yet." retry={app.refresh}>{(rows: PaymentRow[]) => <div className="divide-y divide-app-line">{rows.map((row) => <button key={row.record.paymentId} className="w-full text-left focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50" disabled={unresolvedSignature} onClick={() => { setPaymentId(row.record.paymentId); setTerms(null); setFlow(null); setReceipt(null); setExecutionSigned(null); setExecutionStatus(null); onDraftChange(null); }}><PaymentItem row={row} /></button>)}</div>}</DataState></div> :
        <Notice title="Scoped payment view" detail="The company ledger is not visible to this role. You can continue a payment while its terms remain in this tab." />}
          {currentId && <div className="mt-5 border-t border-app-line pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Selected request</p><p className="mt-1 break-all font-mono text-xs">{currentId}</p>
        {!terms && <button className={`${buttonClass} mt-3 w-full`} disabled={busy} onClick={() => void run(() => loadExisting(currentId))}>Open private request</button>}
        <button className={`${secondaryButtonClass} mt-3 w-full`} disabled={busy} onClick={() => void run(async () => {
          const status = await app.request<{ observation?: { status: string } }>(`/v1/payment-flows/${currentId}`);
          setMessage(`Private request: ${status.observation?.status ?? "unknown"}`); await app.refresh();
        })}>Check settlement</button></div>}
    </section>
  </div>;
}
