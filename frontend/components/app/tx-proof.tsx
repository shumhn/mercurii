"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { shortAddress } from "@/lib/mercurii-client";

/** MagicBlock devnet networks. Base-layer transactions settle on Solana devnet;
 * private company transactions settle on the MagicBlock PER (TEE) validator. */
export const MAGICBLOCK_TEE_RPC = "https://devnet-tee.magicblock.app";
export const MAGICBLOCK_ER_RPC = "https://devnet.magicblock.app";
const MAGICBLOCK_TEE_HOST = new URL(MAGICBLOCK_TEE_RPC).hostname;

/** Solana Explorer targets. Mercurii runs on devnet; private (ephemeral) state
 * needs a custom-cluster URL pointed at the MagicBlock validator. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

/** Solana Explorer pointed at a MagicBlock network via a custom cluster.
 * The TEE auth token is never placed in the URL — it is a read key to private
 * PER state, and URLs leak into logs and screenshots. */
export function magicBlockTxUrl(signature: string, network: "tee" | "er" = "tee"): string {
  const rpc = network === "tee" ? MAGICBLOCK_TEE_RPC : MAGICBLOCK_ER_RPC;
  return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
}

export type ProofReceipt = {
  id: string;
  status: string;
  signature?: string | null;
  chain?: "base" | "ephemeral";
};

/** Copy-to-clipboard chip with check-flip feedback. */
export function CopyValue({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" title={copied ? "Copied" : `${label}: ${value}`}
    aria-label={`${label}: ${value}`}
    className="inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-app-muted transition-colors hover:bg-app-canvas hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
    onClick={() => { void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true); window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined); }}>
    {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    {copied ? "Copied" : label}
  </button>;
}

/** On-chain proof row for a settled transaction: truncated signature, explorer
 * link (base-layer or MagicBlock PER), and copy affordance. Never nest inside
 * another button/link. */
export function TxProof({ signature, label = "Transaction", chain = "base", status }: {
  signature: string; label?: string; chain?: "base" | "ephemeral"; status?: string | null;
}) {
  const href = chain === "ephemeral" ? magicBlockTxUrl(signature) : explorerTxUrl(signature);
  const networkLabel = chain === "ephemeral" ? "MagicBlock PER · TEE devnet" : "Solana devnet";
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-app-line bg-app-canvas px-3 py-2 text-xs">
    <span className="inline-flex items-center gap-1.5 font-medium text-app-muted">
      <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
      {label}
    </span>
    <a href={href} target="_blank" rel="noreferrer" title={`View on ${networkLabel}`}
      className="inline-flex items-center gap-1 break-all font-mono text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand">
      {shortAddress(signature)}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">(view on {networkLabel})</span>
    </a>
    <CopyValue value={signature} />
    {chain === "ephemeral" && <CopyValue value={href} label="Copy custom explorer URL" />}
    <span className="ml-auto inline-flex items-center gap-1.5 text-app-muted">
      {chain === "ephemeral" && <span className="font-medium">Custom RPC · {MAGICBLOCK_TEE_HOST}</span>}
      {status ? <span className="font-medium capitalize">{status.replaceAll("_", " ")}</span> : null}
    </span>
  </div>;
}

/** Live verification of a MagicBlock PER transaction, polled through the
 * /api/tee/signature proxy: network, slot, and finality straight from the
 * MagicBlock validator. */
