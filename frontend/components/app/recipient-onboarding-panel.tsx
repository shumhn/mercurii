"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from "./mercurii-app";

type Step = { status: "needs_deposit" | "wait" | "ready"; recipient: string;
  balanceMicro: string | null; transaction: PreparedTransaction | null; receiptId: string | null };
type Receipt = { id: string; signed: string; status: string };

export function RecipientOnboardingPanel({ app }: { app: MercuriiController }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingSignature = Boolean(receipt && !["confirmed", "failed", "expired"].includes(receipt.status));

  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recipient step failed"); }
    finally { setBusy(false); }
  }
  async function inspect(input: Record<string, unknown>) {
    const result = await app.request<Step>("/v1/onboarding/recipient/next", input);
    setStep(result);
    if (result.status === "ready") {
      setNotice(`Recipient private balance ready: ${formatUsdc(result.balanceMicro)}.`);
      await app.refresh();
    } else if (result.status === "wait") {
      setNotice("A deposit receipt is already in progress. Reconcile its original signature before another deposit.");
    } else setNotice("Private recipient deposit is ready for the payer wallet to sign.");
  }
  async function prepare() {
    if (pendingSignature) throw new Error("Reconcile the signed recipient deposit first.");
    if (!app.capabilities.privateReceive) throw new Error("Private receive is disabled on this backend.");
    let wallet: PublicKey;
    try { wallet = new PublicKey(recipient.trim()); } catch { throw new Error("Enter a valid recipient wallet"); }
    if (wallet.toBase58() !== recipient.trim() || !PublicKey.isOnCurve(wallet.toBytes())) {
      throw new Error("Recipient must be a wallet address, not a program account");
    }
    const input = { payer: app.session!.address, recipient: recipient.trim(), amountMicro: parseUsdc(amount),
      depositId: crypto.randomUUID() };
    setTerms(input); setStep(null); setReceipt(null);
    await inspect(input);
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet) throw new Error("No recipient deposit is ready");
    if (receipt?.id === step.receiptId) throw new Error("This deposit was already signed. Reconcile its original receipt.");
    const signed = await signPrepared(app.wallet, app.session!.address, step.transaction);
    const original = { id: step.receiptId, signed: signed.signedTransactionBase64, status: "signed" };
    setReceipt(original);
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${original.id}/submit`, { signedTransactionBase64: original.signed });
    setReceipt({ ...original, status: result.receipt.status });
    setNotice(`Original deposit ${result.receipt.status} · broadcast ${result.broadcast}.`);
  }
  async function reconcile() {
    if (!receipt) throw new Error("No signed receipt is available in this tab");
    const result = await app.request<{ receipt: { status: string }; next: string }>(
      `/v1/onboarding/receipts/${receipt.id}/reconcile`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status });
    setNotice(`Recipient receipt ${result.receipt.status}. ${result.next.replaceAll("_", " ")}.`);
    if (result.receipt.status === "confirmed") await app.refresh();
  }
  async function retryOriginal() {
    if (!receipt) throw new Error("No original signature is available");
    const result = await app.request<{ receipt: { status: string }; broadcast: string }>(
      `/v1/onboarding/receipts/${receipt.id}/submit`, { signedTransactionBase64: receipt.signed });
    setReceipt({ ...receipt, status: result.receipt.status });
    setNotice(`Same signature: ${result.receipt.status} · ${result.broadcast}.`);
  }

  return <section className={`${cardClass} p-5 sm:p-7`}>
    <h2 className="text-lg font-semibold">Prepare a recipient for private payouts</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">A new employee, contractor, or vendor needs a private recipient balance before their first USDC payout. The connected payer wallet signs a small initial deposit. This is separate from registering a payee.</p>
    {!app.capabilities.privateReceive ? <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Recipient deposits are disabled until the backend verifies and enables the Circle devnet USDC receive flow.</p> : <>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Recipient wallet<input className={`${inputClass} mt-2 font-mono`} value={recipient} disabled={Boolean(terms && step?.status !== "ready" && receipt?.status !== "failed")} onChange={(e) => setRecipient(e.target.value)} placeholder="Solana wallet address" /></label>
        <label className="text-sm font-medium">Initial deposit (USDC)<input className={`${inputClass} mt-2`} value={amount} disabled={Boolean(terms && step?.status !== "ready" && receipt?.status !== "failed")} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.01" /></label>
      </div>
      <p className="mt-3 text-xs text-app-muted">Payer: {shortAddress(app.session?.address)}. This amount leaves the payer wallet when signed.</p>
      <div className="mt-5 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || pendingSignature || Boolean(terms && step?.status !== "ready" && receipt?.status !== "failed")} onClick={() => void action(prepare)}>Check & prepare recipient</button>
        {terms && <button className={secondaryButtonClass} disabled={busy || pendingSignature} onClick={() => void action(() => inspect(terms))}>Check next step</button>}</div>
      {step && <div className="mt-5 rounded-xl border border-app-line bg-app-canvas p-4 text-sm"><p className="font-semibold capitalize">{step.status.replaceAll("_", " ")}</p>
        {step.status === "ready" && <p className="mt-1 text-app-muted">Private balance: {formatUsdc(step.balanceMicro)}</p>}
        {step.transaction && <button className={`${buttonClass} mt-3`} disabled={busy || Boolean(receipt)} onClick={() => void action(sign)}>{receipt ? "Deposit signed" : "Review & sign deposit"}</button>}
        {receipt && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span>Receipt {shortAddress(receipt.id)} · {receipt.status}</span><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Reconcile</button>{receipt.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div>}</div>}
    </>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-brand/5 p-4 text-sm text-brand">{notice}</p>}
  </section>;
}
