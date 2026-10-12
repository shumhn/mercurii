"use client";

import { useState } from "react";
import { Bot, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { signMessage, signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/mercurii-client";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, DataState, PaymentItem, secondaryButtonClass } from "./mercurii-app";
import { AgentPolicyPanel } from "./agent-policy-panel";
import { ViewerSharePanel } from "./viewer-share-panel";
import { AgentAuditPanel } from "./agent-audit-panel";

function errorText(cause: unknown) { return cause instanceof Error ? cause.message : "Agent request failed"; }

export function AgentPanel({ app }: { app: MercuriiController }) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"ask" | "payment" | "payroll" | "readiness" | "draft" | "invoice" | "x402">("ask");
  const [payeeId, setPayeeId] = useState(""); const [recipient, setRecipient] = useState("");
  const [requestAddress, setRequestAddress] = useState(""); const [payrollRunId, setPayrollRunId] = useState("");
  const [rosterCsv, setRosterCsv] = useState("");
  const [amount, setAmount] = useState(""); const [draftId, setDraftId] = useState("");
  const [vendorId, setVendorId] = useState(""); const [invoiceText, setInvoiceText] = useState("");
  const [serviceId, setServiceId] = useState(""); const [taskId, setTaskId] = useState("");
  const [purchaseApproved, setPurchaseApproved] = useState(false);
  const [reply, setReply] = useState<unknown>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!prompt.trim() || !app.wallet) return;
    setBusy(true); setError(null);
    try {
      const actor = app.session!.address;
      const purchase = mode === "x402" && purchaseApproved;
      if (mode === "draft" && (!payeeId || !recipient || !amount)) throw new Error("Choose a payee, recipient, and amount");
      if (mode === "draft") { try { new PublicKey(recipient); } catch { throw new Error("Recipient wallet is invalid"); } }
      if (mode === "invoice" && (!vendorId || !invoiceText.trim())) throw new Error("Enter the registered vendor ID and invoice text");
      if (mode === "payment") { try { new PublicKey(requestAddress.trim()); } catch { throw new Error("Enter a valid private payment request address"); } }
      if (mode === "payroll" && !payrollRunId.trim()) throw new Error("Enter a payroll run ID");
      if (mode === "readiness" && !rosterCsv.trim()) throw new Error("Paste a payroll roster CSV");
      if (mode === "x402" && (!serviceId || !taskId)) throw new Error("Enter an approved service ID and a unique task ID");
      const roster = mode === "readiness" ? await app.request<{ canCreateRun: boolean; errors: unknown[];
        items: { recipient: string; amountMicro: number }[] }>("/v1/payroll-runs/preview", { csvText: rosterCsv }) : null;
      if (roster && (!roster.canCreateRun || roster.errors.length || !roster.items.length)) {
        throw new Error("Fix payroll roster validation errors before asking the agent to check readiness");
      }
      const intent = mode === "x402" ? { selectedX402ServiceId: serviceId,
        x402TaskId: taskId, allowX402Purchase: purchase } : {};
      const challenge = await app.request<{ challengeId: string; message: string }>("/v1/assistant/challenge", { actor, ...intent });
      const signature = await signMessage(app.wallet, challenge.message);
      const result = await app.request<Record<string, unknown>>("/v1/agent/chat", {
        actor, challengeId: challenge.challengeId, signature, message: prompt.trim(),
        ...(sessionId ? { sessionId } : {}), ...(app.session?.grantAddress ? { grant: app.session.grantAddress } : {}),
        ...(mode === "draft" ? { requestedTool: "prepare_payment_draft", selectedPayeeId: payeeId,
          selectedRecipient: recipient, selectedAmountMicro: parseUsdc(amount), paymentId: draftId || crypto.randomUUID() } : {}),
        ...(mode === "invoice" ? { requestedTool: "review_invoice", selectedVendorId: vendorId,
          invoiceText: invoiceText.trim() } : {}),
        ...(mode === "payment" ? { requestedTool: "get_payment_status", requestAddress: requestAddress.trim() } : {}),
        ...(mode === "payroll" ? { requestedTool: "get_payroll_run", selectedPayrollRunId: payrollRunId.trim() } : {}),
        ...(roster ? { requestedTool: "check_payroll_readiness", selectedPayrollItems: roster.items.map(
          ({ recipient, amountMicro }) => ({ recipient, amountMicro })) } : {}),
        ...(mode === "x402" ? { ...intent, ...(purchase ? {} : { requestedTool: "inspect_x402_offer" }) } : {}),
      });
      setReply(result); setPrompt("");
      if (typeof result.sessionId === "string") setSessionId(result.sessionId);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const answer = reply && typeof reply === "object" ? reply as Record<string, unknown> : null;
  const rendered = answer ? [answer.reply, answer.answer, answer.message, answer.text].find((value) => typeof value === "string") : null;
  return <div className="space-y-5"><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <section className={`${cardClass} flex min-h-[500px] flex-col p-5 sm:p-7`}><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand text-white"><Bot className="size-5" /></span><div><h2 className="text-lg font-semibold">Mercurii finance agent</h2><p className="text-xs text-app-muted">Signed access · {app.session?.role} scope</p></div></div>
      {!app.capabilities.financeAgent && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The finance agent is disabled on this backend. Its signed chat and tool actions will be available when the backend enables them.</div>}
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Agent task">{([
        ["ask", "Ask records"], ["payment", "Payment status"], ["payroll", "Payroll run"], ["readiness", "Payroll readiness"],
        ["draft", "Prepare payment"], ["invoice", "Review invoice"], ["x402", "x402 tools"],
      ] as const).filter(([id]) => id === "ask" || id === "payment" ||
        (id === "draft" || id === "invoice" || id === "payroll" || id === "readiness") && ["founder", "finance"].includes(app.session?.role ?? "") ||
        id === "x402" && app.session?.role === "founder" && app.capabilities.x402).map(([id, label]) =>
        <button key={id} type="button" className={`rounded-full px-4 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-brand ${mode === id ? "bg-brand text-white" : "border border-app-line bg-white text-app-muted"}`} onClick={() => setMode(id)}>{label}</button>)}</div>
      {mode === "payment" && <div className="mt-5 space-y-2"><label className="block text-xs font-semibold">Private payment request address<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 font-mono text-xs" value={requestAddress} onChange={(e) => setRequestAddress(e.target.value)} placeholder="Request PDA, not payment ID" /></label>
        {app.payments.value && app.payments.value.length > 0 && <select aria-label="Choose a visible payment" className="min-h-10 w-full rounded-lg border border-app-line bg-white px-2 text-xs" value="" onChange={(e) => setRequestAddress(e.target.value)}><option value="">Choose from visible payments</option>{app.payments.value.map((item) => <option key={item.record.paymentId} value={item.record.request}>{shortAddress(item.record.paymentId)} · {item.requestStatus}</option>)}</select>}</div>}
      {mode === "payroll" && <div className="mt-5 space-y-2"><label className="block text-xs font-semibold">Payroll run ID<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 font-mono text-xs" value={payrollRunId} onChange={(e) => setPayrollRunId(e.target.value)} placeholder="Run ID" /></label>
        {app.payrollRuns.value && app.payrollRuns.value.length > 0 && <select aria-label="Choose a visible payroll run" className="min-h-10 w-full rounded-lg border border-app-line bg-white px-2 text-xs" value="" onChange={(e) => setPayrollRunId(e.target.value)}><option value="">Choose from visible runs</option>{app.payrollRuns.value.map((item) => <option key={item.runId} value={item.runId}>{shortAddress(item.runId)} · {item.status}</option>)}</select>}</div>}
      {mode === "readiness" && <label className="mt-5 block text-xs font-semibold">Roster CSV · wallet,amount_usdc,name<textarea className="mt-1 min-h-28 w-full rounded-lg border border-app-line p-3 font-mono text-xs" value={rosterCsv} onChange={(e) => setRosterCsv(e.target.value)} spellCheck={false} /></label>}
      {mode === "draft" && <div className="mt-5 grid gap-3 rounded-xl border border-app-line p-4 sm:grid-cols-2"><label className="text-xs font-semibold">Registered payee<select className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={payeeId} onChange={(e) => setPayeeId(e.target.value)}><option value="">Select payee</option>{app.payees.value?.filter((item) => item.active).map((item) => <option key={item.payeeId} value={item.payeeId}>{item.kind} · {shortAddress(item.payeeId)}</option>)}</select></label>
        <label className="text-xs font-semibold">Recipient wallet<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 font-mono text-xs" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Registered wallet" /></label>
        <label className="text-xs font-semibold">Amount (USDC)<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="text-xs font-semibold">Draft ID <span className="font-normal text-app-muted">generated if blank</span><input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 font-mono text-xs" value={draftId} onChange={(e) => setDraftId(e.target.value)} /></label></div>}
      {mode === "invoice" && <div className="mt-5 space-y-3 rounded-xl border border-app-line p-4"><label className="block text-xs font-semibold">Registered vendor ID<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={vendorId} onChange={(e) => setVendorId(e.target.value)} /></label>
        <label className="block text-xs font-semibold">Invoice text<textarea className="mt-1 min-h-32 w-full rounded-lg border border-app-line p-3 text-sm" value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} placeholder="Paste the invoice details for verification" /></label><p className="text-xs leading-5 text-app-muted">The agent creates a review draft only. Check the original invoice and registered recipient before anyone signs.</p></div>}
      {mode === "x402" && <div className="mt-5 grid gap-3 rounded-xl border border-app-line p-4 sm:grid-cols-2"><label className="text-xs font-semibold">Approved service ID<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPurchaseApproved(false); }} /></label>
        <label className="text-xs font-semibold">Unique task ID<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={taskId} onChange={(e) => { setTaskId(e.target.value); setPurchaseApproved(false); }} /></label>
        <label className="col-span-full flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 accent-brand" checked={purchaseApproved} onChange={(e) => setPurchaseApproved(e.target.checked)} />I authorize the agent to buy from this approved service for this task, within its backend policy cap.</label></div>}
      <div className="my-6 flex-1 rounded-xl border border-app-line bg-app-canvas p-5" aria-live="polite">
        {answer ? <div className="text-sm leading-7 whitespace-pre-wrap">{typeof rendered === "string" ? rendered : <pre className="overflow-auto text-xs">{JSON.stringify(answer, null, 2)}</pre>}</div> :
          <div><p className="font-semibold">Ask about your permitted company records</p><p className="mt-2 max-w-xl text-sm leading-6 text-app-muted">The agent can answer scoped questions and prepare work when the backend feature is enabled. Company treasury actions still follow approval and wallet signatures.</p></div>}
      </div><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="agent-prompt">Message to agent</label>
        <input id="agent-prompt" className="min-h-11 min-w-0 flex-1 rounded-xl border border-app-line px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What payments are awaiting review?" />
        <button className={buttonClass} disabled={busy || !prompt.trim() || !app.capabilities.financeAgent} type="submit"><Send className="size-4" />Send</button></form>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>
    <section className={`${cardClass} h-fit p-5 sm:p-6`}><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand" /><h2 className="text-base font-semibold">Agent controls</h2></div>
      <ul className="mt-5 space-y-4 text-sm leading-6 text-app-muted"><li><strong className="text-foreground">Scoped data.</strong> The backend checks this wallet&apos;s private permissions for each request.</li><li><strong className="text-foreground">Prepared payments.</strong> Agent suggestions enter the signed company workflow.</li><li><strong className="text-foreground">Capped spending.</strong> x402 purchases require a separate allowlisted service, task, and spending policy.</li></ul>
      <p className="mt-5 rounded-lg bg-brand/5 p-3 text-xs leading-5 text-brand">Agent purchases use a separate funded balance and backend spending policy. Selecting a service, task, and purchase consent above creates a wallet-signed authorization for that one request.</p></section>
  </div><AgentPolicyPanel app={app} /><AgentAuditPanel app={app} /></div>;
}

