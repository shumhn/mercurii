"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { formatUsdc, parseUsdc, shortAddress, roleFromGrant, type Payee } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import type { PaymentDraft } from "./payments-panel";
import { buttonClass, cardClass, DataState, inputClass, Notice, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof, TxProof, type ProofReceipt } from "./tx-proof";

type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };
import { PayrollSchedulesPanel } from "./payroll-schedules-panel";
import { RecipientOnboardingPanel } from "./recipient-onboarding-panel";
import { PolicyReaderRestore } from "./policy-reader-restore";

function errorText(cause: unknown) { return cause instanceof Error ? cause.message : "Action failed"; }
function validAddress(value: string) { try { return new PublicKey(value).toBase58() === value; } catch { return false; } }

export function PayeesPanel({ app }: { app: MercuriiController }) {
  const founder = app.session?.role === "founder";
  const [recipient, setRecipient] = useState(""); const [kind, setKind] = useState<Payee["kind"]>("vendor");
  const [teamId, setTeamId] = useState(""); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  async function add() {
    setBusy(true); setError(null);
    try {
      if (!validAddress(recipient)) throw new Error("Enter a valid recipient wallet");
      await app.request("/v1/payees", { actor: app.session!.address, payeeId: crypto.randomUUID(), kind,
        recipient, ...(teamId ? { teamId } : {}) });
      setRecipient(""); setTeamId(""); setNotice("Payee registered. Its wallet is hidden from the directory view.");
      await app.refresh();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function deactivate(id: string) {
    setBusy(true); setError(null);
    try { await app.request(`/v1/payees/${id}/deactivate`, { actor: app.session!.address }); await app.refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">Registered payees</h2><p className="mt-1 text-sm text-app-muted">The registry stores a private recipient binding. The listing does not expose wallet addresses.</p>
      <div className="mt-6"><DataState resource={app.payees} empty="No payees registered yet." retry={app.refresh}>{(payees) => <div className="divide-y divide-app-line">{payees.map((payee) => <div key={payee.payeeId} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-semibold capitalize">{payee.kind} <span className={`ml-2 rounded-full px-2 py-1 text-xs ${payee.active ? "bg-emerald-50 text-emerald-700" : "bg-app-canvas text-app-muted"}`}>{payee.active ? "Active" : "Inactive"}</span></p>
        <p className="mt-1 font-mono text-xs text-app-muted">{shortAddress(payee.payeeId)}{payee.teamId ? ` · ${payee.teamId}` : ""}</p></div>
        {founder && payee.active && <button className={secondaryButtonClass} disabled={busy} onClick={() => void deactivate(payee.payeeId)}>Deactivate</button>}</div>)}</div>}</DataState></div></section>
    {founder && <section className={`${cardClass} h-fit p-5 sm:p-7`}><h2 className="text-lg font-semibold">Add payee</h2><p className="mt-1 text-sm text-app-muted">Only the Founder can register the recipient binding.</p>
      <div className="mt-5 space-y-4"><label className="block text-sm font-medium">Recipient wallet<input className={`${inputClass} mt-2 font-mono`} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Solana address" /></label>
        <label className="block text-sm font-medium">Type<select className={`${inputClass} mt-2`} value={kind} onChange={(e) => setKind(e.target.value as Payee["kind"])}><option value="vendor">Vendor</option><option value="contractor">Contractor</option><option value="employee">Employee</option></select></label>
        <label className="block text-sm font-medium">Team ID <span className="font-normal text-app-muted">optional</span><input className={`${inputClass} mt-2`} value={teamId} onChange={(e) => setTeamId(e.target.value)} /></label>
        <button className={buttonClass} disabled={busy} onClick={() => void add()}>Register payee</button></div></section>}
    {founder && <div className="xl:col-span-2"><RecipientOnboardingPanel app={app} /></div>}
    {(error || notice) && <p role={error ? "alert" : "status"} className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-brand/5 text-brand"}`}>{error ?? notice}</p>}
  </div>;
}

type RosterPreview = { items: { row: number; recipient: string; amountMicro: number; label: string | null }[];
  errors: { row: number | null; message: string }[]; totalMicro: string; canCreateRun: boolean;
  budgetCoversValidRows: boolean; snapshotCoversValidRows: boolean | null };
type Readiness = { canCreateRun: boolean; readyCount: number; items: { recipient: string; status: "ready" | "needs_onboarding" | "unavailable" }[];
  totalMicro: string; note: string };

export function PayrollPanel({ app, onStartPayment }: { app: MercuriiController; onStartPayment: (draft: PaymentDraft) => void }) {
  const founder = app.session?.role === "founder";
  const [csv, setCsv] = useState(""); const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null); const [run, setRun] = useState<{ runId: string; items: { paymentId: string }[] } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function action(task: () => Promise<void>) { setBusy(true); setError(null); try { await task(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <div className="space-y-5">
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">Private payroll run</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-app-muted">Import a roster, validate recipients and budget, then create signed payment requests. This MVP run is launched by the Founder; every payout still follows the private payment workflow.</p>
      {!founder ? <Notice title="Founder action" detail="Finance can inspect schedules, but only the Founder can launch a manual payroll run in the current backend." /> : <>
        <label className="mt-6 block text-sm font-semibold" htmlFor="payroll-csv">Roster CSV</label>
        <p className="mt-1 text-xs text-app-muted">Columns: wallet,amount_usdc,name. The roster stays in this tab and is sent to the private backend for validation.</p>
        <textarea id="payroll-csv" className={`${inputClass} mt-3 min-h-36 py-3 font-mono`} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setReadiness(null); setRun(null); }} placeholder="wallet,amount_usdc,name" spellCheck={false} />
        <div className="mt-4 flex flex-wrap gap-3"><button className={buttonClass} disabled={busy || !csv.trim()} onClick={() => void action(async () => { const result = await app.request<RosterPreview>("/v1/payroll-runs/preview", { csvText: csv }); setPreview(result); setReadiness(null); })}>Preview roster</button>
          {preview?.canCreateRun && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(async () => setReadiness(await app.request<Readiness>("/v1/payroll-runs/readiness", { items: preview.items.map(({ recipient, amountMicro }) => ({ recipient, amountMicro })) })))}>Check readiness</button>}
          {preview?.canCreateRun && readiness?.canCreateRun && <button className={buttonClass} disabled={busy} onClick={() => void action(async () => { const result = await app.request<{ runId: string; items: { paymentId: string }[] }>("/v1/payroll-runs", { runId: crypto.randomUUID(), requester: app.session!.address, items: preview.items.map(({ recipient, amountMicro }) => ({ recipient, amountMicro })) }); setRun(result); setSelectedRunId(result.runId); await app.refresh(); })}>Create run</button>}</div>
        {preview && <div className="mt-6 rounded-xl bg-app-canvas p-5"><p className="font-semibold">{preview.items.length} payouts · {formatUsdc(preview.totalMicro)}</p><p className="mt-2 text-sm text-app-muted">Policy budget: {preview.budgetCoversValidRows ? "covers roster" : "insufficient"} · snapshot: {preview.snapshotCoversValidRows === null ? "unavailable" : preview.snapshotCoversValidRows ? "covers roster" : "insufficient"}</p>
          {preview.errors.map((issue, i) => <p key={i} className="mt-2 text-sm text-red-700">Row {issue.row ?? "—"}: {issue.message}</p>)}</div>}
        {readiness && <div className="mt-4 rounded-xl border border-app-line p-5 text-sm"><p className="font-semibold">Recipients ready: {readiness.readyCount}/{readiness.items.length}</p><p className="mt-1 text-app-muted">{readiness.note}</p>{!readiness.canCreateRun && <p className="mt-2 text-amber-700">Resolve recipient deposits and budget before creating the run.</p>}
          <div className="mt-3 divide-y divide-app-line">{readiness.items.map((item) => <div key={item.recipient} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="font-mono">{shortAddress(item.recipient)}</span><span className={item.status === "ready" ? "text-emerald-700" : "text-amber-800"}>{item.status.replaceAll("_", " ")}</span></div>)}</div></div>}
        {run && preview && <div className="mt-5 rounded-xl border border-brand/25 bg-brand/5 p-5"><p className="font-semibold">Run created: {shortAddress(run.runId)}</p><p className="mt-1 text-sm text-app-muted">Select a payout to continue its signed private workflow.</p><div className="mt-3 flex flex-wrap gap-2">{run.items.map((item, index) => <button key={item.paymentId} className={secondaryButtonClass} onClick={() => onStartPayment({ paymentId: item.paymentId, recipient: preview.items[index]!.recipient, amountMicro: preview.items[index]!.amountMicro })}>{preview.items[index]?.label ?? `Payout ${index + 1}`}</button>)}</div></div>}
      </>}
    </section>
    <PayrollSchedulesPanel app={app} />
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-base font-semibold">Payroll runs</h2><p className="mt-1 text-sm text-app-muted">Open a run to see the private status of every payout and approve submitted requests in signed chunks.</p>
      {founder ? <div className="mt-4"><DataState resource={app.payrollRuns} empty="No payroll runs yet." retry={app.refresh}>{(runs) => <div className="divide-y divide-app-line">{runs.map((item) => <button key={item.runId} className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setSelectedRunId(item.runId)}><span className="font-mono text-xs">{shortAddress(item.runId)}</span><span className="text-xs text-app-muted">{item.itemCount ?? item.items?.length ?? "—"} payouts · Open</span></button>)}</div>}</DataState></div> :
        <p className="mt-4 text-sm text-app-muted">Ask the Founder for a payout ID to review its private approval step. Full run history is Founder-scoped by the backend.</p>}
      {founder && selectedRunId && <PayrollRunDetail key={selectedRunId} app={app} runId={selectedRunId} onStartPayment={onStartPayment} onClose={() => setSelectedRunId(null)} />}
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  </div>;
}

type PayrollRunStatus = { runId: string; items: { paymentId: string; requestStatus: string;
  recipient: string | null; amountMicro: string | null; paymentState: string | null;
  signature: string | null; nextAction: string }[] };
type PayrollApprovalStep = { status: "ready" | "wait" | "build"; receiptId?: string;
  receiptStatus?: string; itemCount?: number; remainingAfterConfirmation?: number;
  transaction?: PreparedTransaction };
type RecoveryResult = { recoveries: { paymentId: string; status: "settled" | "build" | "reconcile";
  requestStatus?: string; paymentState?: string; chainStatus?: string | null;
  transaction?: PreparedTransaction }[]; note: string };

function PayrollRunDetail({ app, runId, onStartPayment, onClose }: {
  app: MercuriiController; runId: string; onStartPayment: (draft: PaymentDraft) => void; onClose: () => void;
}) {
  const [detail, setDetail] = useState<PayrollRunStatus | null>(null);
  const [step, setStep] = useState<PayrollApprovalStep | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  const [approvalProof, setApprovalProof] = useState<ProofReceipt | null>(null);
  const [recovery, setRecovery] = useState<RecoveryResult["recoveries"][number] | null>(null);
  const [recoverySigned, setRecoverySigned] = useState<{ paymentId: string; bytes: string; broadcast: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function inspect(announce = true) {
    const result = await app.request<PayrollRunStatus>(`/v1/payroll-runs/${runId}`);
    setDetail(result);
    if (announce) setNotice(`Checked ${result.items.length} private payout requests.`);
  }
  async function approve() {
    if (signed) throw new Error("Reconcile the signed approval chunk before preparing another.");
    const result = await app.request<PayrollApprovalStep>(`/v1/payroll-runs/${runId}/approve`,
      { actor: app.session!.address });
    setStep(result);
    setSigned(null);
    setNotice(result.status === "ready" ? "All requests are approved or executed." :
      result.status === "wait" ? "A previous approval receipt must settle first." :
      `Review and sign ${result.itemCount ?? 0} approvals; ${result.remainingAfterConfirmation ?? 0} remain after this chunk.`);
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No approval transaction is ready");
    const transaction = await signPrepared(app.wallet, app.session!.address, step.transaction);
    setSigned(transaction.signedTransactionBase64);
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`,
      { signedTransactionBase64: transaction.signedTransactionBase64 });
    setApprovalProof({ id: step.receiptId, status: result.receipt.status,
      signature: result.receipt.signature ?? null, chain: result.receipt.chain });
    setNotice(`Approval receipt ${result.receipt.status} · broadcast ${result.broadcast}. Check its status before the next chunk.`);
  }
  async function reconcile() {
    if (!step?.receiptId) throw new Error("No approval receipt to check");
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/reconcile`,
      signed ? { signedTransactionBase64: signed } : {});
    setApprovalProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    setNotice(`Approval receipt ${result.receipt.status} · ${result.next.replaceAll("_", " ")}`);
    if (result.receipt.status === "confirmed") { setStep(null); setSigned(null); setApprovalProof(null); }
    await inspect(false);
    await app.refresh();
  }
  async function retryOriginal() {
    if (!step?.receiptId || !signed) throw new Error("No signed approval chunk to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`, { signedTransactionBase64: signed });
    setApprovalProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    setNotice(`Original approval signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
  }
  async function recover(paymentId: string) {
    if (recoverySigned) throw new Error("Inspect the original signed recovery before preparing another.");
    if (!app.capabilities.paymentExecution) throw new Error("Payment execution is disabled on this backend.");
    const result = await app.request<RecoveryResult>(`/v1/payroll-runs/${runId}/recover`,
      { actor: app.session!.address, paymentIds: [paymentId] });
    const item = result.recoveries[0];
    if (!item) throw new Error("No recovery result was returned");
    setRecovery(item);
    setNotice(item.status === "build" ? "A confirmed failed signature was rebuilt. Review and sign the replacement payout." :
      item.status === "settled" ? "Payout already settled; no replacement is needed." :
      `No replacement created. Request ${item.requestStatus ?? "unknown"} · job ${item.paymentState ?? "unknown"}.`);
    await inspect(false);
  }
  async function signRecovery() {
    if (!recovery?.transaction || !app.wallet || recoverySigned) throw new Error("No unsigned recovery is ready");
    const signedTransaction = await signPrepared(app.wallet, app.session!.address, recovery.transaction);
    const original = { paymentId: recovery.paymentId, bytes: signedTransaction.signedTransactionBase64,
      broadcast: "signed" };
    setRecoverySigned(original);
    const result = await app.request<{ broadcast: string }>(`/v1/payment-jobs/${recovery.paymentId}/submit`,
      { signedTransactionBase64: original.bytes });
    setRecoverySigned({ ...original, broadcast: result.broadcast });
    setNotice(`Replacement submitted: ${result.broadcast}. Inspect settlement before any further action.`);
  }
  async function inspectRecovery() {
    if (!recoverySigned) throw new Error("No signed recovery in this tab");
    const result = await app.request<{ record: { state: string }; chainStatus: string | null; requestStatus: string }>(
      `/v1/payment-jobs/${recoverySigned.paymentId}`);
    setNotice(`Replacement: request ${result.requestStatus} · chain ${result.chainStatus ?? "unavailable"} · job ${result.record.state}.`);
    if (result.requestStatus === "executed" || result.record.state === "settled" || result.record.state === "failed") {
      setRecoverySigned(null); setRecovery(null);
    }
    await inspect(false); await app.refresh();
  }
  async function retryRecovery() {
    if (!recoverySigned) throw new Error("No original recovery signature in this tab");
    const result = await app.request<{ broadcast: string }>(`/v1/payment-jobs/${recoverySigned.paymentId}/submit`,
      { signedTransactionBase64: recoverySigned.bytes });
    setRecoverySigned({ ...recoverySigned, broadcast: result.broadcast });
    setNotice(`Same replacement signature: ${result.broadcast}. Inspect settlement before another action.`);
  }
  return <div className="mt-5 rounded-xl border border-app-line bg-app-canvas p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Run details</h3>
      <p className="mt-1 break-all font-mono text-xs text-app-muted">{runId}</p></div><button className={secondaryButtonClass} disabled={busy || Boolean(signed)} onClick={onClose}>Close</button></div>
    <div className="mt-4 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(() => inspect())}>Check payout statuses</button>
      {detail && <button className={buttonClass} disabled={busy || Boolean(signed) || detail.items.some((item) => !["submitted", "approved", "executed"].includes(item.requestStatus))} onClick={() => void action(approve)}>Prepare bulk approval</button>}</div>
    {detail && <div className="mt-4 divide-y divide-app-line rounded-xl border border-app-line bg-white px-4">{detail.items.map((item, index) =>
      <div key={item.paymentId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold">Payout {index + 1} · {item.amountMicro ? formatUsdc(item.amountMicro) : "Private terms pending"}</p>
        <p className="mt-1 text-xs text-app-muted">{item.requestStatus.replaceAll("_", " ")} · {item.paymentState ?? "No execution"} · next: {item.nextAction.replaceAll("_", " ")}</p>
        <p className="mt-1 font-mono text-xs text-app-muted">{shortAddress(item.paymentId)}</p>
        {item.signature && <div className="mt-2 max-w-md"><TxProof signature={item.signature} label="Payout transaction" status={item.paymentState} /></div>}</div>
        <div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} onClick={() => onStartPayment({ paymentId: item.paymentId,
          recipient: item.recipient ?? "", amountMicro: item.amountMicro ? Number(item.amountMicro) : 0 })}>Open payout</button>
          {item.paymentState === "failed" && item.requestStatus === "approved" && app.capabilities.paymentExecution &&
            <button className={secondaryButtonClass} disabled={busy || Boolean(recoverySigned)} onClick={() => void action(() => recover(item.paymentId))}>Recover failed payout</button>}</div></div>)}</div>}
    {recovery && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Recovery: {shortAddress(recovery.paymentId)} · {recovery.status}</p>
      <p className="mt-1 text-amber-900">Only confirmed failed signatures are eligible for a replacement. Each replacement needs a new wallet signature.</p>
      <div className="mt-3 flex flex-wrap gap-2">{recovery.transaction && !recoverySigned && <button className={buttonClass} disabled={busy} onClick={() => void action(signRecovery)}>Review & sign replacement</button>}
        {recoverySigned && <><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(inspectRecovery)}>Inspect settlement</button>
          {recoverySigned.broadcast === "uncertain" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryRecovery)}>Retry same signature</button>}</>}</div></div>}
    {step && <div className="mt-4 rounded-lg border border-app-line bg-white p-4 text-sm">
      <p className="font-semibold capitalize">Approval: {step.status}</p>
      {step.status === "build" && <p className="mt-1 text-app-muted">Founder signs this approval chunk on the private validator.</p>}
      {approvalProof && <div className="mt-3"><ReceiptProof receipt={approvalProof} label="Approval" /></div>}
      <div className="mt-3 flex flex-wrap gap-2">{step.transaction && <button className={buttonClass} disabled={busy || Boolean(signed)} onClick={() => void action(sign)}>{signed ? "Chunk signed" : "Review & sign chunk"}</button>}
        {step.receiptId && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>}
        {signed && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
  </div>;
}

type GrantResult = { status?: string; next?: { status?: string; operation?: string }; transaction?: PreparedTransaction;
  receiptId?: string; grantAddress?: string };
type RevokeResult = { status: string; transaction?: PreparedTransaction; receiptId?: string;
  totalTargets?: number; confirmedCount?: number; note?: string };

export function TeamPanel({ app }: { app: MercuriiController }) {
  const session = app.session!; const founder = session.role === "founder"; const finance = session.role === "finance";
  const [mode, setMode] = useState<"member" | "finance" | "manager">(finance ? "manager" : "member");
  const [member, setMember] = useState(""); const [role, setRole] = useState<"requester" | "viewer">("requester");
  const [grantId, setGrantId] = useState(""); const [branchId, setBranchId] = useState("");
  const [perCap, setPerCap] = useState(""); const [periodCap, setPeriodCap] = useState("");
  const [recipientsInput, setRecipientsInput] = useState(""); const [mayDelegate, setMayDelegate] = useState(true);
  const [pending, setPending] = useState<GrantResult | null>(null); const [signed, setSigned] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeStep, setRevokeStep] = useState<RevokeResult | null>(null);
  const [revokeSigned, setRevokeSigned] = useState<string | null>(null);
  const [revokeReceiptStatus, setRevokeReceiptStatus] = useState<string | null>(null);
  const [grantProof, setGrantProof] = useState<ProofReceipt | null>(null);
  const [revokeProof, setRevokeProof] = useState<ProofReceipt | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  async function action(task: () => Promise<void>) { setBusy(true); setError(null); setNotice(""); try { await task(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  function editGrant(update: () => void) {
    if (signed) { setError("Check the signed grant's status before changing grant details."); return; }
    update(); setPending(null); setGrantId(""); setGrantProof(null);
  }
  async function prepareGrant() {
    const target = mode === "finance" ? app.policy.value?.finance ?? "" : member;
    if (!validAddress(target)) throw new Error("Enter a valid team wallet");
    const random = crypto.getRandomValues(new Uint32Array(2));
    const id = grantId || ((BigInt(random[0]) << BigInt(32)) | BigInt(random[1])).toString(); setGrantId(id);
    const branch = branchId ? Number(branchId) : undefined;
    if ((mode === "manager" && branch === undefined) || branch !== undefined && (!Number.isInteger(branch) || branch < 1 || branch > 0xffffff)) throw new Error("Branch ID must be 1 to 16777215");
    const recipients = recipientsInput.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    if (mode !== "member" && (recipients.length < 1 || recipients.length > 16 || recipients.some((item) => !validAddress(item)))) {
      throw new Error("Add 1 to 16 valid allowed recipient wallets");
    }
    const caps = mode === "member" ? {} : { perPaymentCapMicro: parseUsdc(perCap), periodCapMicro: parseUsdc(periodCap), recipients };
    const parent = app.members.value?.flatMap((entry) => entry.grants).find((grant) => grant.member === session.address && grant.role === 1 && grant.active && !grant.revoked);
    if (mode === "manager" && !parent) throw new Error("An active delegating Finance grant is required");
    const endpoint = mode === "member" ? "/v1/onboarding/member-grant/next" :
      mode === "finance" ? "/v1/onboarding/finance-grant/next" : "/v1/onboarding/manager-grant/next";
    const body = mode === "member" ? { actor: session.address, member: target, role, grantId: id, ...(branch ? { branchId: branch } : {}) } :
      mode === "finance" ? { actor: session.address, finance: target, grantId: id, ...caps, mayDelegate } :
        { actor: session.address, finance: session.address, manager: target, parentGrant: parent!.address, grantId: id, branchId: branch, ...caps };
    const result = await app.request<GrantResult>(endpoint, body);
    setPending(result); setNotice(result.transaction ? "Review the role and sign its grant in your wallet." : `Grant status: ${result.status ?? result.next?.status ?? "inspect"}`);
  }
  async function signGrant() {
    if (!pending?.transaction || !pending.receiptId || !app.wallet) throw new Error("No prepared grant");
    const bytes = await signPrepared(app.wallet, session.address, pending.transaction);
    setSigned(bytes.signedTransactionBase64);
    const result = await app.request<ReceiptResponse & { broadcast: string }>(`/v1/onboarding/receipts/${pending.receiptId}/submit`, { signedTransactionBase64: bytes.signedTransactionBase64 });
    setGrantProof({ id: pending.receiptId, status: result.receipt.status,
      signature: result.receipt.signature ?? null, chain: result.receipt.chain });
    setNotice(`Grant receipt: ${result.receipt.status} · broadcast ${result.broadcast}. Refresh team access after settlement.`); await app.refresh();
  }
  async function reconcileGrant() {
    if (!pending?.receiptId || !signed) throw new Error("No signed grant receipt");
    const result = await app.request<ReceiptResponse>(`/v1/onboarding/receipts/${pending.receiptId}/reconcile`, { signedTransactionBase64: signed });
    setGrantProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    if (result.receipt.status === "confirmed") { setSigned(null); setPending(null); setGrantId(""); setGrantProof(null); }
    setNotice(`Grant receipt: ${result.receipt.status}`); await app.refresh();
  }
  async function retryGrant() {
    if (!pending?.receiptId || !signed) throw new Error("No original signed grant to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${pending.receiptId}/submit`, { signedTransactionBase64: signed });
    setGrantProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    setNotice(`Original grant signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
    await app.refresh();
  }
  async function nextRevoke(grant: string) {
    if (revokeSigned && revokeReceiptStatus !== "confirmed") throw new Error("Reconcile the signed revoke receipt before continuing cleanup.");
    setRevoking(grant); setRevokeSigned(null); setRevokeReceiptStatus(null);
    const result = await app.request<RevokeResult>(`/v1/team-grants/${grant}/revoke/next`, { actor: session.address });
    setRevokeStep(result); setRevokeProof(null);
    setNotice(result.status === "ready" ? "Revocation and all discovered private-reader cleanup completed." :
      `Revocation step: ${result.status.replaceAll("_", " ")}. Continue until ready.`);
    await app.refresh();
  }
  async function signRevoke() {
    if (!revokeStep?.transaction || !revokeStep.receiptId || !app.wallet) throw new Error("No revoke step to sign");
    const signedTransaction = await signPrepared(app.wallet, session.address, revokeStep.transaction);
    setRevokeSigned(signedTransaction.signedTransactionBase64);
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${revokeStep.receiptId}/submit`,
      { signedTransactionBase64: signedTransaction.signedTransactionBase64 });
    setRevokeReceiptStatus(result.receipt.status);
    setRevokeProof({ id: revokeStep.receiptId, status: result.receipt.status,
      signature: result.receipt.signature ?? null, chain: result.receipt.chain });
    setNotice(`Revocation receipt: ${result.receipt.status} · broadcast ${result.broadcast}. Continue cleanup until ready.`);
  }
  async function reconcileRevoke() {
    if (!revokeStep?.receiptId) throw new Error("No revoke receipt");
    const result = await app.request<ReceiptResponse>(
      `/v1/onboarding/receipts/${revokeStep.receiptId}/reconcile`,
      revokeSigned ? { signedTransactionBase64: revokeSigned } : {});
    setRevokeReceiptStatus(result.receipt.status);
    setRevokeProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    setNotice(`Revocation receipt: ${result.receipt.status}. Continue when confirmed.`);
  }
  async function retryRevoke() {
    if (!revokeStep?.receiptId || !revokeSigned) throw new Error("No original signed revocation to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${revokeStep.receiptId}/submit`,
      { signedTransactionBase64: revokeSigned });
    setRevokeReceiptStatus(result.receipt.status);
    setRevokeProof((prior) => prior ? { ...prior, status: result.receipt.status,
      signature: result.receipt.signature ?? prior.signature, chain: result.receipt.chain ?? prior.chain } : prior);
    setNotice(`Original revocation signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">People & scopes</h2><p className="mt-1 text-sm text-app-muted">Private grants determine what each wallet can read and sign.</p>
      <div className="mt-6"><DataState resource={app.members} empty="No visible team grants yet." retry={app.refresh}>{(members) => <div className="divide-y divide-app-line">{members.map((entry) => <div key={entry.member} className="py-4"><p className="break-all font-mono text-xs sm:text-sm">{entry.member === session.address ? `${entry.member} · You` : entry.member}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">{entry.grants.map((grant) => <div key={grant.address} className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${grant.active && !grant.revoked ? "bg-brand/10 text-brand" : "bg-app-canvas text-app-muted"}`}>{roleFromGrant(grant.role)} · {grant.active && !grant.revoked ? "active" : "revoked"}</span>
          {founder && grant.active && !grant.revoked && <button className="text-xs font-semibold text-red-700 underline underline-offset-2" disabled={busy || Boolean(revokeSigned && revokeReceiptStatus !== "confirmed")} onClick={() => void action(() => nextRevoke(grant.address))}>Revoke</button>}</div>)}</div></div>)}</div>}</DataState></div>
      {revoking && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5"><h3 className="font-semibold text-red-900">Revoke {shortAddress(revoking)}</h3><p className="mt-1 text-sm text-red-800">Revoking a grant also needs private reader cleanup. Continue until the backend reports ready.</p>
        <p className="mt-3 text-sm font-medium text-red-900">{revokeStep?.status.replaceAll("_", " ") ?? "Checking"}{revokeStep?.totalTargets !== undefined ? ` · ${revokeStep.confirmedCount}/${revokeStep.totalTargets} readers cleared` : ""}</p>
        {revokeProof && <div className="mt-4"><ReceiptProof receipt={revokeProof} label="Revocation" /></div>}
        <div className="mt-4 flex flex-wrap gap-2">{revokeStep?.transaction && <button className={buttonClass} disabled={busy || Boolean(revokeSigned)} onClick={() => void action(signRevoke)}>{revokeSigned ? "Step signed" : "Review & sign step"}</button>}
          {revokeStep?.receiptId && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcileRevoke)}>Check status</button>}
          {revokeSigned && revokeReceiptStatus !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryRevoke)}>Retry same signature</button>}
          {revokeStep?.status !== "ready" && <button className={secondaryButtonClass} disabled={busy || Boolean(revokeSigned && revokeReceiptStatus !== "confirmed")} onClick={() => void action(() => nextRevoke(revoking))}>Continue cleanup</button>}</div></div>}</section>
    {(founder || finance) ? <section className={`${cardClass} h-fit p-5 sm:p-7`}><h2 className="text-lg font-semibold">Grant access</h2><p className="mt-1 text-sm text-app-muted">Founder issues Finance and member grants. Finance may delegate scoped Manager access when its grant allows it.</p>
      <div className="mt-5 space-y-4"><label className="block text-sm font-medium">Grant type<select className={`${inputClass} mt-2`} value={mode} onChange={(e) => editGrant(() => setMode(e.target.value as typeof mode))}>
        {founder ? <><option value="member">Requester or Viewer</option><option value="finance">Root Finance</option></> : <option value="manager">Branch Manager</option>}</select></label>
        {mode !== "finance" && <label className="block text-sm font-medium">Member wallet<input className={`${inputClass} mt-2 font-mono`} value={member} onChange={(e) => editGrant(() => setMember(e.target.value))} placeholder="Solana address" /></label>}
        {mode === "finance" && <p className="rounded-lg bg-app-canvas p-3 text-sm">Policy Finance wallet: <span className="font-mono text-xs">{app.policy.value?.finance ?? "Unavailable"}</span></p>}
        {mode === "member" && <label className="block text-sm font-medium">Role<select className={`${inputClass} mt-2`} value={role} onChange={(e) => editGrant(() => setRole(e.target.value as typeof role))}><option value="requester">Requester</option><option value="viewer">Viewer</option></select></label>}
        {mode !== "finance" && <label className="block text-sm font-medium">Branch ID <span className="font-normal text-app-muted">{mode === "manager" ? "required" : "optional"}</span><input className={`${inputClass} mt-2`} value={branchId} onChange={(e) => editGrant(() => setBranchId(e.target.value))} inputMode="numeric" /></label>}
        {mode !== "member" && <><label className="block text-sm font-medium">Per payment cap (USDC)<input className={`${inputClass} mt-2`} value={perCap} onChange={(e) => editGrant(() => setPerCap(e.target.value))} inputMode="decimal" /></label>
          <label className="block text-sm font-medium">Period cap (USDC)<input className={`${inputClass} mt-2`} value={periodCap} onChange={(e) => editGrant(() => setPeriodCap(e.target.value))} inputMode="decimal" /></label>
          <label className="block text-sm font-medium">Allowed recipient wallets<textarea className={`${inputClass} mt-2 min-h-24 py-3 font-mono`} value={recipientsInput} onChange={(e) => editGrant(() => setRecipientsInput(e.target.value))} placeholder="One address per line" /></label></>}
        {mode === "finance" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mayDelegate} onChange={(e) => editGrant(() => setMayDelegate(e.target.checked))} className="accent-brand" />Can delegate Manager grants</label>}
        <button className={buttonClass} disabled={busy || Boolean(signed)} onClick={() => void action(prepareGrant)}>Prepare grant</button>
        {pending?.transaction && <div className="rounded-xl bg-app-canvas p-4 text-sm"><p className="font-semibold">Sign {mode === "member" ? role : mode} grant for {shortAddress(mode === "finance" ? app.policy.value?.finance : member)}</p><p className="mt-1 text-app-muted">Network: {pending.transaction.sendTo === "ephemeral" ? "MagicBlock private network" : "Solana devnet"}</p><button className={`${buttonClass} mt-3`} disabled={busy || Boolean(signed)} onClick={() => void action(signGrant)}>{signed ? "Grant signed" : "Review & sign"}</button></div>}
        {grantProof && <ReceiptProof receipt={grantProof} label="Grant" />}
        {signed && <div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcileGrant)}>Check status</button><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryGrant)}>Retry same signature</button></div>}</div></section> :
      <Notice title="Scoped team view" detail="You see only grants the private permission layer returns to your wallet. Founder and authorized Finance roles manage team access." />}
    {founder && <div className="xl:col-span-2"><PolicyReaderRestore app={app} /></div>}
    {(error || notice) && <p role={error ? "alert" : "status"} className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-brand/5 text-brand"}`}>{error ?? notice}</p>}
  </div>;
}
