"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { shortAddress } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof } from "./tx-proof";

type Step = { status: "build" | "wait"; transaction?: PreparedTransaction; receiptId?: string };
type Signed = { id: string; bytes: string; status: string;
  signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

export function ViewerSharePanel({ app }: { app: MercuriiController }) {
  const [request, setRequest] = useState(""); const [grantAddress, setGrantAddress] = useState("");
  const [step, setStep] = useState<Step | null>(null); const [signed, setSigned] = useState<Signed | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const grants = app.members.value?.flatMap((entry) => entry.grants) ?? [];
  const viewers = grants.filter((grant) => grant.role === 4 && grant.active && !grant.revoked);
  const unresolved = Boolean(signed && !["confirmed", "failed", "expired"].includes(signed.status));
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not share request"); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (unresolved) throw new Error("Reconcile the original sharing signature first");
    const viewerGrant = viewers.find((grant) => grant.address === grantAddress);
    if (!viewerGrant || !request) throw new Error("Select a payment and an active Viewer grant");
    const privateRequest = await app.request<{ requester: string; id: string }>(`/v1/payment-requests/${request}`);
    if (!app.programId) throw new Error("Program ID is unavailable");
    const branchId = Number(BigInt(privateRequest.id) >> 40n);
    const branchScope = PublicKey.findProgramAddressSync([Buffer.from("branch-scope"),
      new PublicKey(app.session!.company).toBuffer(),
      Buffer.from([branchId & 255, (branchId >>> 8) & 255, (branchId >>> 16) & 255])],
    new PublicKey(app.programId))[0].toBase58();
    const globalScope = PublicKey.default.toBase58();
    const requesterGrant = privateRequest.requester === app.session!.address ? null : grants.find((grant) =>
      grant.member === privateRequest.requester && grant.active && !grant.revoked &&
      (grant.role === 1 || grant.role === 3 && (grant.scope === globalScope || grant.scope === branchScope)));
    if (privateRequest.requester !== app.session!.address && !requesterGrant) {
      throw new Error("The original requester needs an active grant before preserving their access");
    }
    const result = await app.request<Step>("/v1/access/request-viewer/next", {
      actor: app.session!.address, request, viewerGrant: grantAddress, viewer: viewerGrant.member,
      includeRequester: true, ...(requesterGrant ? { requesterGrant: requesterGrant.address } : {}),
    });
    setStep(result); setSigned(null);
    setNotice(result.status === "build" ? "Review and sign the private reader update." :
      "A previous sharing receipt is still in progress. Inspect it before another update.");
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
    if (!signed) throw new Error("Original reader signature is unavailable");
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${signed.id}/reconcile`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Reader update ${result.receipt.status} · ${result.next.replaceAll("_", " ")}.`);
  }
  async function retryOriginal() {
    if (!signed) throw new Error("Original reader signature is unavailable");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${signed.id}/submit`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Same reader signature: ${result.receipt.status} · ${result.broadcast}.`);
  }
  return <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-lg font-semibold">Share a private payment with a Viewer</h2>
    <p className="mt-2 text-sm leading-6 text-app-muted">Choose a registered Viewer grant. Mercurii checks its scope and keeps active requester, Finance, and Manager readers where authorized.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Payment<select className="mt-2 min-h-11 w-full rounded-xl border border-app-line bg-white px-3 text-sm" value={request} disabled={unresolved} onChange={(e) => { setRequest(e.target.value); setStep(null); setSigned(null); }}><option value="">Select payment</option>
      {app.payments.value?.map((row) => <option key={row.record.paymentId} value={row.record.request}>{shortAddress(row.record.paymentId)} · {row.requestStatus}</option>)}</select></label>
      <label className="text-xs font-semibold">Viewer grant<select className="mt-2 min-h-11 w-full rounded-xl border border-app-line bg-white px-3 text-sm" value={grantAddress} disabled={unresolved} onChange={(e) => { setGrantAddress(e.target.value); setStep(null); setSigned(null); }}><option value="">Select Viewer</option>
        {viewers.map((grant) => <option key={grant.address} value={grant.address}>{shortAddress(grant.member)} · {shortAddress(grant.address)}</option>)}</select></label></div>
    <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || unresolved || !request || !grantAddress || Boolean(step && !signed)} onClick={() => void action(prepare)}>Prepare private share</button>
      {step?.transaction && <button className={secondaryButtonClass} disabled={busy || Boolean(signed)} onClick={() => void action(sign)}>Review & sign</button>}
      {signed && <><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>
        {signed.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</>}</div>
    {signed && <div className="mt-4"><ReceiptProof receipt={signed} label="Share update" /></div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-brand">{notice}</p>}
  </section>;
}
