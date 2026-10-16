"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { Activity, ArrowDownLeft, ArrowRight, Bot, Check, ChevronRight, CircleAlert, ClipboardCheck,
  Copy, ExternalLink, FileText, Info, Landmark, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, Menu,
  RefreshCw, Settings2, ShieldCheck, UsersRound, WalletCards, X } from "lucide-react";
import { api, formatUsdc, founderNeedsPrivateSetup, roleFromGrant, shortAddress, type AccessRole, type PaymentRow } from "@/lib/mercurii-client";
import { signPrepared, watchInstalledWallets, type BrowserWallet, type PreparedTransaction,
  type WalletOption } from "@/lib/mercurii-wallet";
import { useMercurii, type MercuriiController, type Resource } from "./use-mercurii";
import { PaymentsPanel, type PaymentDraft } from "./payments-panel";
import { ReceivePanel, WithdrawPanel } from "./receive-panel";
import { PayrollPanel, PayeesPanel, TeamPanel } from "./operations-panel";
import { AgentPanel, RecordsPanel } from "./intelligence-panel";
import { CompanySetupPanel } from "./company-setup-panel";
import { CopyValue, explorerAddressUrl, explorerTxUrl, TxProof } from "./tx-proof";

export type AppView = "overview" | "setup" | "receive" | "withdraw" | "payments" | "payroll" | "payees" | "approvals" | "team" | "agents" | "records" | "settings";

const navigation: { id: AppView; label: string; icon: typeof LayoutDashboard;
  roles?: AccessRole[]; group: "Workspace" | "Money" | "Company" }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "setup", label: "Privacy", icon: LockKeyhole, group: "Workspace", roles: ["founder"] },
  { id: "receive", label: "Add funds", icon: ArrowDownLeft, group: "Money", roles: ["founder"] },
  { id: "withdraw", label: "My payouts", icon: WalletCards, group: "Money" },
  { id: "payments", label: "Payments", icon: ArrowRight, group: "Money", roles: ["founder", "finance", "manager", "requester"] },
  { id: "payroll", label: "Payroll", icon: UsersRound, group: "Money", roles: ["founder", "finance"] },
  { id: "payees", label: "Payees", icon: Landmark, group: "Money", roles: ["founder", "finance"] },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, group: "Money", roles: ["founder", "finance", "manager"] },
  { id: "team", label: "Team access", icon: ShieldCheck, group: "Company", roles: ["founder", "finance", "manager", "requester", "viewer", "agent"] },
  { id: "agents", label: "AI agents", icon: Bot, group: "Company", roles: ["founder", "finance", "manager", "requester", "agent"] },
  { id: "records", label: "Records", icon: FileText, group: "Company", roles: ["founder", "finance", "viewer"] },
  { id: "settings", label: "Settings", icon: Settings2, group: "Company" },
];

