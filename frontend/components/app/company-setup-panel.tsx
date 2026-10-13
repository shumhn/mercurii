"use client";

import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { formatUsdc, parseUsdc } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof, TxProof } from "./tx-proof";

type ReceiptState = { id: string; signed: string; status: string;
  operation?: string | null; signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

type SetupStep = { next: { status: "build" | "wait" | "ready"; operation: string | null;
  reason: string; sendTo: "base" | "ephemeral" | null }; transaction?: PreparedTransaction;
  receiptId?: string; snapshotAddress?: string };

type StoredTerms = { finance: string; monthlyLimit: string; agentCap: string };

function positiveAmount(value: string | undefined): string | null {
  if (!value) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? value : null;
}

/** The public company shell is created before this screen. This guided view
 * intentionally groups the remaining low-level operations into three founder
 * outcomes, so someone can finish setup without learning PER terminology. */
const SETUP_PHASES = [
  { title: "Connect your company privately", short: "Private network",
    description: "Move the company account to MagicBlock's private network.",
    operations: ["delegateCompany"], waiting: "Waiting for the private network to pick up the company — this takes a few seconds." },
  { title: "Protect company operations", short: "Privacy & rules",
    description: "Lock access, turn on privacy, and save your spending rules.",
    operations: ["initCompanyPermission", "activateCompanyPrivacy", "configureLimits"], waiting: null },
  { title: "Verify your private balance", short: "Balance tracker",
    description: "Create a private balance tracker before you fund the treasury.",
    operations: ["createSnapshotShell", "delegateSnapshot", "initSnapshotPermission", "activateSnapshotPrivacy"],
    waiting: "Waiting for the private network to pick up the balance tracker — this takes a few seconds." },
] as const;

function phaseOfOperation(operation: string | null | undefined): number {
  if (!operation) return -1;
  return SETUP_PHASES.findIndex((phase) => (phase.operations as readonly string[]).includes(operation));
}

function humanStepTitle(operation: string | null | undefined): string {
  const titles: Record<string, string> = {
    initializeCompany: "Create the company account",
    delegateCompany: "Move the company to the private network",
    initCompanyPermission: "Create private company permissions",
    activateCompanyPrivacy: "Turn on company privacy",
    configureLimits: "Set spending limits",
    createSnapshotShell: "Create the balance tracker",
    delegateSnapshot: "Move the balance tracker to the private network",
    initSnapshotPermission: "Create tracker permissions",
    activateSnapshotPrivacy: "Turn on tracker privacy",
  };
  return operation ? titles[operation] ?? operation.replace(/([A-Z])/g, " $1").trim() : "Company ready";
}

function signingLabel(operation: string | null | undefined): string {
  const labels: Record<string, string> = {
    delegateCompany: "Continue in your wallet",
    initCompanyPermission: "Create private access rules",
    activateCompanyPrivacy: "Turn on company privacy",
    configureLimits: "Save spending limits",
    createSnapshotShell: "Create the balance tracker",
    delegateSnapshot: "Move the tracker privately",
    initSnapshotPermission: "Protect the balance tracker",
    activateSnapshotPrivacy: "Finish private balance setup",
  };
  return operation ? labels[operation] ?? `Sign: ${humanStepTitle(operation)}` : "Continue in your wallet";
}

type StepProof = { operation: string; signature: string; chain: "base" | "ephemeral" };

function readStoredProofs(company: string | undefined): StepProof[] {
  if (!company || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`mercurii.setup-proof.${company}`) ?? "[]") as StepProof[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.signature === "string" &&
      typeof item.operation === "string" && (item.chain === "base" || item.chain === "ephemeral")) : [];
  } catch { return []; }
}