export function RecordsPanel({ app }: { app: MercuriiController }) {
  const founder = app.session?.role === "founder";
  const companyLedger = founder || app.session?.role === "finance";
  const [sharedId, setSharedId] = useState("");
  const [sharedRecord, setSharedRecord] = useState<{ terms?: { recipient: string; amountMicro: string; requester: string };
    observation?: { status?: string }; record?: { state?: string } } | null>(null);
  const [sharedError, setSharedError] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [auditLabel, setAuditLabel] = useState(""); const [expiryDays, setExpiryDays] = useState("30");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false); const [auditError, setAuditError] = useState<string | null>(null);
  async function createAudit() {
    setAuditBusy(true); setAuditError(null); setCreatedToken(null);
    try {
      const days = Number(expiryDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Expiry must be 1 to 365 days");
      const result = await app.request<{ auditorAccess: { token: string } }>("/v1/compliance/audits",
        { actor: app.session!.address, label: auditLabel.trim(), expiresInDays: days });
      setCreatedToken(result.auditorAccess.token); await app.refresh();
    } catch (cause) { setAuditError(errorText(cause)); } finally { setAuditBusy(false); }
  }
  async function revokeAudit(id: string) {
    setAuditBusy(true); setAuditError(null);
    try { await app.request(`/v1/compliance/audits/${id}/revoke`, { actor: app.session!.address }); await app.refresh(); }
    catch (cause) { setAuditError(errorText(cause)); } finally { setAuditBusy(false); }
  }
  return <div className={`grid gap-5 ${founder ? "xl:grid-cols-[1.25fr_.75fr]" : ""}`}>
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">Payment records</h2><p className="mt-1 text-sm text-app-muted">Private request status and settlement evidence visible to this role.</p>
      {companyLedger ? <div className="mt-6"><DataState resource={app.payments} empty="No payment records yet." retry={app.refresh}>{(payments) => <div className="divide-y divide-app-line">{payments.map((row) => <button key={row.record.paymentId} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setSelectedPayment(row.record.paymentId)}><PaymentItem row={row} /><div className="pb-3 text-xs text-app-muted">Chain: {row.chainStatus ?? "awaiting observation"}{row.record.signature ? ` · Signature ${shortAddress(row.record.signature)}` : ""}{row.snapshotNeedsSync ? " · Treasury snapshot needs sync" : ""}</div></button>)}</div>}</DataState>
        {selectedPayment && <PaymentSettlement app={app} paymentId={selectedPayment} onClose={() => setSelectedPayment(null)} />}</div> : <div className="mt-6">
        <p className="text-sm leading-6 text-app-muted">Open the ID of a request explicitly shared with your wallet. Your role has no company-wide payment index.</p>
        <div className="mt-4 flex flex-wrap gap-2"><label className="sr-only" htmlFor="shared-payment-id">Private payment ID</label><input id="shared-payment-id" className="min-h-11 min-w-0 flex-1 rounded-xl border border-app-line px-3 font-mono text-xs" value={sharedId} onChange={(event) => setSharedId(event.target.value)} placeholder="Private payment UUID" />
          <button className={buttonClass} disabled={!sharedId.trim()} onClick={() => void (async () => { setSharedError(""); setSharedRecord(null);
            try { setSharedRecord(await app.request(`/v1/payment-flows/${sharedId.trim()}`)); }
            catch (cause) { setSharedError(errorText(cause)); } })()}>Open record</button></div>
        {sharedRecord && <div className="mt-4 rounded-xl bg-app-canvas p-4 text-sm"><p className="font-semibold">Request {shortAddress(sharedId)}</p><p className="mt-2 text-app-muted">Status: {sharedRecord.observation?.status ?? sharedRecord.record?.state ?? "Pending"}</p>
          {sharedRecord.terms && <div className="mt-3 space-y-1 text-xs"><p>Amount: {formatUsdc(sharedRecord.terms.amountMicro)}</p><p className="break-all">Recipient: {sharedRecord.terms.recipient}</p><p className="break-all">Requester: {sharedRecord.terms.requester}</p></div>}</div>}
        {sharedError && <p role="alert" className="mt-3 text-sm text-red-700">{sharedError}</p>}</div>}</section>
    {founder && <section className={`${cardClass} h-fit p-5 sm:p-7`}><h2 className="text-base font-semibold">Audit access</h2><p className="mt-1 text-sm text-app-muted">Frozen payroll evidence, separate from live treasury access.</p>
      <FounderReconciliation app={app} />
      {founder && <div className="mt-5 rounded-xl border border-app-line p-4"><h3 className="text-sm font-semibold">Create a scoped audit share</h3><p className="mt-1 text-xs leading-5 text-app-muted">Includes matching payroll runs. The access token appears once and stays in this tab only.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_90px]"><label className="text-xs font-semibold">Label<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={auditLabel} onChange={(e) => setAuditLabel(e.target.value)} placeholder="Quarterly review" /></label>
          <label className="text-xs font-semibold">Days<input className="mt-1 min-h-10 w-full rounded-lg border border-app-line px-2 text-sm" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} inputMode="numeric" /></label></div>
        <button className={`${buttonClass} mt-3`} disabled={auditBusy} onClick={() => void createAudit()}>Create share</button>
        {createdToken && <div className="mt-3 rounded-lg bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Save this one-time auditor token now</p><code className="mt-2 block break-all text-xs text-amber-950">{createdToken}</code></div>}</div>}
      <div className="mt-5"><DataState resource={app.audits} empty="No audit shares created." retry={app.refresh}>{(audits) => <div className="space-y-3">{audits.map((item, index) => <div key={String(item.auditId ?? index)} className="rounded-xl bg-app-canvas p-4 text-sm"><p className="font-semibold">{String(item.label ?? "Audit share")}</p><p className="mt-1 font-mono text-xs text-app-muted">{shortAddress(String(item.auditId ?? ""))} · {String(item.expiresAt ?? "No expiry shown")}</p>
        {founder && !item.revokedAt && <button className="mt-2 text-xs font-semibold text-red-700 underline underline-offset-2" disabled={auditBusy} onClick={() => void revokeAudit(String(item.auditId))}>Revoke share</button>}</div>)}</div>}</DataState></div>
      {auditError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{auditError}</p>}</section>}
    {founder && <div className="xl:col-span-2"><ViewerSharePanel app={app} /></div>}
  </div>;
}

