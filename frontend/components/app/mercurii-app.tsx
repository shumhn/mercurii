"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { Activity, ArrowDownLeft, ArrowRight, Bot, ChevronRight, CircleAlert, ClipboardCheck,
  FileText, Landmark, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, Menu,
  RefreshCw, Settings2, ShieldCheck, UsersRound, WalletCards, X } from "lucide-react";
import { api, formatUsdc, roleFromGrant, shortAddress, type AccessRole, type PaymentRow } from "@/lib/mercurii-client";
import { signPrepared, watchInstalledWallets, type BrowserWallet, type PreparedTransaction,
  type WalletOption } from "@/lib/mercurii-wallet";
import { useMercurii, type MercuriiController, type Resource } from "./use-mercurii";
import { PaymentsPanel, type PaymentDraft } from "./payments-panel";
import { ReceivePanel, WithdrawPanel } from "./receive-panel";
import { PayrollPanel, PayeesPanel, TeamPanel } from "./operations-panel";
import { AgentPanel, RecordsPanel } from "./intelligence-panel";
import { CompanySetupPanel } from "./company-setup-panel";

export type AppView = "overview" | "setup" | "receive" | "withdraw" | "payments" | "payroll" | "payees" | "approvals" | "team" | "agents" | "records" | "settings";

const navigation: { id: AppView; label: string; icon: typeof LayoutDashboard;
  roles?: AccessRole[]; group: "Workspace" | "Money" | "Company" }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "setup", label: "Company setup", icon: LockKeyhole, group: "Workspace", roles: ["founder"] },
  { id: "receive", label: "Receive", icon: ArrowDownLeft, group: "Money", roles: ["founder"] },
  { id: "withdraw", label: "My private balance", icon: WalletCards, group: "Money" },
  { id: "payments", label: "Payments", icon: ArrowRight, group: "Money", roles: ["founder", "finance", "manager", "requester"] },
  { id: "payroll", label: "Payroll", icon: UsersRound, group: "Money", roles: ["founder", "finance"] },
  { id: "payees", label: "Payees", icon: Landmark, group: "Money", roles: ["founder", "finance"] },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, group: "Money", roles: ["founder", "finance", "manager"] },
  { id: "team", label: "Team access", icon: ShieldCheck, group: "Company" },
  { id: "agents", label: "AI agents", icon: Bot, group: "Company", roles: ["founder", "finance", "manager", "requester", "agent", "member"] },
  { id: "records", label: "Records", icon: FileText, group: "Company", roles: ["founder", "finance", "viewer"] },
  { id: "settings", label: "Settings", icon: Settings2, group: "Company" },
];

const titles: Record<AppView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Company workspace", title: "Overview", description: "The private company activity your wallet is permitted to see." },
  setup: { eyebrow: "Founder setup", title: "Company setup", description: "Activate private company state and policy on the selected MagicBlock validator." },
  receive: { eyebrow: "Private treasury", title: "Receive stablecoins", description: "Fund the company with a signed private USDC deposit and verify its snapshot." },
  withdraw: { eyebrow: "Your wallet", title: "My private balance", description: "See your recipient balance and withdraw with a signed receipt when enabled." },
  payments: { eyebrow: "Move money", title: "Private payments", description: "Prepare a request, collect the right approval, and follow its settlement." },
  payroll: { eyebrow: "Team payouts", title: "Payroll", description: "Preview a private roster, check readiness, and run individual signed payouts." },
  payees: { eyebrow: "Recipients", title: "Payees", description: "The company's registered employees, contractors, and vendors." },
  approvals: { eyebrow: "Review queue", title: "Approvals", description: "Requests awaiting an authorized signer." },
  team: { eyebrow: "Access control", title: "Team permissions", description: "Grant and review role scopes enforced by the private program." },
  agents: { eyebrow: "Authorized automation", title: "AI agents", description: "Inspect private agent rules, prepare work, and make bounded payments when enabled." },
  records: { eyebrow: "Operations", title: "Records & settlement", description: "Compare private request state, signed receipts, and settlement evidence." },
  settings: { eyebrow: "Configuration", title: "Workspace settings", description: "Wallet, company, and devnet connection details." },
};

export const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-app-line bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
export const inputClass = "min-h-11 w-full rounded-xl border border-app-line bg-white px-3 text-sm text-foreground placeholder:text-app-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const cardClass = "rounded-2xl border border-app-line bg-white";
type BootstrapStep = { company: string; founder: string; finance: string;
  transaction: PreparedTransaction; signedTransactionBase64?: string; signature?: string;
  broadcast?: string; shellExists?: boolean; signatureStatus?: string | null };

