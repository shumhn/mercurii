"use client";

import { useState } from "react";
import { ArrowDownLeft, ShieldCheck } from "lucide-react";
import { formatUsdc, parseUsdc } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, inputClass, Notice, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof } from "./tx-proof";

type FundingStep = { status: string; observedBalanceMicro?: string | null;
  receiptId?: string | null; transaction?: PreparedTransaction | null };
type ReceiptState = { id: string; signed: string; status: string;
  signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

export function ReceivePanel({ app }: { app: MercuriiController }) {
  const founder = app.session?.role === "founder";
  const [amount, setAmount] = useState("");
  const [fundingId, setFundingId] = useState("");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<FundingStep | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  async function action(task: () => Promise<void>) { setBusy(true); setError(null); setNotice(""); try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Funding action failed"); } finally { setBusy(false); } }
  async function next() {
    if (!terms) throw new Error("Prepare a funding request first");
    const result = await app.request<FundingStep>("/v1/onboarding/company-funding/next", terms);
    setStep(result);
    if (receipt?.status === "confirmed" && result.receiptId !== receipt.id) setReceipt(null);
    setNotice(`Funding step: ${result.status.replaceAll("_", " ")}`);
  }
  async function prepare() {
    if (receipt && !["confirmed", "failed"].includes(receipt.status)) throw new Error("Reconcile the signed deposit before starting another funding request.");
    if (terms && step?.status !== "ready" && receipt?.status !== "failed") throw new Error("Complete the current deposit and snapshot sync before starting another.");
    const amountMicro = parseUsdc(amount);
    const observed = BigInt(app.snapshot.value?.balanceMicro ?? "0");
    const target = observed + BigInt(amountMicro);
    if (target > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Target balance exceeds the supported range");
    const id = step?.status === "ready" || receipt?.status === "failed" || !fundingId ? crypto.randomUUID() : fundingId;
    setFundingId(id);
    const input = { actor: app.session!.address, payer: app.session!.address,
      amountMicro, targetBalanceMicro: Number(target), fundingId: id };
    setTerms(input); setStep(null); setReceipt(null);
    const result = await app.request<FundingStep>("/v1/onboarding/company-funding/next", input);
    setStep(result); setNotice(`Funding step: ${result.status.replaceAll("_", " ")}`);
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No funding transaction to sign");
    if (receipt?.id === step.receiptId) throw new Error("This transaction was already signed. Reconcile or retry its original signature.");
    const signed = await signPrepared(app.wallet, app.session!.address, step.transaction);
    const id = step.receiptId;
    setReceipt({ id, signed: signed.signedTransactionBase64, status: "signed" });
    const result = await app.request<ReceiptResponse & { broadcast: string }>(`/v1/onboarding/receipts/${id}/submit`,
      { signedTransactionBase64: signed.signedTransactionBase64 });
    setReceipt({ id, signed: signed.signedTransactionBase64, status: result.receipt.status,
      signature: result.receipt.signature ?? null, chain: result.receipt.chain });
    setNotice(`Receipt ${result.receipt.status} · broadcast ${result.broadcast}. Refresh after the private treasury snapshot syncs.`); await app.refresh();
  }
  async function reconcile() {
    if (!receipt) return;
    const result = await app.request<ReceiptResponse & { next: string }>(`/v1/onboarding/receipts/${receipt.id}/reconcile`,
      { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain });
    setNotice(result.next); await app.refresh();
  }
  async function retryOriginal() {
    if (!receipt) throw new Error("No signed deposit to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${receipt.id}/submit`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain });
    setNotice(`Original signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
    await app.refresh();
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <section className={`${cardClass} p-5 sm:p-7`}><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand"><ArrowDownLeft className="size-5" /></span><div><h2 className="text-xl font-semibold">Fund the private treasury</h2><p className="text-sm text-app-muted">MagicBlock Private Payments · Circle devnet USDC</p></div></div>
      {!founder ? <div className="mt-6"><Notice title="Founder action" detail="Only the Founder can advance company treasury funding. Share the company account address with an authorized payer." /></div> :
        !app.capabilities.privateReceive ? <div className="mt-6"><Notice title="Private receive is not enabled" detail="This backend has not enabled its experimental Circle devnet USDC receive flow. The company address and treasury snapshot remain visible for review." /></div> : <>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-app-muted">A payer signs a private deposit, then the Founder signs a treasury snapshot sync. The displayed balance changes only after private state confirms. This flow requires the backend&apos;s experimental receive gate.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Payer wallet<input className={`${inputClass} mt-2 font-mono`} value={app.session!.address} readOnly /></label>
          <label className="text-sm font-medium">Deposit amount (USDC)<input className={`${inputClass} mt-2`} value={amount} disabled={Boolean(terms && step?.status !== "ready" && receipt?.status !== "failed")} onChange={(e) => { setAmount(e.target.value); setTerms(null); setStep(null); setFundingId(""); }} inputMode="decimal" placeholder="0.00" /></label></div>
        <div className="mt-6 flex flex-wrap gap-3"><button className={buttonClass} disabled={busy || Boolean(terms && step?.status !== "ready" && receipt?.status !== "failed")} onClick={() => void action(prepare)}>{step?.status === "ready" ? "Start another deposit" : "Prepare private deposit"}</button>
          {terms && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(next)}>Check next step</button>}</div>
        {step && <div className="mt-6 rounded-xl border border-app-line bg-app-canvas p-5"><p className="font-semibold capitalize">{step.status.replaceAll("_", " ")}</p>
          <p className="mt-1 text-sm text-app-muted">Observed private balance: {formatUsdc(step.observedBalanceMicro)}</p>
          {step.transaction && <div className="mt-4 flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-brand" />{step.transaction.operation ?? "Funding step"} · {step.transaction.sendTo === "ephemeral" ? "MagicBlock private network" : "Solana devnet"}</span><button className={buttonClass} disabled={busy || receipt?.id === step.receiptId} onClick={() => void action(sign)}>{receipt?.id === step.receiptId ? "Signed · reconcile" : "Review & sign"}</button></div>}
          {receipt && <div className="mt-4"><ReceiptProof receipt={receipt} label="Deposit" /><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-app-muted"><button className="font-semibold text-brand" disabled={busy} onClick={() => void action(reconcile)}>Check status</button>{receipt.status !== "confirmed" && <button className="font-semibold text-brand" disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div></div>}</div>}
      </>}
      {(error || notice) && <p role={error ? "alert" : "status"} className={`mt-5 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-brand/5 text-brand"}`}>{error ?? notice}</p>}
    </section>
    <section className={`${cardClass} h-fit p-5 sm:p-7`}><h2 className="text-base font-semibold">Receive details</h2><dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-app-muted">Company account</dt><dd className="mt-1 break-all font-mono text-xs">{app.session?.company}</dd></div><div><dt className="text-xs text-app-muted">Private snapshot</dt><dd className="mt-1 font-semibold">{formatUsdc(app.snapshot.value?.balanceMicro)}</dd></div><div><dt className="text-xs text-app-muted">Mint</dt><dd className="mt-1 break-all font-mono text-xs">{app.policy.value?.mint ?? "Permissioned"}</dd></div></dl>
      <p className="mt-5 border-t border-app-line pt-4 text-xs leading-5 text-app-muted">Use the guided flow to preserve the original signed deposit and prevent duplicate funding after an uncertain network response.</p></section>
  </div>;
}

export function WithdrawPanel({ app }: { app: MercuriiController }) {
  const [amount, setAmount] = useState(""); const [withdrawalId, setWithdrawalId] = useState("");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<FundingStep | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  async function action(task: () => Promise<void>) { setBusy(true); setError(null); setNotice(""); try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Withdrawal action failed"); } finally { setBusy(false); } }
  async function prepare() {
    if (receipt && !["confirmed", "failed"].includes(receipt.status)) throw new Error("Reconcile the signed withdrawal before preparing another one.");
    const amountMicro = parseUsdc(amount);
    const availableMicro = BigInt(app.recipientBalance.value?.balanceMicro ?? "0");
    if (BigInt(amountMicro) > availableMicro) throw new Error("Withdrawal exceeds your private recipient balance");
    const id = receipt && ["confirmed", "failed"].includes(receipt.status) || !withdrawalId ? crypto.randomUUID() : withdrawalId;
    setWithdrawalId(id);
    const input = { owner: app.session!.address, amountMicro, withdrawalId: id };
    setTerms(input); setStep(null); setReceipt(null);
    const result = await app.request<FundingStep>("/v1/onboarding/recipient-withdraw/next", input);
    setStep(result); setNotice(`Withdrawal step: ${result.status.replaceAll("_", " ")}`);
  }
  async function checkNext() {
    if (!terms) throw new Error("Prepare a withdrawal first");
    const result = await app.request<FundingStep>("/v1/onboarding/recipient-withdraw/next", terms);
    setStep(result);
    if (receipt?.status === "confirmed" && result.receiptId !== receipt.id) setReceipt(null);
    setNotice(`Withdrawal step: ${result.status.replaceAll("_", " ")}`);
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No withdrawal transaction to sign");
    if (receipt?.id === step.receiptId) throw new Error("This withdrawal was already signed. Reconcile or retry its original signature.");
    const signed = await signPrepared(app.wallet, app.session!.address, step.transaction);
    setReceipt({ id: step.receiptId, signed: signed.signedTransactionBase64, status: "signed" });
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${step.receiptId}/submit`, { signedTransactionBase64: signed.signedTransactionBase64 });
    setReceipt({ id: step.receiptId, signed: signed.signedTransactionBase64, status: result.receipt.status,
      signature: result.receipt.signature ?? null, chain: result.receipt.chain });
    setNotice(`Receipt ${result.receipt.status} · broadcast ${result.broadcast}. Confirm before starting another withdrawal.`);
    await app.refresh();
  }
  async function reconcile() {
    if (!receipt) return;
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${receipt.id}/reconcile`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain });
    setNotice(result.next); await app.refresh();
  }
  async function retryOriginal() {
    if (!receipt) throw new Error("No signed withdrawal to retry");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${receipt.id}/submit`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status,
      signature: result.receipt.signature ?? receipt.signature, chain: result.receipt.chain ?? receipt.chain });
    setNotice(`Original signature: ${result.receipt.status} · broadcast ${result.broadcast}.`);
    await app.refresh();
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-xl font-semibold">Withdraw your private USDC</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">Your wallet signs a withdrawal from its own private recipient balance. The backend binds the exact signed transaction to a receipt so an uncertain result can be reconciled.</p>
      {!app.capabilities.recipientWithdraw ? <div className="mt-6"><Notice title="Withdrawal is not enabled" detail="The configured devnet mint has not passed the backend's withdrawal gate. Your private balance can still be viewed below." /></div> : <>
        <label className="mt-6 block max-w-sm text-sm font-semibold">Amount (USDC)<input className={`${inputClass} mt-2`} value={amount} disabled={Boolean(receipt && !["confirmed", "failed"].includes(receipt.status))} onChange={(e) => { setAmount(e.target.value); setStep(null); setTerms(null); setWithdrawalId(""); }} inputMode="decimal" placeholder="0.00" /></label>
        <div className="mt-5 flex flex-wrap gap-3"><button className={buttonClass} disabled={busy || !amount || Boolean(receipt && !["confirmed", "failed"].includes(receipt.status))} onClick={() => void action(prepare)}>Prepare withdrawal</button>
          {terms && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(checkNext)}>Check next step</button>}
          {step?.transaction && <button className={secondaryButtonClass} disabled={busy || receipt?.id === step.receiptId} onClick={() => void action(sign)}>{receipt?.id === step.receiptId ? "Signed · reconcile" : "Review & sign"}</button>}
          {receipt && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>}
          {receipt && receipt.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div>
        {receipt && <div className="mt-4"><ReceiptProof receipt={receipt} label="Withdrawal" /></div>}
        {step && !receipt && <p className="mt-4 text-sm text-app-muted">Step: {step.status.replaceAll("_", " ")}</p>}
      </>}
      {(error || notice) && <p role={error ? "alert" : "status"} className={`mt-5 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-brand/5 text-brand"}`}>{error ?? notice}</p>}</section>
    <section className={`${cardClass} h-fit p-5 sm:p-7`}><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Your private recipient balance</p><p className="mt-3 text-3xl font-semibold">{formatUsdc(app.recipientBalance.value?.balanceMicro)}</p>
      <p className="mt-2 break-all font-mono text-xs text-app-muted">{app.session?.address}</p><p className="mt-4 text-xs leading-5 text-app-muted">This is your wallet&apos;s balance on the private validator, not the company&apos;s treasury balance.</p></section>
  </div>;
}