const titles: Record<AppView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Company workspace", title: "Overview", description: "The private company activity your wallet is permitted to see." },
  setup: { eyebrow: "Company controls", title: "Privacy", description: "Choose who can see company finances and set spending limits." },
  receive: { eyebrow: "Private treasury", title: "Add company funds", description: "Deposit stablecoins into the private company treasury." },
  withdraw: { eyebrow: "Personal wallet", title: "My payouts", description: "Private USDC available to your connected wallet, separate from company funds." },
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
  transaction?: PreparedTransaction; signedTransactionBase64?: string; signature?: string;
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
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep | null>(null);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletChoice, setWalletChoice] = useState<WalletOption | null>(null);
  const [walletIntent, setWalletIntent] = useState<"connect" | "register" | "prepare" | null>(null);
  // A remembered company address is only a convenience. Never use it to decide
  // a new visitor's intent: they may be creating another company or joining one.
  const [companyEntryMode, setCompanyEntryMode] = useState<"choose" | "new" | "existing">("choose");
  const restoredEntry = useRef(false);
  const attemptedSessionRestore = useRef("");
  const activeRole = app.session?.role;
  const currentSessionKey = app.session ? `${app.session.company}:${app.session.address}` : "";
  const [completedSetupSession, setCompletedSetupSession] = useState("");
  const liveSetupReady = app.policy.state === "ready" && app.snapshot.state === "ready";
  const isEntryChoice = !app.session && companyEntryMode === "choose";
  const isNewCompany = !app.session && companyEntryMode === "new";
  const founderSetupRequired = founderNeedsPrivateSetup({
    role: activeRole, sessionKey: currentSessionKey, completedSession: completedSetupSession,
    policyState: app.policy.state, snapshotState: app.snapshot.state,
  });
  const page = isEntryChoice
    ? { eyebrow: "Welcome to Mercurii", title: "Choose how to start", description: "Create your company or join one your team invited you to." }
    : isNewCompany
    ? { eyebrow: "Company setup", title: "Create your company", description: "Create your workspace, protect its financial activity, then add company funds." }
    : titles[view];
  const visibleNavigation = navigation.filter((item) => {
    if (isEntryChoice || isNewCompany) return item.id === "overview";
    if (founderSetupRequired) return item.id === "overview" || item.id === "setup";
    return !activeRole || !item.roles || item.roles.includes(activeRole);
  });
  const viewPermitted = visibleNavigation.some((item) => item.id === view);

  useEffect(() => watchInstalledWallets(setWalletOptions), []);

  // Once both private accounts have been verified for this wallet, a later
  // transient RPC read must not send the user backwards into onboarding.
  useEffect(() => {
    if (!currentSessionKey || !liveSetupReady || completedSetupSession === currentSessionKey) return;
    const frame = window.requestAnimationFrame(() => setCompletedSetupSession(currentSessionKey));
    return () => window.cancelAnimationFrame(frame);
  }, [completedSetupSession, currentSessionKey, liveSetupReady]);

  // A remembered company always resumes as an existing workspace. Never send
  // a returning owner through company creation again after a refresh.
  useEffect(() => {
    if (!app.storageReady || restoredEntry.current) return;
    restoredEntry.current = true;
    if (!app.session && app.company.trim()) {
      const frame = window.requestAnimationFrame(() => setCompanyEntryMode("existing"));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [app.company, app.session, app.storageReady]);

  // TEE credentials live in sessionStorage, so they survive refresh in this
  // tab and disappear when the tab closes. Restore only an already-connected
  // matching wallet; opening a wallet or asking for a signature stays explicit.
  useEffect(() => {
    const cached = app.restorableSession;
    if (!cached || app.session || !walletOptions.length) return;
    const option = walletOptions.find((item) => item.wallet.publicKey?.toBase58() === cached.address);
    if (!option) return;
    const key = `${cached.company}:${cached.address}`;
    if (attemptedSessionRestore.current === key) return;
    attemptedSessionRestore.current = key;
    setCompanyEntryMode("existing");
    void app.restore(option.wallet);
  }, [app, walletOptions]);

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
  function openFunding() {
    if (currentSessionKey) setCompletedSetupSession(currentSessionKey);
    navigate("receive");
  }
  function disconnect() {
    setPaymentDraft(null);
    setView("overview");
    setMobileOpen(false);
    setCompanyEntryMode("existing");
    void app.disconnect();
  }
  async function registerExistingShell(selectedWallet?: BrowserWallet) {
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      if (!app.programId) throw new Error("Backend program ID is unavailable");
      const wallet = selectedWallet ?? walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the owner wallet first");
      const founder = (await wallet.connect()).publicKey;
      const [company] = PublicKey.findProgramAddressSync([
        new TextEncoder().encode("company-policy"), new PublicKey(founder.toBase58()).toBytes(),
      ], new PublicKey(app.programId));
      const address = company.toBase58();
      await api("/v1/companies/register", { body: { company: address, founder: founder.toBase58() } });
      app.setCompany(address);
      setBootstrapStep(null);
      setRegisterMessage("Your company is ready. Opening your workspace…");
      void app.connect(wallet, address);
    } catch (cause) {
      setRegisterError(cause instanceof Error ? cause.message : "Could not open your company");
    } finally { setRegisterBusy(false); }
  }
  async function prepareNewShell(selectedWallet?: BrowserWallet) {
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      if (bootstrapStep?.signedTransactionBase64) throw new Error("Your company creation is already in progress. Refresh its progress before starting again.");
      const wallet = selectedWallet ?? walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the owner wallet first");
      const founder = (await wallet.connect()).publicKey.toBase58();
      // The Founder is the initial financial administrator. A separate Finance
      // teammate belongs in Team access after the company exists.
      const finance = founder;
      const result = await api<{ status: "sign" | "shell_exists"; company: string;
        transaction?: PreparedTransaction }>("/v1/companies/bootstrap/prepare", { body: { founder, finance } });
      app.setCompany(result.company);
      if (result.status === "shell_exists") {
        setBootstrapStep({ company: result.company, founder, finance, shellExists: true });
        setRegisterMessage("Your company already exists. Continue to set up privacy.");
      } else if (result.transaction) {
        setBootstrapStep({ company: result.company, founder, finance, transaction: result.transaction });
        setRegisterMessage("Everything is ready. Approve the company creation in your wallet.");
      }
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not prepare your company"); }
    finally { setRegisterBusy(false); }
  }
  async function submitNewShell(retry = false) {
    if (!bootstrapStep?.transaction) return;
    setRegisterBusy(true); setRegisterError(null); setRegisterMessage(null);
    try {
      const wallet = walletChoice?.wallet;
      if (!wallet) throw new Error("Choose the same owner wallet before approving");
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
      setRegisterMessage(result.status === "shell_exists" ? "Your company is ready. Set up privacy next." :
        "Company creation submitted. We’ll update this page when it is ready.");
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not create your company"); }
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
      setRegisterMessage(result.shellExists ? "Your company is ready. Set up privacy next." :
        "Still confirming on Solana. We’ll keep checking automatically.");
    } catch (cause) { setRegisterError(cause instanceof Error ? cause.message : "Could not refresh company progress"); }
    finally { setRegisterBusy(false); }
  }

  // After the shell transaction is submitted, keep checking the chain so the
  // Register button appears without a manual "Check company status" click.
  useEffect(() => {
    if (!bootstrapStep?.signature || bootstrapStep.shellExists) return;
    const timer = window.setInterval(() => { void inspectNewShell(); }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapStep?.signature, bootstrapStep?.shellExists]);

  useEffect(() => {
    // Defer the restore past the first paint so SSR and hydration match, and
    // the effect body stays free of synchronous setState.
    const frame = requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem("mercurii.view");
        if (stored && stored in titles) setView(stored as AppView);
      } catch { /* Storage unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem("mercurii.view", view); } catch { /* Storage unavailable. */ }
  }, [view]);

  // A registered shell is not yet an operational company. Keep the Founder
  // in the guided setup until both the private policy and treasury snapshot
  // are readable; money and team tools only unlock after that boundary.
  useEffect(() => {
    if (!founderSetupRequired || view === "setup") return;
    const frame = window.requestAnimationFrame(() => navigate("setup"));
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [founderSetupRequired, view]);

  return <main className="min-h-screen bg-app-canvas text-foreground">
    {walletIntent && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">
      <div className="w-full max-w-md rounded-2xl border border-app-line bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="wallet-picker-title" className="text-xl font-semibold">Choose your wallet</h2>
          <p className="mt-1 text-sm leading-6 text-app-muted">Select the wallet you use with Solana devnet.</p></div>
          <button className="grid size-9 place-items-center rounded-lg hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setWalletIntent(null)} aria-label="Close wallet picker"><X className="size-5" /></button></div>
        {walletOptions.length ? <div className="mt-5 space-y-2">{walletOptions.map((option) => <button key={option.id}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-app-line px-4 text-left transition-colors hover:border-brand/40 hover:bg-brand/[.035] focus-visible:outline-2 focus-visible:outline-brand"
          onClick={() => selectWallet(option)}>{option.icon ? <Image src={option.icon} alt="" width={34} height={34} unoptimized className="size-[34px] rounded-lg" /> :
            <span className="grid size-[34px] place-items-center rounded-lg bg-brand/10 text-brand"><WalletCards className="size-5" /></span>}
          <span className="font-semibold">{option.name}</span></button>)}</div> :
          <div className="mt-5 rounded-xl bg-app-canvas p-4"><p className="text-sm font-semibold">No compatible wallet detected</p>
            <p className="mt-1 text-sm leading-6 text-app-muted">Install or enable Phantom, Solflare, Backpack, Glow, or another compatible Solana wallet, then reopen this picker.</p></div>}
        <p className="mt-5 text-xs leading-5 text-app-muted">You approve every action in your wallet. Mercurii never receives your private key.</p>
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
              <span className="min-w-0 truncate text-sm font-semibold">{app.session ? shortAddress(app.session.company) : isNewCompany ? "New company" : isEntryChoice ? "Get started" : app.company ? shortAddress(app.company) : "Select company"}</span></div>
            <span className="mt-2 block text-xs text-app-muted">{app.session ? `${app.session.role === "founder" ? "owner" : app.session.role} access · devnet` : isNewCompany ? "Owner setup · devnet" : isEntryChoice ? "Choose your path · devnet" : "Connect to open your workspace"}</span>
          </div>
        </div>
        <nav className="mt-5 flex-1 overflow-y-auto px-3 pb-5" aria-label="Workspace navigation">
          {!app.session && <p className="mb-5 px-3 text-xs leading-5 text-app-muted">{isEntryChoice ? "Start a company or join one your team invited you to." : isNewCompany ? "Create your company first. Mercurii will guide you through the remaining steps." : "Connect your wallet to see the tools your role can use."}</p>}
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
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-app-line bg-white/95 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3"><button className="grid size-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-brand lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></button>
            <span className="text-sm font-semibold">{page.title}</span><span className="hidden text-xs text-app-muted sm:inline">/ Mercurii</span></div>
          <div className="flex items-center gap-3">{app.session ? <><span className="hidden rounded-full bg-brand/10 px-3 py-1.5 text-xs font-semibold capitalize text-brand sm:inline">{app.session.role === "founder" ? "owner" : app.session.role}</span>
            <CopyableAddress address={app.session.address} />
            <button className={secondaryButtonClass} onClick={disconnect} aria-label="Disconnect wallet"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">Disconnect</span></button></> :
            isEntryChoice ? <button className={buttonClass} onClick={() => setCompanyEntryMode("new")}><Landmark className="size-4" aria-hidden />Start a company</button> :
            isNewCompany ? <button className={secondaryButtonClass} onClick={() => setCompanyEntryMode("choose")}>Back</button> :
              <button className={buttonClass} onClick={() => setWalletIntent("connect")} disabled={app.connecting || !app.company.trim()} aria-busy={app.connecting} title={app.company.trim() ? undefined : "Enter your Mercurii Company ID first"}>
                {app.connecting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <WalletCards className="size-4" aria-hidden />}
                {app.connecting ? "Connecting" : app.company.trim() ? "Connect wallet" : "Select company"}</button>}</div>
        </header>
        <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 lg:py-9">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-app-line pb-6">
            <div><p className="text-xs font-bold uppercase tracking-[.11em] text-brand">{page.eyebrow}</p>
              <h1 className="mt-2 text-[2rem] font-semibold tracking-[-.045em] sm:text-[2.5rem]">{page.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">{page.description}</p></div>
            {app.session && <button className={secondaryButtonClass} onClick={app.refresh}><RefreshCw className="size-4" aria-hidden />Refresh</button>}
          </div>

          {app.connectionError && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{app.connectionError}</div>}
          {!app.session ? isEntryChoice ? <WelcomeStart
            rememberedCompany={app.company}
            onStartCompany={() => setCompanyEntryMode("new")}
            onJoinCompany={() => setCompanyEntryMode("existing")}
          /> : isNewCompany ? <NewCompanyStart
            backendOnline={app.backendStatus === "online"}
            busy={registerBusy}
            bootstrapStep={bootstrapStep}
            message={registerMessage}
            error={registerError}
            onPrepare={() => setWalletIntent("prepare")}
            onSign={() => void submitNewShell()}
            onInspect={() => void inspectNewShell()}
            onRetry={() => void submitNewShell(true)}
            onStartOver={() => { setBootstrapStep(null); setRegisterError(null); setRegisterMessage(null); }}
            onRegister={() => setWalletIntent("register")}
            onConnect={() => setWalletIntent("connect")}
            onUseExisting={() => { setCompanyEntryMode("existing"); setBootstrapStep(null); setRegisterError(null); setRegisterMessage(null); }}
          /> : <ExistingCompanyStart
            app={app} view={view} busy={registerBusy} message={registerMessage} error={registerError}
            onConnect={() => setWalletIntent("connect")} onRegister={() => setWalletIntent("register")}
            onCreateNew={() => { setCompanyEntryMode("new"); app.setCompany(""); setRegisterError(null); setRegisterMessage(null); }}
          /> : !viewPermitted ? <div className="mt-7"><Notice title="This view is outside your role"
            detail="Your current wallet does not have this workspace permission. Choose a section shown in the navigation."
            action={<button className={buttonClass} onClick={() => navigate("overview")}>Open overview</button>} /></div> :
            <WorkspacePanels key={`${app.session.company}:${app.session.address}`} app={app} view={view}
              visited={visitedViews.session === `${app.session.company}:${app.session.address}` ? visitedViews.views : ["overview"]}
              navigate={navigate} paymentDraft={paymentDraft} setPaymentDraft={setPaymentDraft}
              startPayment={startPayment} openFunding={openFunding} />}
        </div>
      </div>
    </div>
  </main>;
}

const devnetExplorer = (kind: "tx" | "address", value: string) =>
  kind === "tx" ? explorerTxUrl(value) : explorerAddressUrl(value);

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" title={`${address} — click to copy`}
    className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-brand sm:inline-flex"
    onClick={() => { void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true); window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined); }}>
    {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5 text-app-muted" aria-hidden />}
    {copied ? "Copied" : shortAddress(address)}
  </button>;
}

function PrivacyInfo() {
  return <span className="group relative inline-flex shrink-0">
    <button type="button"
      aria-label="Privacy setup lets you choose who can see company finances and set spending limits."
      className="grid size-10 place-items-center rounded-xl border border-app-line bg-white text-app-muted transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <Info className="size-4" aria-hidden />
    </button>
    <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white opacity-0 shadow-xl transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100">
      Choose who can see company finances and set spending limits.
    </span>
  </span>;
}

function WelcomeStart({ rememberedCompany, onStartCompany, onJoinCompany }: {
  rememberedCompany: string; onStartCompany: () => void; onJoinCompany: () => void;
}) {
  return <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,.88fr)]">
    <section className={`${cardClass} p-6 sm:p-9`}>
      <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><Landmark className="size-5" aria-hidden /></span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">What would you like to do?</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">Create a company as its owner, or join a workspace your team has invited you to.</p>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onStartCompany} className="group min-h-48 rounded-2xl border-2 border-brand bg-brand/[.035] p-5 text-left transition-colors hover:bg-brand/[.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-white"><Landmark className="size-5" aria-hidden /></span>
          <span className="mt-5 block text-base font-semibold">Start a company</span>
          <span className="mt-1 block text-sm leading-6 text-app-muted">I&apos;m the owner. Create the workspace, protect its finances, then add funds.</span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">Create my company <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
        </button>
        <button type="button" onClick={onJoinCompany} className="group min-h-48 rounded-2xl border border-app-line bg-white p-5 text-left transition-colors hover:border-brand/40 hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <span className="grid size-10 place-items-center rounded-xl bg-app-canvas text-brand"><LockKeyhole className="size-5" aria-hidden /></span>
          <span className="mt-5 block text-base font-semibold">Join a company</span>
          <span className="mt-1 block text-sm leading-6 text-app-muted">My team gave me a Mercurii Company ID.</span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">Open company <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
        </button>
      </div>

      {rememberedCompany && <button type="button" onClick={onJoinCompany} className="mt-5 inline-flex min-h-10 items-center gap-2 text-left text-sm font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        Continue with a recently used company <span className="font-mono text-xs">{shortAddress(rememberedCompany)}</span><ChevronRight className="size-4" aria-hidden />
      </button>}
    </section>
    <section className={`${cardClass} p-6 sm:p-8`}>
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Before you start</p>
      <h3 className="mt-4 text-lg font-semibold">You stay in control of your company wallet.</h3>
      <ul className="mt-5 space-y-4 text-sm leading-6 text-app-muted">
        <li className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-3" aria-hidden /></span><span>Use a Solana wallet connected to <strong className="font-semibold text-foreground">devnet</strong>.</span></li>
        <li className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-3" aria-hidden /></span><span>You review and approve every wallet signature. Mercurii never holds your private keys.</span></li>
        <li className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-3" aria-hidden /></span><span>After setup, the app takes you straight to adding company funds.</span></li>
      </ul>
      <div className="mt-7 rounded-xl border border-app-line bg-app-canvas p-4"><p className="text-sm font-semibold">New here?</p><p className="mt-1 text-xs leading-5 text-app-muted">Choose <strong className="font-semibold text-foreground">Start a company</strong>, then connect the wallet you want to use as the owner.</p></div>
    </section>
  </div>;
}

