"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof } from "./tx-proof";

type Step = { status: "build" | "wait"; receiptId?: string; transaction?: PreparedTransaction };
type Signed = { id: string; bytes: string; status: string;
  signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

export function PolicyReaderRestore({ app }: { app: MercuriiController }) {
  const [grant, setGrant] = useState(""); const [step, setStep] = useState<Step | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const grants = app.members.value?.flatMap((entry) => entry.grants).filter((item) =>
    item.role === 1 && item.active && !item.revoked && item.member === app.policy.value?.finance) ?? [];
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Reader recovery failed"); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (signed && !["confirmed", "failed", "expired"].includes(signed.status)) {
      throw new Error("Reconcile the original signed reader update first");
    }
    if (!grants.some((item) => item.address === grant)) throw new Error("Select an active Founder-issued Finance grant");
    const result = await app.request<Step>("/v1/access/policy-readers/restore/next",
      { actor: app.session!.address, grant });
    setStep(result); setSigned(null);
    setNotice(result.status === "wait" ? "Previous reader update is in progress. Inspect its receipt before signing again." :
      "Review and sign the private policy reader update.");
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet || signed) throw new Error("No unsigned reader update is ready");
    const result = await signPrepared(app.wallet, app.session!.address, step.transaction);
    const original: Signed = { id: step.receiptId, bytes: result.signedTransactionBase64, status: "signed" };
    setSigned(original);
    const submitted = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${original.id}/submit`, { signedTransactionBase64: original.bytes });
    setSigned({ ...original, status: submitted.receipt.status,
      signature: submitted.receipt.signature ?? null, chain: submitted.receipt.chain });
    setNotice(`Reader update ${submitted.receipt.status} · ${submitted.broadcast}.`);
  }
  async function reconcile() {
    if (!signed) throw new Error("Original signed reader update is unavailable");
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${signed.id}/reconcile`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Reader update ${result.receipt.status} · ${result.next.replaceAll("_", " ")}.`);
    if (result.receipt.status === "confirmed") await app.refresh();
  }
  async function retryOriginal() {
    if (!signed) throw new Error("Original signature is unavailable");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${signed.id}/submit`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Same reader signature: ${result.receipt.status} · ${result.broadcast}.`);
  }
  return <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-lg font-semibold">Finance reader recovery</h2>
    <p className="mt-2 text-sm leading-6 text-app-muted">After issuing a new active Finance grant, the Founder can restore that wallet&apos;s private company policy access. This does not grant spending authority by itself.</p>
    <div className="mt-4 flex flex-wrap gap-2"><label className="min-w-48 flex-1 text-xs font-semibold">Finance grant<select className="mt-2 min-h-11 w-full rounded-xl border border-app-line bg-white px-3 text-sm" value={grant} onChange={(e) => { setGrant(e.target.value); setStep(null); setSigned(null); }}><option value="">Select grant</option>
      {grants.map((item) => <option key={item.address} value={item.address}>{shortAddress(item.member)} · {shortAddress(item.address)}</option>)}</select></label></div>
    <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !grant || Boolean(step && !signed)} onClick={() => void action(prepare)}>Prepare reader restoration</button>
      {step?.transaction && <button className={secondaryButtonClass} disabled={busy || Boolean(signed)} onClick={() => void action(sign)}>Review & sign</button>}
      {signed && <><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>
        {signed.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</>}</div>
    {signed && <div className="mt-4"><ReceiptProof receipt={signed} label="Reader update" /></div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
  </section>;
}