export function Notice({ title, detail, action, tone = "normal" }: {
  title: string; detail: string; action?: React.ReactNode; tone?: "normal" | "error";
}) {
  return <div className={`${cardClass} flex flex-col items-start gap-3 p-6 sm:p-8 ${tone === "error" ? "border-red-200 bg-red-50" : ""}`}>
    <span className={`flex size-10 items-center justify-center rounded-xl ${tone === "error" ? "bg-red-100 text-red-700" : "bg-brand/10 text-brand"}`}>
      {tone === "error" ? <CircleAlert className="size-5" aria-hidden /> : <LockKeyhole className="size-5" aria-hidden />}
    </span>
    <div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 max-w-xl text-sm leading-6 text-app-muted">{detail}</p></div>
    {action}
  </div>;
}

export function DataState<T>({ resource, empty, children, retry }: {
  resource: Resource<T>; empty: string; children: (value: T) => React.ReactNode; retry?: () => void;
}) {
  if (resource.state === "loading" && !resource.value) return <div className={`${cardClass} space-y-4 p-6`} aria-busy="true">
    {["w-36", "w-full", "w-4/5"].map((width, index) => <div key={index} className={`h-5 ${width} animate-pulse rounded bg-app-canvas`} />)}
  </div>;
  if (resource.state === "error") return <Notice title="Could not load this private view" detail={resource.error ?? "Try again."} tone="error"
    action={retry ? <button className={secondaryButtonClass} onClick={retry}>Try again</button> : undefined} />;
  if ((resource.state !== "ready" && resource.state !== "loading") || resource.value == null) return <Notice title="Private view locked" detail="Connect a wallet to unlock the records permitted for its role." />;
  if (Array.isArray(resource.value) && resource.value.length === 0) return <Notice title="Nothing here yet" detail={empty} />;
  return <>{children(resource.value)}</>;
}