function readStoredTerms(company: string | undefined): StoredTerms | null {
  if (!company || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`mercurii.setup.${company}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTerms>;
    return typeof parsed.finance === "string" && typeof parsed.monthlyLimit === "string" &&
      typeof parsed.agentCap === "string" ? parsed as StoredTerms : null;
  } catch { return null; }
}

function receiptStorageKey(company: string): string {
  return `mercurii.setup-receipt.${company}`;
}

function readStoredReceipt(company: string | undefined): ReceiptState | null {
  if (!company || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(receiptStorageKey(company));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReceiptState>;
    if (typeof value.id !== "string" || typeof value.signed !== "string" ||
        typeof value.status !== "string" || !value.signed) return null;
    return value as ReceiptState;
  } catch { return null; }
}

function storeReceipt(company: string, receipt: ReceiptState | null): void {
  if (!company || typeof window === "undefined") return;
  try {
    if (receipt) window.localStorage.setItem(receiptStorageKey(company), JSON.stringify(receipt));
    else window.localStorage.removeItem(receiptStorageKey(company));
  } catch { /* Storage unavailable; the current tab can still finish the flow. */ }
}

export function CompanySetupPanel({ app, onComplete }: { app: MercuriiController; onComplete: () => void }) {
  const [termsKey] = useState(app.session?.company ?? "");
  const [storedTerms] = useState(() => readStoredTerms(termsKey));
  const finance = app.policy.value?.finance ?? storedTerms?.finance ?? app.session?.address ?? "";
  const [monthlyLimit, setMonthlyLimit] = useState(positiveAmount(storedTerms?.monthlyLimit) ??
    positiveAmount(app.policy.value ? (Number(app.policy.value.monthlyLimitMicro) / 1_000_000).toString() : undefined) ?? "");
  const [agentCap, setAgentCap] = useState(positiveAmount(storedTerms?.agentCap) ??
    positiveAmount(app.policy.value ? (Number(app.policy.value.agentCapMicro) / 1_000_000).toString() : undefined) ?? "");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(() => readStoredReceipt(termsKey));
  const [proofs, setProofs] = useState<StepProof[]>(() => readStoredProofs(termsKey));
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");

  useEffect(() => {
    if (!termsKey) return;
    try { window.localStorage.setItem(`mercurii.setup.${termsKey}`, JSON.stringify({ finance, monthlyLimit, agentCap })); }
    catch { /* Storage unavailable; terms stay in memory. */ }
  }, [termsKey, finance, monthlyLimit, agentCap]);

  useEffect(() => {
    if (!termsKey) return;
    try { window.localStorage.setItem(`mercurii.setup-proof.${termsKey}`, JSON.stringify(proofs)); }
    catch { /* Storage unavailable; proofs stay in memory. */ }
  }, [termsKey, proofs]);

  // Keep the signed bytes until the backend has observed the exact signature.
  // This makes wallet approval recoverable across refreshes and Fast Refresh.
  useEffect(() => { storeReceipt(termsKey, receipt); }, [termsKey, receipt]);

  /** Every signed step joins the proof trail once the network has its
   * signature, so completed-phase evidence survives the auto-advance. */
  function recordProof(value: ReceiptState) {
    if (!value.signature || !value.chain || !value.operation) return;
    const proof = { operation: value.operation, signature: value.signature, chain: value.chain };
    setProofs((prior) => prior.some((item) => item.signature === proof.signature) ? prior : [...prior, proof]);
  }

  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current || receipt || app.session?.role !== "founder") return;
    try { if (new PublicKey(finance).toBase58() !== finance) return; }
    catch { return; }
    if (!monthlyLimit || !agentCap) return;
    autoResumed.current = true;
    void action(prepare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.session]);

  function changeTerms(update: () => void) {
    if (receipt && receipt.status !== "confirmed") {
      setError("Check the signed step's status before changing these terms.");
      return;
    }
    update();
    setTerms(null);
    setStep(null);
    setReceipt(null);
    setMessage("");
  }

  async function action(task: () => Promise<void>) { setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Setup step failed"); }
    finally { setBusy(false); } }

  async function inspect(input: Record<string, unknown>) {
    const result = await app.request<SetupStep>("/v1/onboarding/next", input);
    setStep(result);
    const nextPhase = phaseOfOperation(result.next.operation);
    if (nextPhase >= 0) setPhaseIdx(nextPhase);
    setReceipt((prior) => prior?.status === "confirmed" && result.receiptId !== prior.id ? null : prior);
    setMessage(result.next.reason);
    if (result.next.status === "ready") { setPhaseIdx(SETUP_PHASES.length); await app.refresh(); }
  }

  /** After a step confirms, the next-state read can hit a transient RPC
   * hiccup (devnet, router, or PER). Retry quietly before showing an error
   * for a transition that should feel automatic. */
  async function inspectWithRetry(input: Record<string, unknown>, attempts = 3) {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { await inspect(input); return; }
      catch (cause) {
        lastError = cause;
        if (attempt + 1 < attempts) {
          setMessage("Network hiccup while loading the next step — retrying…");
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      }
    }
    throw lastError;
  }

  /** Rebuild the guided-flow terms from durable form values. React state can
   * be reset by a refresh or Fast Refresh while a wallet transaction is being
   * finalized, but a confirmed receipt must still advance to the next step. */
  function setupInput(): Record<string, unknown> {
    try { if (new PublicKey(finance).toBase58() !== finance) throw new Error(); }
    catch { throw new Error("The company administrator wallet is invalid"); }
    const monthlyLimitMicro = parseUsdc(monthlyLimit);
    const agentCapMicro = parseUsdc(agentCap);
    if (agentCapMicro > monthlyLimitMicro) throw new Error("Agent cap must fit within the monthly company limit");
    return { actor: app.session!.address, finance, monthlyLimitMicro, agentCapMicro };
  }

  async function continueAfterConfirmation() {
    const input = terms ?? setupInput();
    if (!terms) setTerms(input);
    setMessage("Step confirmed. Loading the next setup step…");
    await inspectWithRetry(input);
  }

  // While the private network catches up (status "wait"), poll instead of
  // making the founder press "Check progress" repeatedly.
  const waiting = step?.next.status === "wait";
  useEffect(() => {
    if (!waiting || !terms || busy) return;
    const timer = window.setTimeout(() => { void action(() => inspect(terms)); }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, terms, busy]);

  // Poll a signed receipt until the network reaches a final state — the
  // founder should never have to press "Check status" repeatedly.
  const receiptPending = Boolean(receipt && !["confirmed", "failed", "expired"].includes(receipt.status));
  useEffect(() => {
    if (!receiptPending || busy) return;
    const timer = window.setTimeout(() => {
      // A locally persisted `signed` receipt may not have reached the submit
      // endpoint before a reload. Submit those same bytes; never rebuild it.
      void action(receipt?.status === "signed" ? retryOriginal : reconcile);
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptPending, receipt?.status, busy]);

  // Recover a confirmed receipt that survived Fast Refresh or a component
  // remount. This also repairs sessions created by the older UI, which showed
  // the backend's internal `continue_guided_flow` marker instead of advancing.
  const continuedReceipt = useRef<string | null>(null);
  useEffect(() => {
    if (receipt?.status !== "confirmed" || busy || continuedReceipt.current === receipt.id) return;
    continuedReceipt.current = receipt.id;
    void action(continueAfterConfirmation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.id, receipt?.status, busy]);

  async function prepare() {
    if (receipt && receipt.status !== "confirmed") throw new Error("Check the signed step's status before continuing to another step.");
    const input = setupInput();
    setTerms(input); setStep(null); setReceipt(null); await inspect(input);
  }

  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No prepared setup transaction");
    const signed = await signPrepared(app.wallet, app.session!.address, step.transaction);
    const operation = step.next.operation;
    const locallySigned = { id: step.receiptId, signed: signed.signedTransactionBase64,
      status: "signed", operation };
    // Persist synchronously before the network request so a reload immediately
    // after wallet approval cannot lose the only copy of the signed bytes.
    storeReceipt(termsKey, locallySigned);
    setReceipt(locallySigned);
    const submitted = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`, { signedTransactionBase64: signed.signedTransactionBase64 });
    const current = { id: step.receiptId, signed: signed.signedTransactionBase64, status: submitted.receipt.status,
      operation, signature: submitted.receipt.signature ?? null, chain: submitted.receipt.chain };
    setReceipt(current);
    recordProof(current);
    if (submitted.receipt.status === "confirmed") {
      await continueAfterConfirmation();
      return;
    }
    setMessage(`Receipt ${submitted.receipt.status} · broadcast ${submitted.broadcast}. Checking automatically — this continues on its own.`);
  }

  async function reconcile() {
    if (!receipt) throw new Error("No signed receipt to reconcile");
    const result = await app.request<ReceiptResponse & { next?: string }>(
      `/v1/onboarding/receipts/${receipt.id}/reconcile`, { signedTransactionBase64: receipt.signed });
    const updated = { ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain };
    setReceipt(updated);
    recordProof(updated);
    if (result.receipt.status === "confirmed") {
      await continueAfterConfirmation();
      return;
    }
    setMessage(result.next === "wait_and_reconcile_same_signature"
      ? "Transaction submitted. Waiting for network confirmation…"
      : result.next === "provide_original_signed_transaction_or_inspect_target_state"
        ? "Signed transaction is ready to be submitted."
        : result.next === "inspect_target_before_rebuilding"
          ? "The transaction did not complete. Inspecting the current setup state is required before retrying."
          : `Receipt ${result.receipt.status}`);
  }

  async function retryOriginal() {
    if (!receipt) throw new Error("No signed setup transaction to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${receipt.id}/submit`, { signedTransactionBase64: receipt.signed });
    const updated = { ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain };
    setReceipt(updated);
    recordProof(updated);
    if (result.receipt.status === "confirmed") {
      await continueAfterConfirmation();
      return;
    }
    setMessage(`Original signature: ${result.receipt.status} · broadcast ${result.broadcast}. Checking automatically — this continues on its own.`);
  }

  const setupReady = step?.next.status === "ready";
  const currentPhase = setupReady ? SETUP_PHASES.length : phaseIdx;
  const controlsLocked = Boolean(receipt && receipt.status !== "confirmed");

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
    <section className={`${cardClass} p-5 sm:p-7`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-brand">Founder checklist</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Finish private company setup</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">Three outcomes remain before your company can receive private USDC. Mercurii handles the network steps; you only approve the requested wallet signature.</p></div>
        <span className="rounded-full bg-app-canvas px-3 py-1.5 text-xs font-semibold text-app-muted">{setupReady ? "Setup complete" : `Step ${Math.min(currentPhase + 1, SETUP_PHASES.length)} of ${SETUP_PHASES.length}`}</span></div>

      <ol aria-label="Private company setup progress" className="mt-7 grid gap-3 md:grid-cols-3">{SETUP_PHASES.map((phase, index) => {
        const done = setupReady || index < currentPhase;
        const current = !setupReady && index === currentPhase;
        return <li key={phase.short} className={`rounded-xl border p-4 ${done ? "border-emerald-200 bg-emerald-50" : current ? "border-brand/30 bg-brand/[.035]" : "border-app-line bg-white"}`}>
          <div className="flex items-center gap-2"><span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? "bg-emerald-600 text-white" : current ? "bg-brand text-white" : "bg-app-canvas text-app-muted"}`}>
            {done ? <Check className="size-3.5" aria-hidden /> : index + 1}</span><p className={`text-sm font-semibold ${done ? "text-emerald-900" : current ? "text-foreground" : "text-app-muted"}`}>{phase.title}</p></div>
          <p className="mt-2 text-xs leading-5 text-app-muted">{phase.description}</p>
          {current && waiting && <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Confirming on the private network…</p>}
        </li>;
      })}</ol>

      {app.session?.role !== "founder" ? <p className="mt-6 rounded-xl bg-app-canvas p-4 text-sm text-app-muted">Only the registered Founder can complete company setup.</p> : <>
        {!setupReady && !step && <form className="mt-7 rounded-2xl border border-app-line bg-app-canvas p-5" onSubmit={(event) => { event.preventDefault(); void action(prepare); }}>
          <div><h3 className="font-semibold">Company rules</h3><p className="mt-1 text-sm leading-6 text-app-muted">Set the private company spending rules. Your Founder wallet remains the administrator throughout setup.</p></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium" htmlFor="setup-monthly-limit">Monthly limit (USDC)
              <input id="setup-monthly-limit" className={`${inputClass} mt-2`} value={monthlyLimit} disabled={controlsLocked || busy} onChange={(e) => changeTerms(() => setMonthlyLimit(e.target.value))} inputMode="decimal" autoComplete="off" /></label>
            <label className="text-sm font-medium" htmlFor="setup-agent-cap">AI-agent cap (USDC)
              <input id="setup-agent-cap" className={`${inputClass} mt-2`} value={agentCap} disabled={controlsLocked || busy} onChange={(e) => changeTerms(() => setAgentCap(e.target.value))} inputMode="decimal" autoComplete="off" /></label></div>
          {!step && <button type="submit" className={`${buttonClass} mt-5`} disabled={busy || controlsLocked}>{busy ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Checking setup…</> : <>Begin private setup<ArrowRight className="size-4" aria-hidden /></>}</button>}
        </form>}

        {setupReady && <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><Check className="size-5" aria-hidden /></span><div><p className="font-semibold text-emerald-950">Your private company account is ready.</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900">Company rules and the balance tracker are active. Your next task is to fund the private treasury with USDC.</p>
            <button className={`${buttonClass} mt-4 bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-700`} onClick={onComplete}>Fund private treasury<ArrowRight className="size-4" aria-hidden /></button></div></div></div>}

        {step && !setupReady && <section aria-live="polite" className="mt-5 rounded-2xl border border-brand/20 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-brand">Your next action</p>
            <h3 className="mt-2 text-lg font-semibold">{waiting ? "Waiting for private confirmation" : humanStepTitle(step.next.operation)}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-app-muted">{waiting ? SETUP_PHASES[phaseIdx]?.waiting ?? step.next.reason : step.next.reason}</p></div>
            <span className="rounded-full bg-app-canvas px-3 py-1.5 text-xs font-semibold text-app-muted">{step.next.sendTo === "ephemeral" ? "MagicBlock private network" : "Solana devnet"}</span></div>
          {step.transaction && <button className={`${buttonClass} mt-5`} disabled={busy || Boolean(receipt)} onClick={() => void action(sign)}>{receipt ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Checking confirmation…</> : <>{signingLabel(step.next.operation)}<ArrowRight className="size-4" aria-hidden /></>}</button>}
          {receipt && <div className="mt-5"><ReceiptProof receipt={receipt} label={humanStepTitle(receipt.operation)} /><div className="mt-3 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>{receipt.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div></div>}
        </section>}
      </>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">Setup needs attention</p><p className="mt-1">{error}</p></div>}
      {message && !error && <p role="status" className="mt-5 rounded-xl bg-brand/5 p-4 text-sm text-brand">{message}</p>}
    </section>
    <aside className={`${cardClass} h-fit p-5 sm:p-7`}><p className="text-xs font-bold uppercase tracking-[.12em] text-app-muted">Setup summary</p><h2 className="mt-2 text-lg font-semibold">Company controls</h2>
      <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-app-muted">Company administrator</dt><dd className="mt-1 break-all font-mono text-xs">{app.session?.address ?? "Not connected"}</dd></div>
        <div className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-app-muted">Monthly limit</dt><dd className="mt-1 font-semibold tabular-nums">{app.policy.value?.monthlyLimitMicro && app.policy.value.monthlyLimitMicro !== "0" ? formatUsdc(app.policy.value.monthlyLimitMicro) : monthlyLimit ? `${monthlyLimit} USDC` : "Not set"}</dd></div><div><dt className="text-xs text-app-muted">AI-agent cap</dt><dd className="mt-1 font-semibold tabular-nums">{app.policy.value?.agentCapMicro && app.policy.value.agentCapMicro !== "0" ? formatUsdc(app.policy.value.agentCapMicro) : agentCap ? `${agentCap} USDC` : "Not set"}</dd></div></div>
        <div><dt className="text-xs text-app-muted">Company account</dt><dd className="mt-1 break-all font-mono text-xs">{app.session?.company}</dd></div></dl>
      <div className="mt-6 rounded-xl bg-app-canvas p-4"><div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><p className="text-xs leading-5 text-app-muted">Mercurii keeps this setup simple: your wallet signs, MagicBlock validates the private state, and each completed action keeps an explorer proof.</p></div></div>
      {proofs.length > 0 && <details className="mt-6 border-t border-app-line pt-5"><summary className="cursor-pointer text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-brand">View setup proof history ({proofs.length})</summary>
        <p className="mt-2 text-xs leading-5 text-app-muted">Every finished step links to the correct network explorer.</p><div className="mt-3 space-y-2">{proofs.map((proof) =>
          <TxProof key={proof.signature} signature={proof.signature} label={humanStepTitle(proof.operation)} chain={proof.chain} />)}</div></details>}
    </aside>
  </div>;
}