export function TeeProof({ signature, label = "PER transaction", status }: {
  signature: string; label?: string; status?: string | null;
}) {
  const [proof, setProof] = useState<{
    found: boolean; slot: number | null; confirmationStatus: string | null;
    finalized: boolean; errorMessage: string | null;
  } | null>(null);
  const [lookupFailures, setLookupFailures] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/tee/signature?signature=${encodeURIComponent(signature)}`, { cache: "no-store" });
        const body = await response.json() as { success?: boolean; data?: typeof proof };
        if (cancelled) return;
        if (!response.ok || !body.success || !body.data) {
          // A lookup hiccup is not a failed transaction — keep polling.
          setLookupFailures((count) => count + 1);
          timer = window.setTimeout(poll, 4000);
          return;
        }
        setLookupFailures(0);
        setProof(body.data);
        if (!body.data.finalized && !body.data.errorMessage) timer = window.setTimeout(poll, 4000);
      } catch {
        if (!cancelled) { setLookupFailures((count) => count + 1); timer = window.setTimeout(poll, 4000); }
      }
    }
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [signature, retryNonce]);

  // "Failed" is reserved for a transaction that failed on-chain. A sustained
  // lookup problem reads "Unavailable" and offers a manual retry.
  const lookupUnavailable = lookupFailures >= 8;
  const pill = proof?.errorMessage ? "Failed"
    : lookupUnavailable ? "Unavailable"
    : proof?.finalized ? "Finalized" : proof ? "Submitted" : "Checking";
  return <div className="rounded-xl border border-app-line bg-app-canvas p-3 text-xs">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold text-foreground">MagicBlock PER proof</p>
        <p className="mt-0.5 text-[11px] text-app-muted">Live status from the private devnet validator</p>
      </div>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        pill === "Failed" ? "bg-red-100 text-red-800" :
        pill === "Unavailable" ? "bg-amber-100 text-amber-800" :
        pill === "Finalized" ? "bg-emerald-100 text-emerald-800" :
        pill === "Submitted" ? "bg-amber-100 text-amber-800" : "bg-app-line text-app-muted"}`}>
        {pill === "Checking" && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />}
        {pill === "Finalized" && <Check className="size-3" aria-hidden />}
        {(pill === "Failed" || pill === "Unavailable") && <XCircle className="size-3" aria-hidden />}
        {pill}
      </span>
    </div>
    <dl className="mt-3 space-y-1.5">
      <div className="flex justify-between gap-3"><dt className="text-app-muted">Network</dt>
        <dd className="font-mono">{MAGICBLOCK_TEE_HOST}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-app-muted">Slot</dt>
        <dd className="font-mono">{proof?.slot ?? "…"}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-app-muted">Status</dt>
        <dd className="font-mono capitalize">{proof?.errorMessage ? "Failed" : proof?.confirmationStatus ?? "…"}</dd></div>
    </dl>
    {proof?.errorMessage && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 font-mono text-[11px] text-red-800">{proof.errorMessage}</p>}
    {lookupUnavailable && <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
      <span>Could not reach the validator for live status. The transaction itself may be fine — check the explorer link below.</span>
      <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => { setProof(null); setLookupFailures(0); setRetryNonce((n) => n + 1); }}>Retry</button></div>}
    <div className="mt-3 border-t border-app-line pt-2.5"><TxProof signature={signature} label={label} chain="ephemeral" status={status} /></div>
  </div>;
}

/** Renders the strongest proof available for an onboarding receipt: a chain
 * signature (with the right explorer) once the backend has one, otherwise the
 * backend receipt ID with copy affordance. */
export function ReceiptProof({ receipt, label = "Receipt" }: { receipt: ProofReceipt; label?: string }) {
  if (receipt.signature) {
    if (receipt.chain === "ephemeral") return <TeeProof signature={receipt.signature} label={label} status={receipt.status} />;
    return <TxProof signature={receipt.signature} label={label} chain={receipt.chain ?? "base"} status={receipt.status} />;
  }
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-app-line bg-app-canvas px-3 py-2 text-xs">
    <span className="inline-flex items-center gap-1.5 font-medium text-app-muted">
      <ShieldCheck className="size-3.5 text-app-muted" aria-hidden />
      {label} · {receipt.status.replaceAll("_", " ")}
    </span>
    <span className="font-mono text-app-muted">{shortAddress(receipt.id)}</span>
    <CopyValue value={receipt.id} label="Copy ID" />
    <span className="ml-auto text-app-muted">Chain proof appears after broadcast</span>
  </div>;
}
