"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/mercurii-client";
import { signPrepared, type PreparedTransaction } from "@/lib/mercurii-wallet";
import type { MercuriiController } from "./use-mercurii";
import { buttonClass, cardClass, inputClass, secondaryButtonClass } from "./mercurii-app";
import { ReceiptProof } from "./tx-proof";

type Policy = { address: string; agent: string; allowedRecipient: string; perPaymentCapMicro: string;
  periodCapMicro: string; spentMicro: string; revoked: boolean };
type Setup = { agentPolicyAddress: string; next: { status: "build" | "wait" | "ready" | "revoked";
  operation: string | null; reason: string }; transaction?: PreparedTransaction; receiptId?: string };
type Revoke = { status: "build" | "wait" | "ready"; receiptId?: string; transaction?: PreparedTransaction };
type Signed = { id: string; bytes: string; status: string;
  signature?: string | null; chain?: "base" | "ephemeral" };
type ReceiptResponse = { receipt: { status: string; signature?: string | null;
  chain?: "base" | "ephemeral" } };

export function AgentPolicyPanel({ app }: { app: MercuriiController }) {
  const founder = app.session?.role === "founder";
  const [agent, setAgent] = useState(""); const [recipient, setRecipient] = useState("");
  const [perCap, setPerCap] = useState(""); const [periodCap, setPeriodCap] = useState("");
  const [address, setAddress] = useState("");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [revoke, setRevoke] = useState<Revoke | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [visiblePolicies, setVisiblePolicies] = useState<Policy[] | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const unresolved = Boolean(signed && !["confirmed", "failed", "expired"].includes(signed.status));
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent policy action failed"); }
    finally { setBusy(false); }
  }
  function requireAddress(value: string, label: string) {
    try { if (new PublicKey(value.trim()).toBase58() === value.trim()) return value.trim(); } catch { /* show field error */ }
    throw new Error(`Enter a valid ${label} address`);
  }
  async function inspect(input: Record<string, unknown>) {
    const result = await app.request<Setup>("/v1/onboarding/agent/next", input);
    setSetup(result); setAddress(result.agentPolicyAddress);
    if (signed?.status === "confirmed" && result.receiptId !== signed.id) setSigned(null);
    setNotice(result.next.reason);
    if (result.next.status === "ready") await loadPolicy(result.agentPolicyAddress);
  }
  async function prepare() {
    if (unresolved) throw new Error("Reconcile the original signed policy step first");
    const agentAddress = requireAddress(agent, "agent wallet");
    const recipientAddress = requireAddress(recipient, "allowed recipient");
    if (!PublicKey.isOnCurve(new PublicKey(agentAddress).toBytes())) throw new Error("Agent must use a wallet address");
    const perPaymentCapMicro = parseUsdc(perCap); const periodCapMicro = parseUsdc(periodCap);
    if (periodCapMicro < perPaymentCapMicro) throw new Error("Period cap must cover the per-payment cap");
    const input = { actor: app.session!.address, agent: agentAddress, recipient: recipientAddress,
      perPaymentCapMicro, periodCapMicro };
    setTerms(input); setSetup(null); setSigned(null); setPolicy(null); setRevoke(null);
    await inspect(input);
  }
  async function loadPolicy(target = address) {
    const value = await app.request<Policy>(`/v1/agent-policies/${encodeURIComponent(requireAddress(target, "agent policy"))}`);
    setPolicy(value); setAddress(value.address); setNotice("Private agent policy loaded for this wallet.");
  }
  async function discover() {
    const result = await app.request<{ policies: Policy[] }>("/v1/agent-policies");
    setVisiblePolicies(result.policies);
    setNotice(result.policies.length ? `${result.policies.length} private agent policies visible to this wallet.` :
      "No agent policies are visible to this wallet yet.");
  }
  async function prepareRevoke() {
    if (!policy || policy.revoked || !founder) throw new Error("Only the Founder can revoke an active agent policy");
    if (unresolved) throw new Error("Reconcile the original signed policy step first");
    const result = await app.request<Revoke>(`/v1/agent-policies/${policy.address}/revoke/next`,
      { actor: app.session!.address });
    setRevoke(result); setSigned(null);
    setNotice(result.status === "build" ? "Review and sign the agent revocation. Its float may need a separate reclaim." :
      result.status === "ready" ? "Agent policy is revoked." : "Reconcile the previous revocation receipt.");
    if (result.status === "ready") await loadPolicy(policy.address);
  }
  async function sign(transaction: PreparedTransaction, id: string) {
    if (!app.wallet || signed) throw new Error("A signed policy step already needs reconciliation");
    const result = await signPrepared(app.wallet, app.session!.address, transaction);
    const original = { id, bytes: result.signedTransactionBase64, status: "signed" };
    setSigned(original);
    const submitted = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${id}/submit`, { signedTransactionBase64: original.bytes });
    setSigned({ ...original, status: submitted.receipt.status,
      signature: submitted.receipt.signature ?? null, chain: submitted.receipt.chain });
    setNotice(`Policy receipt ${submitted.receipt.status} · ${submitted.broadcast}.`);
  }
  async function reconcile() {
    if (!signed) throw new Error("No original signed policy receipt is available");
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${signed.id}/reconcile`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Policy receipt ${result.receipt.status} · ${result.next.replaceAll("_", " ")}.`);
    if (result.receipt.status === "confirmed" && revoke) await loadPolicy(address);
  }
  async function retryOriginal() {
    if (!signed) throw new Error("No original signature is available");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${signed.id}/submit`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Same policy signature: ${result.receipt.status} · ${result.broadcast}.`);
  }

  return <section className={`${cardClass} p-5 sm:p-7`}><h2 className="text-lg font-semibold">Onchain agent spending policy</h2>
    <p className="mt-2 text-sm leading-6 text-app-muted">A separate private policy binds one agent wallet to one recipient and two hard caps. Its setup is signed step by step on Solana and MagicBlock.</p>
    {founder && <div className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold">Agent wallet<input className={`${inputClass} mt-1 font-mono`} value={agent} disabled={Boolean(terms && setup?.next.status !== "ready")} onChange={(e) => setAgent(e.target.value)} placeholder="Authorized agent signer" /></label>
      <label className="text-xs font-semibold">Allowed recipient<input className={`${inputClass} mt-1 font-mono`} value={recipient} disabled={Boolean(terms && setup?.next.status !== "ready")} onChange={(e) => setRecipient(e.target.value)} placeholder="One approved wallet" /></label>
      <label className="text-xs font-semibold">Per-payment cap (USDC)<input className={`${inputClass} mt-1`} value={perCap} disabled={Boolean(terms && setup?.next.status !== "ready")} onChange={(e) => setPerCap(e.target.value)} inputMode="decimal" /></label>
      <label className="text-xs font-semibold">Period cap (USDC)<input className={`${inputClass} mt-1`} value={periodCap} disabled={Boolean(terms && setup?.next.status !== "ready")} onChange={(e) => setPeriodCap(e.target.value)} inputMode="decimal" /></label>
    </div><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || unresolved || Boolean(terms && setup?.next.status !== "ready")} onClick={() => void action(prepare)}>Inspect next policy step</button>
      {terms && <button className={secondaryButtonClass} disabled={busy || unresolved} onClick={() => void action(() => inspect(terms))}>Check progress</button>}</div>
    {setup && <div className="rounded-xl bg-app-canvas p-4 text-sm"><p className="font-semibold capitalize">{setup.next.status.replaceAll("_", " ")} · {setup.next.operation ?? "No transaction"}</p><p className="mt-1 text-app-muted">{setup.next.reason}</p>
      <p className="mt-2 break-all font-mono text-xs text-app-muted">Policy {setup.agentPolicyAddress}</p>
      {setup.transaction && setup.receiptId && <button className={`${buttonClass} mt-3`} disabled={busy || Boolean(signed)} onClick={() => void action(() => sign(setup.transaction!, setup.receiptId!))}>{signed ? "Step signed" : "Review & sign step"}</button>}</div>}</div>}
    <div className="mt-6 border-t border-app-line pt-5"><label className="text-xs font-semibold">Private policy address<input className={`${inputClass} mt-2 font-mono`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Agent policy PDA" /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={busy || !address.trim()} onClick={() => void action(() => loadPolicy())}>Load private policy</button>
        <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(discover)}>Find my policies</button></div>
      {visiblePolicies && <div className="mt-4 divide-y divide-app-line rounded-xl border border-app-line px-3">{visiblePolicies.length === 0 ? <p className="py-3 text-xs text-app-muted">No policies visible.</p> :
        visiblePolicies.map((item) => <button key={item.address} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-xs focus-visible:outline-2 focus-visible:outline-brand" disabled={busy} onClick={() => void action(() => loadPolicy(item.address))}><span className="font-mono">{shortAddress(item.address)} · agent {shortAddress(item.agent)}</span><span className={item.revoked ? "text-app-muted" : "text-brand"}>{item.revoked ? "Revoked" : "Open"}</span></button>)}</div>}</div>
    {policy && <div className="mt-4 rounded-xl border border-app-line bg-app-canvas p-4 text-sm"><p className="font-semibold">{policy.revoked ? "Revoked" : "Active"} policy · {shortAddress(policy.address)}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div>Agent: <span className="font-mono">{shortAddress(policy.agent)}</span></div><div>Recipient: <span className="font-mono">{shortAddress(policy.allowedRecipient)}</span></div>
        <div>Per payment: {formatUsdc(policy.perPaymentCapMicro)}</div><div>Period: {formatUsdc(policy.periodCapMicro)}</div><div>Spent this period: {formatUsdc(policy.spentMicro)}</div></dl>
      {founder && !policy.revoked && <button className={`${secondaryButtonClass} mt-4 text-red-700`} disabled={busy || unresolved || Boolean(revoke)} onClick={() => void action(prepareRevoke)}>Prepare revocation</button>}</div>}
    {policy && <AgentMoneyPanel key={policy.address} app={app} policy={policy} onRefresh={() => loadPolicy(policy.address)} />}
    {revoke?.transaction && revoke.receiptId && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm"><p className="font-semibold text-red-900">Revoke agent access</p>
      <button className={`${buttonClass} mt-3`} disabled={busy || Boolean(signed)} onClick={() => void action(() => sign(revoke.transaction!, revoke.receiptId!))}>Review & sign revocation</button></div>}
    {signed && <div className="mt-4"><ReceiptProof receipt={signed} label="Policy step" /><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>
      {signed.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</div></div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-brand/5 p-4 text-sm text-brand">{notice}</p>}
  </section>;
}

type MoneyStep = { status: "build" | "wait" | "ready"; receiptId?: string;
  transaction?: PreparedTransaction; recipient?: string | null };

function AgentMoneyPanel({ app, policy, onRefresh }: { app: MercuriiController; policy: Policy; onRefresh: () => Promise<void> }) {
  const founder = app.session?.role === "founder";
  const agent = app.session?.address === policy.agent;
  const [kind, setKind] = useState<"fund" | "pay" | "reclaim">(founder ? policy.revoked ? "reclaim" : "fund" : "pay");
  const [amount, setAmount] = useState("");
  const [actionId, setActionId] = useState("");
  const [step, setStep] = useState<MoneyStep | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const unresolved = Boolean(signed && !["confirmed", "failed", "expired"].includes(signed.status));
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent transfer failed"); }
    finally { setBusy(false); }
  }
  async function next(input: { actor: string; amountMicro: number; actionId: string }, mode: typeof kind) {
    const result = await app.request<MoneyStep>(`/v1/agent-policies/${policy.address}/${mode}/next`, input);
    setStep(result);
    setNotice(result.status === "ready" ? "Onchain agent transfer confirmed." : result.status === "wait" ?
      "A transfer receipt is in progress. Reconcile its original signature." :
      `Review ${mode} of ${formatUsdc(input.amountMicro)} for ${mode === "pay" ? shortAddress(result.recipient) : shortAddress(policy.agent)}.`);
    if (result.status === "ready") await onRefresh();
  }
  async function prepare() {
    if (!app.capabilities.paymentExecution) throw new Error("Onchain token transfers are disabled on this backend");
    if (unresolved) throw new Error("Reconcile the original signed agent transfer first");
    if (kind === "pay" && !agent || kind !== "pay" && !founder) throw new Error("This wallet cannot sign that agent action");
    if (policy.revoked && kind !== "reclaim") throw new Error("Agent policy is revoked");
    const id = crypto.randomUUID();
    const input = { actor: app.session!.address, amountMicro: parseUsdc(amount), actionId: id };
    setActionId(id); setStep(null); setSigned(null);
    await next(input, kind);
  }
  async function sign() {
    if (!step?.transaction || !step.receiptId || !app.wallet || signed) throw new Error("No unsigned agent transfer is ready");
    const result = await signPrepared(app.wallet, app.session!.address, step.transaction);
    const original = { id: step.receiptId, bytes: result.signedTransactionBase64, status: "signed" };
    setSigned(original);
    const submitted = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${original.id}/submit`, { signedTransactionBase64: original.bytes });
    setSigned({ ...original, status: submitted.receipt.status,
      signature: submitted.receipt.signature ?? null, chain: submitted.receipt.chain });
    setNotice(`Agent transfer ${submitted.receipt.status} · ${submitted.broadcast}.`);
  }
  async function reconcile() {
    if (!signed) throw new Error("Original agent transfer signature is unavailable");
    const result = await app.request<ReceiptResponse & { next: string }>(
      `/v1/onboarding/receipts/${signed.id}/reconcile`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Agent transfer ${result.receipt.status} · ${result.next.replaceAll("_", " ")}.`);
    if (result.receipt.status === "confirmed") await onRefresh();
  }
  async function retryOriginal() {
    if (!signed) throw new Error("No original signature is available");
    const result = await app.request<ReceiptResponse & { broadcast: string }>(
      `/v1/onboarding/receipts/${signed.id}/submit`, { signedTransactionBase64: signed.bytes });
    setSigned({ ...signed, status: result.receipt.status,
      signature: result.receipt.signature ?? signed.signature, chain: result.receipt.chain ?? signed.chain });
    setNotice(`Same agent signature: ${result.receipt.status} · ${result.broadcast}.`);
  }
  if ((!founder && !agent) || (policy.revoked && !founder)) return null;
  return <div className="mt-5 rounded-xl border border-app-line p-4 text-sm"><h3 className="font-semibold">Agent float & payments</h3>
    <p className="mt-1 text-app-muted">Founder funds or reclaims the separate balance. The configured agent wallet can pay only the allowed recipient, within onchain caps.</p>
    {!app.capabilities.paymentExecution ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900">Agent token transfers are disabled until the backend verifies the Circle devnet USDC token CPI flow.</p> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Action<select className={`${inputClass} mt-1`} value={kind} disabled={unresolved || Boolean(step && step.status !== "ready" && signed?.status !== "failed" && signed?.status !== "confirmed")} onChange={(e) => { setKind(e.target.value as typeof kind); setStep(null); setSigned(null); setActionId(""); }}>
        {founder && !policy.revoked && <option value="fund">Fund agent float</option>}{agent && !policy.revoked && <option value="pay">Pay allowed recipient</option>}{founder && <option value="reclaim">Reclaim float</option>}</select></label>
        <label className="text-xs font-semibold">Amount (USDC)<input className={`${inputClass} mt-1`} value={amount} disabled={unresolved || Boolean(step && step.status !== "ready" && signed?.status !== "failed" && signed?.status !== "confirmed")} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label></div>
      <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || unresolved || Boolean(step && step.status !== "ready" && signed?.status !== "failed" && signed?.status !== "confirmed")} onClick={() => void action(prepare)}>Prepare {kind}</button>
        {step?.transaction && step.receiptId && <button className={secondaryButtonClass} disabled={busy || Boolean(signed)} onClick={() => void action(sign)}>Review & sign</button>}
        {signed && <><button className={secondaryButtonClass} disabled={busy} onClick={() => void action(reconcile)}>Check status</button>
          {signed.status !== "confirmed" && <button className={secondaryButtonClass} disabled={busy} onClick={() => void action(retryOriginal)}>Retry same signature</button>}</>}</div>
      {signed && <div className="mt-3 max-w-xl"><ReceiptProof receipt={signed} label="Agent transfer" /></div>}
      {actionId && <p className="mt-2 font-mono text-xs text-app-muted">Action {shortAddress(actionId)} · {step?.status ?? "preparing"} {signed ? `· receipt ${signed.status}` : ""}</p>}
    </>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-brand">{notice}</p>}
  </div>;
}