function NewCompanyStart({ backendOnline, busy, bootstrapStep, message, error,
  onPrepare, onSign, onInspect, onRetry, onStartOver, onRegister, onConnect, onUseExisting }: {
  backendOnline: boolean; busy: boolean;
  bootstrapStep: BootstrapStep | null; message: string | null; error: string | null;
  onPrepare: () => void; onSign: () => void; onInspect: () => void; onRetry: () => void;
  onStartOver: () => void;
  onRegister: () => void; onConnect: () => void; onUseExisting: () => void;
}) {
  const shellReady = Boolean(bootstrapStep?.shellExists);
  const signed = Boolean(bootstrapStep?.signedTransactionBase64);
  const pending = signed && !shellReady;
  const registered = !bootstrapStep && Boolean(message?.includes("Your company is ready"));
  return <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,.82fr)]">
    <section className={`${cardClass} p-6 sm:p-8`}>
      <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><Landmark className="size-5" aria-hidden /></span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">Create your company.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">Connect the wallet you&apos;ll use as the company owner. Mercurii will create your workspace, then guide you through privacy and funding.</p>

      <div className="mt-7 max-w-2xl rounded-xl border border-app-line bg-app-canvas p-4">
        <div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><ShieldCheck className="size-4" aria-hidden /></span>
          <div><p className="text-sm font-semibold">Your wallet becomes the company owner.</p>
            <p className="mt-1 text-xs leading-5 text-app-muted">You&apos;ll control setup and can invite teammates with their own roles later.</p></div></div>
      </div>

      {!bootstrapStep ? registered ? <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className={buttonClass} disabled={busy || !backendOnline} onClick={onConnect}>
          Set up privacy<ArrowRight className="size-4" aria-hidden /></button>
        <PrivacyInfo />
        <button className={secondaryButtonClass} disabled={busy || !backendOnline} onClick={onPrepare}>Start over</button>
      </div> : <button className={`${buttonClass} mt-6`} disabled={busy || !backendOnline} onClick={onPrepare} aria-busy={busy}>
        {busy ? "Connecting wallet…" : "Connect my wallet"}<ArrowRight className="size-4" aria-hidden />
      </button> : <div className="mt-7 rounded-2xl border border-app-line bg-app-canvas p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">
          {shellReady ? "Your company is ready" : pending ? "Creating your company…" : "Ready to create your company"}</p>
          <p className="mt-1 text-xs leading-5 text-app-muted">Owner wallet {shortAddress(bootstrapStep.founder)}</p></div>
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">Solana devnet</span></div>
        {!signed && <div className="mt-4 rounded-xl border border-app-line bg-white p-4">
          <p className="text-sm font-semibold">What you&apos;re approving</p>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-app-muted">
            <li className="flex gap-2"><Check className="mt-1 size-3 shrink-0 text-emerald-600" aria-hidden />Create a Mercurii workspace for this company.</li>
            <li className="flex gap-2"><Check className="mt-1 size-3 shrink-0 text-emerald-600" aria-hidden />Make your connected wallet the company owner.</li>
            <li className="flex gap-2"><Check className="mt-1 size-3 shrink-0 text-emerald-600" aria-hidden />Pay only the small Solana devnet account fee shown by your wallet. No stablecoins move in this step.</li>
          </ul>
        </div>}
        <div className="mt-4 flex flex-wrap gap-2">
          {!signed && bootstrapStep.transaction && <button className={buttonClass} disabled={busy} onClick={onSign} aria-busy={busy}>{busy ? "Waiting for wallet…" : "Create company"}</button>}
          {shellReady && <><button className={buttonClass} disabled={busy} onClick={onRegister} aria-busy={busy}>{busy ? "Opening your company…" : "Set up privacy"}<ArrowRight className="size-4" aria-hidden /></button><PrivacyInfo /></>}
        </div>
        {bootstrapStep.signature && <div className="mt-4"><TxProof signature={bootstrapStep.signature} label="Company creation" status={bootstrapStep.signatureStatus ?? bootstrapStep.broadcast ?? "pending"} /></div>}
        {signed && !shellReady && <details className="mt-3 text-xs text-app-muted">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">Taking longer than expected?</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={secondaryButtonClass} disabled={busy} onClick={onInspect}>Refresh progress</button>
            <button className={secondaryButtonClass} disabled={busy} onClick={onRetry}>Retry same signature</button>
            <button className={secondaryButtonClass} disabled={busy} onClick={onStartOver}>Start again</button>
          </div>
        </details>}
        <details className="mt-3 text-xs text-app-muted">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">Company information</summary>
          <div className="mt-2 rounded-xl border border-app-line bg-white p-3">
            <p className="font-semibold text-foreground">Company ID</p>
            <p className="mt-1 leading-5">Teammates use this ID to open the correct workspace. It is different from your wallet address and cannot move company funds.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="font-mono text-foreground">{shortAddress(bootstrapStep.company)}</span>
              <CopyValue value={bootstrapStep.company} />
              <a className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-brand hover:bg-app-canvas focus-visible:outline-2 focus-visible:outline-brand"
                href={devnetExplorer("address", bootstrapStep.company)} target="_blank" rel="noreferrer">View on Solana<ExternalLink className="size-3.5" aria-hidden /></a>
            </div>
          </div>
        </details>
      </div>}
      {message && !(shellReady && message.startsWith("Your company is ready")) && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}

      <div className="mt-7 border-t border-app-line pt-5 text-sm">
        <button className="min-h-10 font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand" onClick={onUseExisting}>I&apos;m joining an existing company</button>
      </div>
    </section>
    <section className={`${cardClass} p-6 sm:p-8`}>
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Your setup path</p>
      <ol className="mt-6 space-y-5" aria-label="Company setup steps">{[
        ["01", "Create your company"],
        ["02", "Privacy"],
        ["03", "Add company funds"],
        ["04", "Invite your team"],
      ].map(([number, title], index) => { const currentStep = registered || shellReady ? 1 : 0;
        const done = index < currentStep;
        return <li key={number} className="flex gap-4">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-emerald-100 text-emerald-700" : index === currentStep ? "bg-brand text-white" : "bg-app-canvas text-app-muted"}`}>
          {done ? <Check className="size-4" aria-hidden /> : number}</span>
        <div className="flex min-h-7 items-center gap-2"><p className={`text-sm font-semibold ${done ? "text-app-muted line-through decoration-emerald-300" : ""}`}>{title}</p>{index === 1 && <PrivacyInfo />}</div>
      </li>; })}</ol>
    </section>
  </div>;
}