type SettlementStatus = {
  record: { state: string; signature: string | null };
  requestStatus: string;
  chainStatus: string | null;
  snapshotNeedsSync: boolean | null;
  snapshotUpdatedSlot: string | null;
  integrityWarning: string | null;
};
type SnapshotStep = { status: string; receiptId?: string; receiptStatus?: string;
  transaction?: PreparedTransaction; updatedSlot?: string; balanceMicro?: string };

function PaymentSettlement({ app, paymentId, onClose }: {
  app: MercuriiController; paymentId: string; onClose: () => void;
}) {
  const founder = app.session?.role === "founder";
  const [detail, setDetail] = useState<SettlementStatus | null>(null);
  const [step, setStep] = useState<SnapshotStep | null>(null);
  const [signed, setSigned] = useState<{ receiptId: string; bytes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function inspect() {
    const result = await app.request<SettlementStatus>(`/v1/payment-jobs/${paymentId}`);
    setDetail(result);
  }
  async function syncSnapshot() {
    if (signed) throw new Error("Reconcile the signed snapshot receipt before preparing another.");
    const result = await app.request<SnapshotStep>(`/v1/payment-jobs/${paymentId}/snapshot-sync`,
      { actor: app.session!.address });
    setStep(result);
    setSigned(null);
    setNotice(result.status === "ready" ? "Treasury snapshot is up to date." :
      result.status === "wait_for_execution" ? "Wait for the execution signature to confirm." :
      result.status === "wait_for_snapshot" ? "An earlier snapshot receipt is pending. Reconcile that receipt before trying again." :
      "Review the snapshot sync transaction before signing.");
  }
  async function signSync() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No snapshot sync transaction is ready");
    const transaction = await signPrepared(app.wallet, app.session!.address, step.transaction);
    setSigned({ receiptId: step.receiptId, bytes: transaction.signedTransactionBase64 });
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`,
      { signedTransactionBase64: transaction.signedTransactionBase64 });
    setNotice(`Snapshot receipt ${result.receipt.status} · broadcast ${result.broadcast}. Reconcile before rebuilding.`);
    await inspect();
    await app.refresh();
  }
  async function reconcileSync() {
    const receiptId = signed?.receiptId ?? step?.receiptId;
    if (!receiptId) throw new Error("No snapshot receipt to reconcile");
    const result = await app.request<{ receipt: { status: string }; next: string }>(
      `/v1/onboarding/receipts/${receiptId}/reconcile`,
      signed ? { signedTransactionBase64: signed.bytes } : {});
    setNotice(`Snapshot receipt ${result.receipt.status} · ${result.next.replaceAll("_", " ")}`);
    if (result.receipt.status === "confirmed") { setStep(null); setSigned(null); }
    await inspect();
    await app.refresh();
  }
  async function retryOriginalSync() {
    if (!signed) throw new Error("No signed snapshot receipt to retry");
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${signed.receiptId}/submit`, { signedTransactionBase64: signed.bytes });
    setNotice(`Original snapshot signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
  }
  return <div className="mt-5 rounded-xl border border-app-line bg-app-canvas p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Payment settlement</h3>
      <p className="mt-1 break-all font-mono text-xs text-app-muted">{paymentId}</p></div>
      <button className={secondaryButtonClass} disabled={busy || Boolean(signed)} onClick={onClose}>Close</button></div>
    <button className={`${secondaryButtonClass} mt-4`} disabled={busy} onClick={() => void run(inspect)}>
      <RefreshCw className="size-4" />Inspect chain & request</button>
    {detail && <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      {[
        ["Private request", detail.requestStatus.replaceAll("_", " ")],
        ["Payment job", detail.record.state.replaceAll("_", " ")],
        ["Execution signature", detail.record.signature ?? "None"],
        ["Chain observation", detail.chainStatus ?? "Unavailable"],
        ["Treasury snapshot", detail.snapshotNeedsSync === true ? "Needs sync" :
          detail.snapshotNeedsSync === false ? "Current" : "Cannot determine yet"],
      ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-white p-3">
        <dt className="text-xs text-app-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd>
      </div>)}</dl>}
    {detail?.integrityWarning && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{detail.integrityWarning}</p>}
    {founder && detail?.snapshotNeedsSync && detail.requestStatus === "executed" &&
      <button className={`${buttonClass} mt-4`} disabled={busy || Boolean(signed)} onClick={() => void run(syncSnapshot)}>Prepare snapshot sync</button>}
    {step && <div className="mt-4 rounded-lg bg-white p-3 text-sm">
      <p className="font-semibold">Snapshot: {step.status.replaceAll("_", " ")}</p>
      {step.transaction && <p className="mt-1 text-app-muted">Signer: Founder · Network: Private Ephemeral Rollup</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {step.transaction && <button className={buttonClass} disabled={busy || Boolean(signed)} onClick={() => void run(signSync)}>{signed ? "Snapshot signed" : "Review & sign"}</button>}
        {step.receiptId && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(reconcileSync)}>Reconcile receipt</button>}
        {signed && <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(retryOriginalSync)}>Retry same signature</button>}
      </div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
  </div>;
}

type ReconciliationPage = {
  payments: { paymentId: string; next: string; requestStatus?: string; paymentState?: string; error?: string }[];
  receipts: { id: string; operation: string; status: string; next: string; error?: string }[];
  nextPaymentOffset: number | null; nextReceiptOffset: number | null;
  totalPayments: number; unresolvedReceiptsAtStart: number; note: string;
};

function FounderReconciliation({ app }: { app: MercuriiController }) {
  const [page, setPage] = useState<ReconciliationPage | null>(null);
  const [paymentOffset, setPaymentOffset] = useState(0);
  const [receiptOffset, setReceiptOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(offset = 0, receipts = 0) {
    setBusy(true); setError("");
    try {
      const result = await app.request<ReconciliationPage>("/v1/reconciliation/run",
        { paymentOffset: offset, receiptOffset: receipts, limit: 20 });
      setPage(result); setPaymentOffset(offset); setReceiptOffset(receipts); await app.refresh();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="mt-5 rounded-xl border border-app-line p-4">
    <h3 className="text-sm font-semibold">Settlement check</h3>
    <p className="mt-1 text-xs leading-5 text-app-muted">Re-read private requests and chain receipts. This check does not send a new payment.</p>
    <button className={`${secondaryButtonClass} mt-3`} disabled={busy} onClick={() => void run()}>
      <RefreshCw className="size-4" />{busy ? "Checking…" : "Check all statuses"}</button>
    {page && <div className="mt-4 space-y-3 text-xs">
      <p className="font-semibold">{page.totalPayments} payment records · {page.unresolvedReceiptsAtStart} unresolved receipts before this check</p>
      {page.payments.map((item) => <div key={item.paymentId} className="rounded-lg bg-app-canvas p-3">
        <p className="font-mono">{shortAddress(item.paymentId)}</p>
        <p className="mt-1">{item.requestStatus ?? "Private read unavailable"} · {item.paymentState ?? "Review"} · next: {item.next.replaceAll("_", " ")}</p>
        {item.error && <p className="mt-1 text-red-700">{item.error}</p>}
      </div>)}
      {page.receipts.filter((item) => item.status !== "confirmed").map((item) => <div key={item.id} className="rounded-lg bg-amber-50 p-3">
        <p className="font-mono">{shortAddress(item.id)} · {item.operation}</p>
        <p className="mt-1">{item.status} · {item.next.replaceAll("_", " ")}</p>
        {item.error && <p className="mt-1 text-red-700">{item.error}</p>}
      </div>)}
      {(page.nextPaymentOffset !== null || page.nextReceiptOffset !== null) &&
        <button className={secondaryButtonClass} disabled={busy} onClick={() => void run(page.nextPaymentOffset ?? paymentOffset, page.nextReceiptOffset ?? receiptOffset)}>Check next page</button>}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </div>;
}