export function MercuriiApp() {
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const clearPrivateDraft = useCallback(() => setPaymentDraft(null), []);
  const app = useMercurii(clearPrivateDraft);
  const [view, setView] = useState<AppView>("overview");
  const [visitedViews, setVisitedViews] = useState<{ session: string; views: AppView[] }>({ session: "", views: ["overview"] });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [bootstrapFinance, setBootstrapFinance] = useState("");
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep | null>(null);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletChoice, setWalletChoice] = useState<WalletOption | null>(null);
  const [walletIntent, setWalletIntent] = useState<"connect" | "register" | "prepare" | null>(null);
  const page = titles[view];
  const activeRole = app.session?.role;
  const visibleNavigation = navigation.filter((item) => !activeRole || !item.roles || item.roles.includes(activeRole));
  const viewPermitted = visibleNavigation.some((item) => item.id === view);

  useEffect(() => watchInstalledWallets(setWalletOptions), []);

  function selectWallet(option: WalletOption) {
    const intent = walletIntent;
    setWalletChoice(option);
    setWalletIntent(null);
    if (intent === "connect") void app.connect(option.wallet);
    if (intent === "register") void registerExistingShell(option.wallet);
    if (intent === "prepare") void prepareNewShell(option.wallet);
  }

  function navigate(next: AppView) {
    const key = app.session ? `${app.session.company}:${app.session.address}` : "";
    setVisitedViews((prior) => {
      const views: AppView[] = prior.session === key ? prior.views : ["overview"];
      return { session: key, views: views.includes(next) ? views : [...views, next] };
    });
    setView(next); setMobileOpen(false);
  }
  function startPayment(draft: PaymentDraft) { setPaymentDraft(draft); navigate("payments"); }
  function disconnect() {
    setPaymentDraft(null);
    setView("overview");
    setMobileOpen(false);
    void app.disconnect();
  }
  async function registerExistingShell(selectedWallet?: BrowserWallet) {
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      if (!app.programId) throw new Error("Backend program ID is unavailable");
      const wallet = selectedWallet ?? walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the Founder wallet first");
      const founder = (await wallet.connect()).publicKey;
      const [company] = PublicKey.findProgramAddressSync([
        new TextEncoder().encode("company-policy"), new PublicKey(founder.toBase58()).toBytes(),
      ], new PublicKey(app.programId));
      const address = company.toBase58();
      await api("/v1/companies/register", { body: { company: address, founder: founder.toBase58() } });
      app.setCompany(address);
      setBootstrapStep(null);
      setRegisterMessage("Existing on-chain shell verified and registered. Connect & unlock to sign in.");
    } catch (cause) {
      setRegisterError(cause instanceof Error ? cause.message : "Could not register company shell");
    } finally { setRegisterBusy(false); }
  }
  async function prepareNewShell(selectedWallet?: BrowserWallet) {
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      if (bootstrapStep?.signedTransactionBase64) throw new Error("Check the original signed shell transaction before preparing another.");
      const finance = new PublicKey(bootstrapFinance.trim()).toBase58();
      const wallet = selectedWallet ?? walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the Founder wallet first");
      const founder = (await wallet.connect()).publicKey.toBase58();
      const result = await api<{ status: "sign" | "shell_exists"; company: string;
        transaction?: PreparedTransaction }>("/v1/companies/bootstrap/prepare", { body: { founder, finance } });
      app.setCompany(result.company);
      if (result.status === "shell_exists") {
        setBootstrapStep(null);
        setRegisterMessage("This public shell already exists. Register it below to unlock private setup.");
      } else if (result.transaction) {
        setBootstrapStep({ company: result.company, founder, finance, transaction: result.transaction });
        setRegisterMessage("Public company shell prepared. Review the Founder and Finance wallets before signing.");
      }
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not prepare company shell"); }
    finally { setRegisterBusy(false); }
  }
  async function submitNewShell(retry = false) {
    if (!bootstrapStep) return;
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      const wallet = walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the same Founder wallet before signing");
      const signedTransactionBase64 = retry && bootstrapStep.signedTransactionBase64
        ? bootstrapStep.signedTransactionBase64
        : (await signPrepared(wallet, bootstrapStep.founder, bootstrapStep.transaction)).signedTransactionBase64;
      setBootstrapStep((prior) => prior && { ...prior, signedTransactionBase64 });
      const result = await api<{ status: string; signature: string; broadcast?: string }>(
        "/v1/companies/bootstrap/submit", { body: { founder: bootstrapStep.founder,
          finance: bootstrapStep.finance, signedTransactionBase64 } });
      setBootstrapStep((prior) => prior && { ...prior, signedTransactionBase64,
        signature: result.signature, broadcast: result.broadcast ?? result.status,
        shellExists: result.status === "shell_exists" || prior.shellExists });
      setRegisterMessage(result.status === "shell_exists" ? "Shell is on chain. Register it below." :
        `Original signed transaction ${result.broadcast ?? result.status}. Check chain status before registration.`);
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not submit company shell"); }
    finally { setRegisterBusy(false); }
  }
  async function inspectNewShell() {
    if (!bootstrapStep) return;
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      const query = new URLSearchParams({ founder: bootstrapStep.founder,
        ...(bootstrapStep.signature ? { signature: bootstrapStep.signature } : {}) });
      const result = await api<{ shellExists: boolean; signatureStatus: string | null }>(
        `/v1/companies/bootstrap/status?${query}`);
      setBootstrapStep((prior) => prior && { ...prior, ...result });
      setRegisterMessage(result.shellExists ? "Public shell confirmed on chain. Register it below." :
        `Shell not visible yet · transaction ${result.signatureStatus ?? "not submitted"}. Check again before signing a new transaction.`);
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not inspect company shell"); }
    finally { setRegisterBusy(false); }
  }

  return <main className="min-h-screen bg-app-canvas text-foreground">
    {walletIntent && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">
      <div className="w-full max-w-md rounded-2xl border border-app-line bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="wallet-picker-title" className="text-xl font-semibold">Choose a Solana wallet</h2>
          <p className="mt-1 text-sm leading-6 text-app-muted">Mercurii supports wallets registered through Solana Wallet Standard.</p></div>
          <button className="grid size-9 place-items-center rounded-lg hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setWalletIntent(null)} aria-label="Close wallet picker"><X className="size-5" /></button></div>
        {walletOptions.length ? <div className="mt-5 space-y-2">{walletOptions.map((option) => <button key={option.id}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-app-line px-4 text-left transition-colors hover:border-brand/40 hover:bg-brand/[.035] focus-visible:outline-2 focus-visible:outline-brand"
          onClick={() => selectWallet(option)}>{option.icon ? <Image src={option.icon} alt="" width={34} height={34} unoptimized className="size-[34px] rounded-lg" /> :
            <span className="grid size-[34px] place-items-center rounded-lg bg-brand/10 text-brand"><WalletCards className="size-5" /></span>}
          <span className="font-semibold">{option.name}</span><span className="ml-auto text-xs text-app-muted">{option.standard ? "Wallet Standard" : "Browser wallet"}</span></button>)}</div> :
          <div className="mt-5 rounded-xl bg-app-canvas p-4"><p className="text-sm font-semibold">No compatible wallet detected</p>
            <p className="mt-1 text-sm leading-6 text-app-muted">Install or enable Phantom, Solflare, Backpack, Glow, or another Wallet Standard compatible Solana wallet, then reopen this picker.</p></div>}
        <p className="mt-5 text-xs leading-5 text-app-muted">The selected wallet signs the login challenge and every transaction. Mercurii never receives its private key.</p>
      </div>
    </div>}
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r border-app-line bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[72px] items-center justify-between border-b border-app-line px-5">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-brand" aria-label="Mercurii home">
            <Image src="/mercurii-symbol-blue.png" alt="" width={40} height={30} className="h-[30px] w-10 object-contain" priority />Mercurii
          </Link>
          <button onClick={() => setMobileOpen(false)} className="grid size-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-brand lg:hidden" aria-label="Close navigation"><X className="size-5" /></button>
        </div>
        <div className="px-4 pt-5">
          <div className="rounded-xl border border-app-line bg-app-canvas p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Company</span>
            <div className="mt-2 flex items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Landmark className="size-4" aria-hidden /></span>
              <span className="min-w-0 truncate text-sm font-semibold">{app.session ? shortAddress(app.session.company) : app.company ? shortAddress(app.company) : "Select company"}</span></div>
            <span className="mt-2 block text-xs text-app-muted">{app.session ? `${app.session.role} access · devnet` : "Connect to unlock private data"}</span>
          </div>
        </div>
        <nav className="mt-5 flex-1 overflow-y-auto px-3 pb-5" aria-label="Workspace navigation">
          {!app.session && <p className="mb-5 px-3 text-xs leading-5 text-app-muted">Explore the workspace. Your role and private records unlock after wallet sign-in.</p>}
          {(["Workspace", "Money", "Company"] as const).map((group) => {
            const items = visibleNavigation.filter((item) => item.group === group);
            return items.length ? <div key={group} className="mt-4 first:mt-0">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-app-muted">{group}</p>
              {items.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand ${view === item.id ? "bg-brand/10 text-brand" : "text-app-muted hover:bg-app-canvas hover:text-foreground"}`}
                aria-current={view === item.id ? "page" : undefined}><Icon className="size-[18px]" aria-hidden />{item.label}{!app.session && item.id !== "overview" && <LockKeyhole className="ml-auto size-3.5 text-app-muted/70" aria-hidden />}</button>; })}
            </div> : null;
          })}
        </nav>
        <div className="border-t border-app-line p-4"><div className="flex items-center gap-2 text-xs text-app-muted"><span className={`size-2 rounded-full ${app.backendStatus === "online" ? "bg-emerald-500" : app.backendStatus === "checking" ? "bg-amber-400" : "bg-red-500"}`} />Backend {app.backendStatus} <span className="ml-auto">Solana devnet</span></div></div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-app-line bg-white/95 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3"><button className="grid size-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-brand lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
            <span className="text-sm font-semibold">{page.title}</span><span className="hidden text-xs text-app-muted sm:inline">/ Mercurii</span></div>
          <div className="flex items-center gap-3">{app.session ? <><span className="hidden rounded-full bg-brand/10 px-3 py-1.5 text-xs font-semibold capitalize text-brand sm:inline">{app.session.role}</span>
            <span className="hidden text-sm font-medium sm:inline">{shortAddress(app.session.address)}</span>
            <button className={secondaryButtonClass} onClick={disconnect} aria-label="Disconnect wallet"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">Disconnect</span></button></> :
            <button className={buttonClass} onClick={() => setWalletIntent("connect")} disabled={app.connecting} aria-busy={app.connecting}>
              {app.connecting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <WalletCards className="size-4" aria-hidden />}
              {app.connecting ? "Connecting" : "Connect wallet"}</button>}</div>
        </header>
        <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 lg:py-9">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-app-line pb-6">
            <div><p className="text-xs font-bold uppercase tracking-[.11em] text-brand">{page.eyebrow}</p>
              <h1 className="mt-2 text-[2rem] font-semibold tracking-[-.045em] sm:text-[2.5rem]">{page.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">{page.description}</p></div>
            {app.session && <button className={secondaryButtonClass} onClick={app.refresh}><RefreshCw className="size-4" aria-hidden />Refresh</button>}
          </div>

          {app.connectionError && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{app.connectionError}</div>}
          {!app.session ? <div className="mt-7 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
            <section className={`${cardClass} p-6 sm:p-9`}><span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><LockKeyhole className="size-5" aria-hidden /></span>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight">{view === "overview" ? "Your company, only to its people." : `Unlock ${page.title}`}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-app-muted">{view === "overview" ? "Connect your Solana wallet and sign a private login challenge. Mercurii reads only the company state that MagicBlock grants to your wallet." : `Sign in to access ${page.title.toLowerCase()}. Your wallet role determines which private records and actions become available.`}</p>
              <div className="mt-7 max-w-xl"><label htmlFor="company-address" className="mb-2 block text-sm font-semibold">Company policy address</label>
                <input id="company-address" className={inputClass} value={app.company} onChange={(event) => app.setCompany(event.target.value)} placeholder="Solana company PDA" autoComplete="off" spellCheck={false} />
                <p className="mt-2 text-xs leading-5 text-app-muted">The local backend fills this automatically when a default company is configured.</p></div>
              <button className={`${buttonClass} mt-6`} onClick={() => setWalletIntent("connect")} disabled={app.connecting}>{app.connecting ? "Waiting for wallet…" : "Connect & unlock"}<ArrowRight className="size-4" aria-hidden /></button>
              <details className="mt-6 border-t border-app-line pt-5 text-sm"><summary className="cursor-pointer font-semibold text-brand">Already have an on-chain company shell?</summary>
                <p className="mt-2 max-w-xl leading-6 text-app-muted">Use the Founder wallet to verify its existing Mercurii policy account and register it with this backend. This step does not create a new on-chain shell.</p>
                <button className={`${secondaryButtonClass} mt-3`} disabled={registerBusy || app.backendStatus !== "online"} onClick={() => setWalletIntent("register")}>{registerBusy ? "Verifying shell…" : "Register existing shell"}</button>
                {registerMessage && <p role="status" className="mt-3 text-emerald-700">{registerMessage}</p>}
                {registerError && <p role="alert" className="mt-3 text-red-700">{registerError}</p>}
              </details>
              <details className="mt-5 border-t border-app-line pt-5 text-sm"><summary className="cursor-pointer font-semibold text-brand">Starting a new company?</summary>
                <p className="mt-2 max-w-xl leading-6 text-app-muted">Create the public Founder and Finance shell first. Spending limits and private balances are added only after registration and MagicBlock private setup.</p>
                <label className="mt-4 block max-w-xl font-semibold">Finance wallet<input className={`${inputClass} mt-2 font-mono`} value={bootstrapFinance} disabled={Boolean(bootstrapStep?.signedTransactionBase64)} onChange={(event) => { setBootstrapFinance(event.target.value); setBootstrapStep(null); }} placeholder="Solana Finance address" /></label>
                <button className={`${secondaryButtonClass} mt-3`} disabled={registerBusy || app.backendStatus !== "online" || Boolean(bootstrapStep?.signedTransactionBase64)} onClick={() => setWalletIntent("prepare")}>Prepare public shell</button>
                {bootstrapStep && <div className="mt-4 rounded-xl border border-app-line bg-app-canvas p-4 text-xs">
                  <p className="font-semibold">Founder <span className="font-mono">{shortAddress(bootstrapStep.founder)}</span> · Finance <span className="font-mono">{shortAddress(bootstrapStep.finance)}</span></p>
                  <p className="mt-2 break-all font-mono text-app-muted">Company policy: {bootstrapStep.company}</p>
                  <p className="mt-2 text-app-muted">Network: Solana devnet · public account initialization. Your wallet pays the network fee.</p>
                  <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} disabled={registerBusy || Boolean(bootstrapStep.signedTransactionBase64)} onClick={() => void submitNewShell()}>{bootstrapStep.signedTransactionBase64 ? "Shell transaction signed" : "Review & sign shell"}</button>
                    <button className={secondaryButtonClass} disabled={registerBusy} onClick={() => void inspectNewShell()}>Check chain status</button>
                    {bootstrapStep.signedTransactionBase64 && !bootstrapStep.shellExists && <button className={secondaryButtonClass} disabled={registerBusy} onClick={() => void submitNewShell(true)}>Retry same signature</button>}
                    {bootstrapStep.shellExists && <button className={buttonClass} disabled={registerBusy} onClick={() => setWalletIntent("register")}>Register confirmed shell</button>}</div>
                  {bootstrapStep.signature && <p className="mt-3 break-all font-mono text-app-muted">Signature: {bootstrapStep.signature} · {bootstrapStep.signatureStatus ?? bootstrapStep.broadcast ?? "pending"}</p>}
                </div>}
                {registerMessage && <p role="status" className="mt-3 text-emerald-700">{registerMessage}</p>}
                {registerError && <p role="alert" className="mt-3 text-red-700">{registerError}</p>}
              </details>
            </section>
            <section className={`${cardClass} p-6 sm:p-8`}><p className="text-xs font-bold uppercase tracking-wider text-app-muted">How access works</p>
              <div className="mt-6 space-y-5">{[
                ["01", "Wallet proves who you are", "The private login challenge is signed in your wallet."],
                ["02", "PER checks your role", "A Founder can see company policy; other roles receive only their permitted records."],
                ["03", "You sign every company action", "The backend prepares steps; your wallet reviews and signs transactions."],
              ].map(([number, title, detail]) => <div key={number} className="flex gap-4"><span className="font-mono text-sm font-semibold text-brand">{number}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-app-muted">{detail}</p></div></div>)}</div>
            </section>
          </div> : !viewPermitted ? <div className="mt-7"><Notice title="This view is outside your role"
            detail="Your current wallet does not have this workspace permission. Choose a section shown in the navigation."
            action={<button className={buttonClass} onClick={() => navigate("overview")}>Open overview</button>} /></div> :
            <WorkspacePanels key={`${app.session.company}:${app.session.address}`} app={app} view={view}
              visited={visitedViews.session === `${app.session.company}:${app.session.address}` ? visitedViews.views : ["overview"]}
              navigate={navigate} paymentDraft={paymentDraft} setPaymentDraft={setPaymentDraft}
              startPayment={startPayment} />}
        </div>
      </div>
    </div>
  </main>;
}

function WorkspacePanels({ app, view, visited, navigate, paymentDraft, setPaymentDraft, startPayment }: {
  app: MercuriiController; view: AppView; visited: AppView[]; navigate: (next: AppView) => void;
  paymentDraft: PaymentDraft | null; setPaymentDraft: (draft: PaymentDraft | null) => void;
  startPayment: (draft: PaymentDraft) => void;
}) {
  const mounted = (id: AppView) => visited.includes(id) || view === id;
  return <div className="mt-7">
    {mounted("overview") && <div hidden={view !== "overview"}><Overview app={app} navigate={navigate} /></div>}
    {mounted("setup") && <div hidden={view !== "setup"}><CompanySetupPanel app={app} /></div>}
    {mounted("receive") && <div hidden={view !== "receive"}><ReceivePanel app={app} /></div>}
    {mounted("withdraw") && <div hidden={view !== "withdraw"}><WithdrawPanel app={app} /></div>}
    {mounted("payments") && <div hidden={view !== "payments"}><PaymentsPanel app={app} draft={paymentDraft} onDraftChange={setPaymentDraft} /></div>}
    {mounted("payroll") && <div hidden={view !== "payroll"}><PayrollPanel app={app} onStartPayment={startPayment} /></div>}
    {mounted("payees") && <div hidden={view !== "payees"}><PayeesPanel app={app} /></div>}
    {mounted("approvals") && <div hidden={view !== "approvals"}><Approvals app={app} navigate={navigate} onSelect={(paymentId) => {
      setPaymentDraft({ paymentId, recipient: "", amountMicro: 0 }); navigate("payments");
    }} /></div>}
    {mounted("team") && <div hidden={view !== "team"}><TeamPanel app={app} /></div>}
    {mounted("agents") && <div hidden={view !== "agents"}><AgentPanel app={app} /></div>}
    {mounted("records") && <div hidden={view !== "records"}><RecordsPanel app={app} /></div>}
    {mounted("settings") && <div hidden={view !== "settings"}><SettingsPanel app={app} /></div>}
  </div>;
}

function Overview({ app, navigate }: { app: MercuriiController; navigate: (view: AppView) => void }) {
  const role = app.session!.role;
  const scoped = role !== "founder" && role !== "finance";
  const policy = app.policy.value;
  if (role === "founder" && app.policy.state === "error") return <Notice title="Complete private company setup"
    detail="The registered Founder wallet is connected, but its private company policy is not readable yet. Inspect the next setup step or retry this private read."
    action={<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => navigate("setup")}>Open setup</button>
      <button className={secondaryButtonClass} onClick={app.refresh}>Retry private read</button></div>} />;
  const snapshot = app.snapshot.value;
  const remaining = policy ? BigInt(policy.monthlyLimitMicro) - BigInt(policy.spentMicro) - BigInt(policy.reservedMicro) : null;
  const pending = app.payments.value?.filter((item) => item.requestStatus === "submitted") ?? [];
  if (scoped) return <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
    <section className={`${cardClass} p-6 sm:p-8`}><span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand"><WalletCards className="size-5" /></span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-app-muted">Your private USDC balance</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{formatUsdc(app.recipientBalance.value?.balanceMicro)}</p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-app-muted">{app.recipientBalance.state === "error" ? "Your private recipient balance is unavailable or has not been initialized." :
        "This is your wallet's private recipient balance. The company treasury and other people's payouts remain outside your view."}</p>
      <p className="mt-5 text-xs font-semibold capitalize text-brand">{role} workspace · MagicBlock PER</p></section>
    <section className={`${cardClass} p-6`}><h2 className="text-base font-semibold">Your permissions</h2>
      <DataState resource={app.members} empty="No active grant is visible to this wallet." retry={app.refresh}>{(members) => <div className="mt-5 space-y-3">{members.flatMap((member) => member.grants)
        .filter((grant) => grant.member === app.session!.address).map((grant) => <div key={grant.address} className="rounded-xl bg-app-canvas p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold capitalize">{roleFromGrant(grant.role)}</span><span className="text-xs text-app-muted">{grant.active && !grant.revoked ? "Active" : "Revoked"}</span></div>
          {grant.perPaymentCapMicro !== "0" && <p className="mt-2 text-xs text-app-muted">Per payment cap: {formatUsdc(grant.perPaymentCapMicro)}</p>}
        </div>)}</div>}</DataState></section>
  </div>;
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Metric icon={LockKeyhole} label="Private treasury" value={snapshot ? formatUsdc(snapshot.balanceMicro) : "—"} note={app.snapshot.state === "error" ? "Snapshot unavailable" : snapshot ? `Observed at slot ${snapshot.updatedSlot}` : "Loading private snapshot"} emphasis />
      <Metric icon={Activity} label="Available policy budget" value={remaining == null ? "—" : formatUsdc(remaining.toString())} note="Period cap less spent and reserved" />
      <Metric icon={ClipboardCheck} label="Awaiting approval" value={app.payments.state === "ready" ? String(pending.length) : "—"} note="Submitted private requests" />
      <Metric icon={Bot} label="Agent policy ceiling" value={policy ? formatUsdc(policy.agentCapMicro) : "—"} note="Separate agent spending limit" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className={`${cardClass} overflow-hidden`}><div className="flex items-center justify-between border-b border-app-line px-5 py-4 sm:px-6"><div><h2 className="text-base font-semibold">Recent payment activity</h2><p className="mt-1 text-xs text-app-muted">State from private requests and the payment journal</p></div><button className="text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-brand" onClick={() => navigate("payments")}>View all</button></div>
        <div className="p-5 sm:p-6"><DataState resource={app.payments} empty="No payment jobs yet. Create a private payment to start the ledger." retry={app.refresh}>{(rows) => <div className="divide-y divide-app-line">{rows.slice(0, 5).map((row) => <PaymentItem key={row.record.paymentId} row={row} />)}</div>}</DataState></div></section>
      <section className={`${cardClass} p-5 sm:p-6`}><h2 className="text-base font-semibold">Next actions</h2><p className="mt-1 text-xs text-app-muted">Signed by the role that owns each step</p>
        <div className="mt-5 space-y-2">{[
          { label: "Create private payment", icon: ArrowRight, view: "payments" as AppView },
          { label: "Review approvals", icon: ClipboardCheck, view: "approvals" as AppView },
          { label: "Run payroll", icon: UsersRound, view: "payroll" as AppView },
          { label: "Ask the finance agent", icon: Bot, view: "agents" as AppView },
        ].map((action) => { const Icon = action.icon; return <button key={action.label} onClick={() => navigate(action.view)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-app-line px-3 text-left text-sm font-medium hover:border-brand/30 hover:bg-brand/[.03] focus-visible:outline-2 focus-visible:outline-brand"><Icon className="size-4 text-brand" aria-hidden />{action.label}<ChevronRight className="ml-auto size-4 text-app-muted" aria-hidden /></button>; })}</div>
      </section>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value, note, emphasis = false }: { icon: typeof Activity; label: string; value: string; note: string; emphasis?: boolean }) {
  return <div className={`${cardClass} p-5 ${emphasis ? "bg-brand text-white" : ""}`}>
    <div className="flex items-center gap-2"><Icon className={`size-4 ${emphasis ? "text-white/75" : "text-brand"}`} aria-hidden /><span className={`text-xs font-semibold ${emphasis ? "text-white/75" : "text-app-muted"}`}>{label}</span></div>
    <p className="mt-6 break-words text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{value}</p><p className={`mt-2 text-xs ${emphasis ? "text-white/70" : "text-app-muted"}`}>{note}</p>
  </div>;
}

export function PaymentItem({ row }: { row: PaymentRow }) {
  const state = row.record.state || row.requestStatus;
  return <div className="flex min-h-16 items-center gap-3 py-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><ArrowDownLeft className="size-4" aria-hidden /></span>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.payee?.kind ? `${row.payee.kind} payment` : "Private payment"}</p><p className="mt-0.5 truncate font-mono text-xs text-app-muted">{shortAddress(row.record.paymentId)}</p></div>
    <div className="text-right"><span className={`inline-block rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${state === "settled" ? "bg-emerald-50 text-emerald-700" : state === "failed" ? "bg-red-50 text-red-700" : "bg-brand/10 text-brand"}`}>{state.replaceAll("_", " ")}</span>
      {row.integrityWarning && <p className="mt-1 text-xs text-red-700">Check settlement</p>}</div></div>;
}

function Approvals({ app, navigate, onSelect }: { app: MercuriiController; navigate: (view: AppView) => void;
  onSelect: (paymentId: string) => void }) {
  if (app.session!.role === "manager") return <Notice title="Branch approval" detail="Open a payment by its private request ID. Manager approval requires a matching branch grant and its active Finance parent." action={<button className={buttonClass} onClick={() => navigate("payments")}>Open payment</button>} />;
  return <section className={cardClass}><div className="flex items-center justify-between border-b border-app-line p-5 sm:p-6"><div><h2 className="text-base font-semibold">Awaiting a signature</h2><p className="mt-1 text-sm text-app-muted">Only submitted requests appear here.</p></div></div>
    <div className="p-5 sm:p-6"><DataState resource={app.payments} empty="No requests are awaiting approval." retry={app.refresh}>{(rows) => {
      const pending = rows.filter((row) => row.requestStatus === "submitted");
      return pending.length ? <div className="space-y-3">{pending.map((row) => <div key={row.record.paymentId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-line p-4"><PaymentItem row={row} /><button className={secondaryButtonClass} onClick={() => onSelect(row.record.paymentId)}>Open workflow</button></div>)}</div> : <p className="text-sm text-app-muted">All caught up. No submitted requests are awaiting approval.</p>;
    }}</DataState></div>
  </section>;
}

function SettingsPanel({ app }: { app: MercuriiController }) {
  const session = app.session!;
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className={`${cardClass} p-6`}><h2 className="text-base font-semibold">Company connection</h2><dl className="mt-5 space-y-4 text-sm">
      {[["Company policy", session.company], ["Wallet", session.address], ["Role", session.role], ["Network", "Solana devnet"], ["Private login", session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Active"]].map(([label, value]) => <div key={label} className="border-b border-app-line pb-3"><dt className="text-xs text-app-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}</dl></section>
    <section className={`${cardClass} p-6`}><h2 className="text-base font-semibold">Security boundary</h2><div className="mt-5 space-y-4 text-sm leading-6 text-app-muted"><p>The TEE token stays in this tab&apos;s memory. Closing or disconnecting clears it.</p><p>Private records are returned only if MagicBlock&apos;s permission layer allows this wallet to read them.</p><p>The app prepares unsigned transactions. Your wallet signs every company payment step before submission.</p><p>Payment terms and payroll rosters are not saved in browser storage.</p></div></section>
  </div>;
}