function ExistingCompanyStart({ app, view, busy, message, error, onConnect, onRegister, onCreateNew }: {
  app: MercuriiController; view: AppView; busy: boolean; message: string | null; error: string | null;
  onConnect: () => void; onRegister: () => void; onCreateNew: () => void;
}) {
  const remembered = Boolean(app.company.trim());
  return <div className="mt-7 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
    <section className={`${cardClass} p-6 sm:p-9`}><span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><LockKeyhole className="size-5" aria-hidden /></span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">{remembered ? "Open your company." : "Join your company."}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-app-muted">{remembered
        ? "This company is already saved in this browser. Connect the wallet that has access and continue from your last unfinished step."
        : "Ask the company owner for its Mercurii Company ID. Enter it below, then connect your own wallet to open the workspace for your role."}</p>
      <div className="mt-7 max-w-xl"><label htmlFor="company-address" className="mb-2 block text-sm font-semibold">Mercurii Company ID</label>
        <input id="company-address" className={`${inputClass} font-mono`} value={app.company} onChange={(event) => app.setCompany(event.target.value)} placeholder="Paste the Company ID" autoComplete="off" spellCheck={false} />
      </div>
      <button className={`${buttonClass} mt-6`} onClick={onConnect} disabled={app.connecting || !app.company.trim()}>
        {app.connecting ? "Opening workspace…" : remembered ? "Open workspace" : "Connect my wallet"}<ArrowRight className="size-4" aria-hidden />
      </button>
      <details className="mt-7 border-t border-app-line pt-5 text-sm"><summary className="min-h-10 cursor-pointer py-2 font-semibold text-brand focus-visible:outline-2 focus-visible:outline-brand">I created this company but can&apos;t open it</summary>
        <p className="mt-2 max-w-xl leading-6 text-app-muted">Connect the original owner wallet and Mercurii will restore the company to this app.</p>
        <button className={`${secondaryButtonClass} mt-3`} disabled={busy || app.backendStatus !== "online"} onClick={onRegister}>{busy ? "Restoring company…" : "Restore my company"}</button>
      </details>
      {message && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
      <div className="mt-7 border-t border-app-line pt-5 text-sm"><button className="font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand" onClick={onCreateNew}>Create a new company instead</button></div>
    </section>
    <section className={`${cardClass} p-6 sm:p-8`}><p className="text-xs font-bold uppercase tracking-wider text-app-muted">Private access</p>
      <h3 className="mt-4 text-lg font-semibold">The wallet opens only its permitted workspace.</h3>
      <p className="mt-2 text-sm leading-6 text-app-muted">Founders and Finance can operate the company. Recipients see their own private balances. Every payment follows the company&apos;s role and approval rules.</p>
      {view !== "overview" && <p className="mt-6 rounded-xl bg-app-canvas p-4 text-sm text-app-muted">After connecting, Mercurii will return you to {titles[view].title.toLowerCase()}.</p>}
    </section>
  </div>;
}

function WorkspacePanels({ app, view, visited, navigate, paymentDraft, setPaymentDraft, startPayment, openFunding }: {
  app: MercuriiController; view: AppView; visited: AppView[]; navigate: (next: AppView) => void;
  paymentDraft: PaymentDraft | null; setPaymentDraft: (draft: PaymentDraft | null) => void;
  startPayment: (draft: PaymentDraft) => void; openFunding: () => void;
}) {
  const mounted = (id: AppView) => visited.includes(id) || view === id;
  return <div className="mt-7">
    {mounted("overview") && <div hidden={view !== "overview"}><Overview app={app} navigate={navigate} /></div>}
    {mounted("setup") && <div hidden={view !== "setup"}><CompanySetupPanel app={app} onComplete={openFunding} /></div>}
    {mounted("receive") && <div hidden={view !== "receive"}><ReceivePanel app={app} onViewCompany={() => navigate("overview")} /></div>}
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
  if (role === "founder" && app.policy.state === "error") return <Notice title="Finish your private setup"
    detail="Your company is registered, but private operations are not fully active yet. Continue the guided setup to finish turning them on."
    action={<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => navigate("setup")}>Continue setup</button>
      <button className={secondaryButtonClass} onClick={app.refresh}>Check again</button></div>} />;
  if (role === "founder" && app.policy.state === "ready" && app.snapshot.state === "error") return <Notice
    title="One setup phase left"
    detail="Your private company account is active, but the treasury balance tracker is not set up yet. Finish the last setup phase to see the treasury balance here."
    action={<button className={buttonClass} onClick={() => navigate("setup")}>Finish setup</button>} />;
  const snapshot = app.snapshot.value;
  const remaining = policy ? BigInt(policy.monthlyLimitMicro) - BigInt(policy.spentMicro) - BigInt(policy.reservedMicro) : null;
  const pending = app.payments.value?.filter((item) => item.requestStatus === "submitted") ?? [];
  if (scoped) return <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
    <section className={`${cardClass} p-6 sm:p-8`}><span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand"><WalletCards className="size-5" /></span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-app-muted">Your payout balance</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{app.recipientBalance.state === "ready" ? formatUsdc(app.recipientBalance.value?.balanceMicro) : "—"}</p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-app-muted">{app.recipientBalance.state === "error" ? "Your payout balance is unavailable or has not been initialized." :
        "This USDC belongs to your connected wallet. The company treasury and other people's payouts are separate."}</p>
      <p className="mt-5 text-xs font-semibold capitalize text-brand">{role} workspace · private network</p></section>
    <section className={`${cardClass} p-6`}><h2 className="text-base font-semibold">Your permissions</h2>
      {role === "member" ? <div className="mt-5 rounded-xl bg-app-canvas p-4"><p className="text-sm font-semibold">Recipient access</p>
        <p className="mt-2 text-sm leading-6 text-app-muted">This wallet can see and withdraw only its own private balance. It has no access to company treasury, payroll, vendors, team grants, or agent controls.</p></div> :
      <DataState resource={app.members} empty="No active grant is visible to this wallet." retry={app.refresh}>{(members) => <div className="mt-5 space-y-3">{members.flatMap((member) => member.grants)
        .filter((grant) => grant.member === app.session!.address).map((grant) => <div key={grant.address} className="rounded-xl bg-app-canvas p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold capitalize">{roleFromGrant(grant.role)}</span><span className="text-xs text-app-muted">{grant.active && !grant.revoked ? "Active" : "Revoked"}</span></div>
          {grant.perPaymentCapMicro !== "0" && <p className="mt-2 text-xs text-app-muted">Per payment cap: {formatUsdc(grant.perPaymentCapMicro)}</p>}
        </div>)}</div>}</DataState>}</section>
  </div>;
  return <div className="space-y-5">
    {role === "founder" && policy?.monthlyLimitMicro === "0" && <Notice title="Set a spending policy before sending money"
      detail="Your private workspace can receive funds now. Choose the company's payment cap when you are ready to make an outgoing payment."
      action={<button className={buttonClass} onClick={() => navigate("setup")}>Set spending policy</button>} />}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Metric icon={LockKeyhole} label="Company treasury" value={snapshot ? formatUsdc(snapshot.balanceMicro) : "—"} note={app.snapshot.state === "error" ? "Balance unavailable — try refreshing" : snapshot ? "Private funds owned by the company" : "Loading company balance"} emphasis />
      <Metric icon={Activity} label="Available 30-day budget" value={policy?.monthlyLimitMicro === "0" ? "Not set" : remaining == null ? "—" : formatUsdc(remaining.toString())} note={policy?.monthlyLimitMicro === "0" ? "Set before the first outgoing payment" : "Company cap less spent and reserved"} />
      <Metric icon={ClipboardCheck} label="Awaiting approval" value={app.payments.state === "ready" ? String(pending.length) : "—"} note="Submitted private requests" />
      <Metric icon={Bot} label="AI-agent payments" value={policy?.agentCapMicro === "0" ? "Off" : policy ? formatUsdc(policy.agentCapMicro) : "—"} note="Optional company-wide agent cap" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className={`${cardClass} overflow-hidden`}><div className="flex items-center justify-between border-b border-app-line px-5 py-4 sm:px-6"><div><h2 className="text-base font-semibold">Recent payment activity</h2><p className="mt-1 text-xs text-app-muted">Latest private requests and their settlement</p></div><button className="text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-brand" onClick={() => navigate("payments")}>View all</button></div>
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
  const metricClass = emphasis
    ? "rounded-2xl border border-brand bg-[#1246f5] p-5 text-white"
    : `${cardClass} p-5`;

  return <div className={metricClass}>
    <div className="flex items-center gap-2"><Icon className={`size-4 ${emphasis ? "text-white/75" : "text-brand"}`} aria-hidden /><span className={`text-xs font-semibold ${emphasis ? "text-white/75" : "text-app-muted"}`}>{label}</span></div>
    <p className={`mt-6 break-words text-2xl font-semibold tracking-tight sm:text-[1.75rem] ${emphasis ? "text-white" : "text-foreground"}`}>{value}</p><p className={`mt-2 text-xs ${emphasis ? "text-white/70" : "text-app-muted"}`}>{note}</p>
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
      {[["Company account", session.company], ["Wallet", session.address], ["Role", session.role], ["Network", "Solana devnet"], ["Private login", session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Active"]].map(([label, value]) => <div key={label} className="border-b border-app-line pb-3"><dt className="text-xs text-app-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}</dl></section>
    <section className={`${cardClass} p-6`}><h2 className="text-base font-semibold">Security boundary</h2><div className="mt-5 space-y-4 text-sm leading-6 text-app-muted"><p>Your private session key lives only in this tab&apos;s memory. Closing or disconnecting clears it.</p><p>Private records appear only when the MagicBlock permission layer allows this wallet to read them.</p><p>The app prepares unsigned transactions. Your wallet signs every company payment step before anything is submitted.</p><p>Payment terms and payroll rosters are not saved in browser storage.</p></div></section>
  </div>;
}
