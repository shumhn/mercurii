"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from "./mercurii-app";

type SetupStep = { next: { status: "build" | "wait" | "ready"; operation: string | null;
  reason: string; sendTo: "base" | "ephemeral" | null }; transaction?: PreparedTransaction;
  receiptId?: string; snapshotAddress?: string };

export function CompanySetupPanel({ app }: { app: MercuriiController }) {
  const [finance, setFinance] = useState(app.policy.value?.finance ?? "");
  const [monthlyLimit, setMonthlyLimit] = useState(app.policy.value ? (Number(app.policy.value.monthlyLimitMicro) / 1_000_000).toString() : "");
  const [agentCap, setAgentCap] = useState(app.policy.value ? (Number(app.policy.value.agentCapMicro) / 1_000_000).toString() : "");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; signed: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");

  function changeTerms(update: () => void) {
    if (receipt && receipt.status !== "confirmed") {
      setError("Reconcile the signed setup receipt before changing these terms.");
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
    setReceipt((prior) => prior?.status === "confirmed" && result.receiptId !== prior.id ? null : prior);
    setMessage(result.next.reason);
    if (result.next.status === "ready") await app.refresh();
  }

  async function prepare() {
    if (receipt && receipt.status !== "confirmed") throw new Error("Reconcile the signed setup receipt before inspecting another step.");
    try { if (new PublicKey(finance).toBase58() !== finance) throw new Error(); }
    catch { throw new Error("Enter a valid Finance wallet"); }
    const monthlyLimitMicro = parseUsdc(monthlyLimit);
    const agentCapMicro = parseUsdc(agentCap);
    if (agentCapMicro > monthlyLimitMicro) throw new Error("Agent cap must fit within the monthly company limit");
    const input = { actor: app.session!.address, finance, monthlyLimitMicro, agentCapMicro };
    setTerms(input); setStep(null); setReceipt(null); await inspect(input);
  }

  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No prepared setup transaction");
    const signed = await signPrepared(app.wallet, app.session!.address, step.transaction);
    setReceipt({ id: step.receiptId, signed: signed.signedTransactionBase64, status: "signed" });
    const submitted = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`, { signedTransactionBase64: signed.signedTransactionBase64 });
    setReceipt({ id: step.receiptId, signed: signed.signedTransactionBase64, status: submitted.receipt.status });
    setMessage(`Receipt ${submitted.receipt.status} · broadcast ${submitted.broadcast}. Reconcile before continuing.`);
  }

  async function reconcile() {
    if (!receipt) throw new Error("No signed receipt to reconcile");
    const result = await app.request<{ receipt: { status: string }; next?: string }>(
      `/v1/onboarding/receipts/${receipt.id}/reconcile`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status }); setMessage(result.next ?? `Receipt ${result.receipt.status}`);
  }

  async function retryOriginal() {
    if (!receipt) throw new Error("No signed setup transaction to retry");
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${receipt.id}/submit`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status });
    setMessage(`Original signature: ${result.receipt.status} · broadcast ${result.broadcast}. Reconcile before continuing.`);
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">Set up private company state</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">The registered Founder signs each step. Mercurii creates the public shell, delegates it to MagicBlock, activates private permissions, then writes limits into the private account.</p>
      {app.session?.role !== "founder" ? <p className="mt-5 text-sm text-app-muted">Only the registered Founder can run company setup.</p> : <>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Finance wallet<input className={`${inputClass} mt-2 font-mono`} value={finance} onChange={(e) => changeTerms(() => setFinance(e.target.value))} placeholder="Solana address" /></label>
          <label className="text-sm font-medium">Monthly limit (USDC)<input className={`${inputClass} mt-2`} value={monthlyLimit} onChange={(e) => changeTerms(() => setMonthlyLimit(e.target.value))} inputMode="decimal" /></label>
          <label className="text-sm font-medium">Agent cap (USDC)<input className={`${inputClass} mt-2`} value={agentCap} onChange={(e) => changeTerms(() => setAgentCap(e.target.value))} inputMode="decimal" /></label></div>
        <p className="mt-3 text-xs leading-5 text-app-muted">If a company shell already exists, use its original Finance wallet. Changing these fields mid-flow requires a fresh inspection.</p>
        <div className="mt-6 flex flex-wrap gap-3"><button className={buttonClass} disabled={busy || Boolean(receipt && receipt.status !== "confirmed")} onClick={() => void action(prepare)}>Inspect next step</button>
          {terms && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(() => inspect(terms))}>Check progress</button>}</div>
        {step && <div className="mt-6 rounded-xl border border-app-line bg-app-canvas p-5"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">{step.next.status} · {step.next.sendTo ?? "Private state"}</p>
          <h3 className="mt-2 font-semibold">{step.next.operation?.replace(/([A-Z])/g, " $1").trim() ?? "Company ready"}</h3><p className="mt-1 text-sm text-app-muted">{step.next.reason}</p>
          {step.transaction && <button className={`${buttonClass} mt-4`} disabled={busy || Boolean(receipt)} onClick={() => void action(sign)}>{receipt ? "Transaction signed" : `Review & sign ${step.transaction.operation ?? "step"}`}</button>}
          {receipt && <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-app-muted"><span>Receipt {shortAddress(receipt.id)} · {receipt.status}</span><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Reconcile</button>{receipt.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div>}</div>}
      </>}
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-5 rounded-xl bg-brand/5 p-4 text-sm text-brand">{message}</p>}
    </section>
    <section className={`${cardClass} h-fit p-5 sm:p-7`}><h2 className="font-semibold">Current policy</h2><p className="mt-2 text-xs text-app-muted">Values appear after the private account grants this wallet read access.</p>
      <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-app-muted">Company</dt><dd className="mt-1 break-all font-mono text-xs">{app.session?.company}</dd></div><div><dt className="text-xs text-app-muted">Finance</dt><dd className="mt-1 break-all font-mono text-xs">{app.policy.value?.finance ?? "Private policy not readable yet"}</dd></div>
        <div><dt className="text-xs text-app-muted">Monthly limit</dt><dd className="mt-1 font-semibold">{formatUsdc(app.policy.value?.monthlyLimitMicro)}</dd></div><div><dt className="text-xs text-app-muted">Agent cap</dt><dd className="mt-1 font-semibold">{formatUsdc(app.policy.value?.agentCapMicro)}</dd></div></dl>
    </section>
  </div>;
}
