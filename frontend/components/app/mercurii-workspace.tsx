"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  FileClock,
  FileText,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

type WorkspaceView =
  | "overview"
  | "payments"
  | "payroll"
  | "payees"
  | "approvals"
  | "team"
  | "agents"
  | "records"
  | "settings";

type NavItem = {
  id: WorkspaceView;
  label: string;
  icon: typeof LayoutDashboard;
};

const primaryNavigation: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "payments", label: "Payments", icon: ArrowRight },
  { id: "payroll", label: "Payroll", icon: UsersRound },
  { id: "payees", label: "Payees", icon: Landmark },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck },
  { id: "team", label: "Team", icon: UsersRound },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "records", label: "Records", icon: ReceiptText },
];

const screens: Record<WorkspaceView, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "Private operations",
    title: "Your company, in private.",
    description: "Connect a wallet to load the company data your role is allowed to see.",
  },
  payments: {
    eyebrow: "Money · Payments",
    title: "Private payment workflow",
    description: "Prepare, approve, sign, settle, and reconcile company payments without exposing operating details.",
  },
  payroll: {
    eyebrow: "Money · Payroll",
    title: "Run payroll with the right approvals.",
    description: "Build a scheduled private payout run, check readiness, then approve and settle each payment through the guided flow.",
  },
  payees: {
    eyebrow: "Money · Payees",
    title: "A private payee directory.",
    description: "Register the people and businesses the company is allowed to pay. Payee matching happens before a payment request is prepared.",
  },
  approvals: {
    eyebrow: "Approval inbox",
    title: "Review what needs a signature.",
    description: "A request moves only after the required company role approves it. The app builds the unsigned transaction; the authorized wallet signs it.",
  },
  team: {
    eyebrow: "Company access",
    title: "Give every role a precise scope.",
    description: "Founder, Finance, Manager, Requester, Viewer, and Agent grants determine what each wallet can read, prepare, approve, or spend.",
  },
  agents: {
    eyebrow: "AI company agents",
    title: "Let AI understand, prepare, and pay within policy.",
    description: "An agent can answer from authorized records, prepare company payments for the required signer, and pay a Founder-approved x402 tool or API from a separate capped budget.",
  },
  records: {
    eyebrow: "Records",
    title: "Know what settled and what still needs attention.",
    description: "Track payment jobs, signed receipts, reconciliation status, and selective audit access without opening the live treasury to an auditor.",
  },
  settings: {
    eyebrow: "Workspace settings",
    title: "Company controls live here.",
    description: "Configure company context, treasury policy, wallet sessions, and the developer connection that powers this devnet workspace.",
  },
};

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex size-10 shrink-0 items-center justify-center ${className}`}>
      <Image
        src="/mercurii-symbol-blue.png"
        alt="Mercurii"
        fill
        sizes="40px"
        className="object-contain"
        priority
      />
    </span>
  );
}

function StatusPill({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "gray" }) {
  const tones = {
    blue: "bg-[#0b44fe]/10 text-[#0b44fe]",
    green: "bg-emerald-500/10 text-emerald-700",
    gray: "bg-slate-900/[0.06] text-slate-600",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${tones[tone]}`}>{children}</span>;
}

function EmptyState({ icon: Icon, title, description, action }: {
  icon: typeof WalletCards;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-[#0b44fe]/10 text-[#0b44fe]"><Icon className="size-5" /></span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-[#141a24]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

function ActionButton({ children, onClick, variant = "primary", icon: Icon }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  icon?: typeof Plus;
}) {
  const styles = variant === "primary"
    ? "bg-[#0b44fe] text-white shadow-sm hover:bg-[#0038df]"
    : "border border-slate-200 bg-white text-[#141a24] hover:bg-slate-50";
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${styles}`}>
      {Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

function Overview({ setView }: { setView: (view: WorkspaceView) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <section className="relative overflow-hidden rounded-3xl bg-[#0b44fe] p-6 text-white sm:p-8">
          <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.55) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2"><LockKeyhole className="size-4" /><span className="text-xs font-bold uppercase tracking-[0.1em]">Private treasury</span></div>
              <StatusPill tone="green">Policy active</StatusPill>
            </div>
            <div className="mt-10 flex items-end justify-between gap-6">
              <div>
                <p className="text-sm text-white/70">Treasury balance</p>
                <p className="mt-2 text-4xl font-semibold tracking-[-0.05em]">•••,••• USDC</p>
                <p className="mt-3 text-sm leading-6 text-white/75">Amounts and operating data appear only after a wallet is authenticated and its private access is verified.</p>
              </div>
              <span className="hidden size-16 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 sm:flex"><CircleDollarSign className="size-7" /></span>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold text-[#141a24]">Workspace status</p><StatusPill tone="gray">Devnet</StatusPill></div>
          <div className="mt-6 space-y-4">
            {[
              ["Wallet session", "Connect to unlock your company view", "Not connected"],
              ["Private records", "Role-scoped data from MagicBlock PER", "Locked"],
              ["Treasury actions", "Unsigned transaction, then wallet signature", "Ready"],
            ].map(([label, detail, status]) => (
              <div key={label} className="flex items-start gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0b44fe]/10 text-[#0b44fe]"><Check className="size-3 stroke-[3]" /></span>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[#141a24]">{label}</p><span className="text-[11px] text-slate-400">{status}</span></div><p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#141a24]">Run the next operation</p><p className="mt-1 text-sm text-slate-500">Each path preserves separation between private state, company policy, and wallet signatures.</p></div><StatusPill tone="gray">Preview workspace</StatusPill></div>
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Create payment", "Build a private payment request for the right signer.", ArrowRight, "payments"],
            ["Review approvals", "See requests that need a permitted company role.", ClipboardCheck, "approvals"],
            ["Run payroll", "Prepare a grouped private payout run.", UsersRound, "payroll"],
            ["Ask your agent", "Check authorized records or prepare a request.", Bot, "agents"],
          ].map(([title, detail, Icon, view]) => {
            const ActionIcon = Icon as typeof Bot;
            return <button key={title as string} onClick={() => setView(view as WorkspaceView)} className="group rounded-2xl border border-slate-200 bg-[#fafafa] p-5 text-left transition hover:border-[#0b44fe]/35 hover:bg-[#0b44fe]/[0.025]">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[#0b44fe]/10 text-[#0b44fe]"><ActionIcon className="size-4" /></span>
              <div className="mt-5 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#141a24]">{title as string}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{detail as string}</p></div><ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#0b44fe]" /></div>
            </button>
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-[#141a24]">Private operating flow</p><p className="mt-1 text-sm text-slate-500">The route behind every payment, from request to reconciliation.</p></div><ReceiptText className="size-5 text-slate-400" /></div>
        <div className="mt-7 grid gap-3 md:grid-cols-4">
          {[
            ["01", "Prepare", "A permitted role or agent creates a request."],
            ["02", "Approve", "Required company roles review policy and terms."],
            ["03", "Sign & settle", "The authorized wallet signs the private flow."],
            ["04", "Reconcile", "The receipt and settlement state are checked."],
          ].map(([number, title, detail], index) => (
            <div key={title} className="relative min-h-32 rounded-2xl border border-slate-200 p-4">
              {index < 3 ? <span className="absolute right-[-18px] top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 md:flex"><ArrowRight className="size-4" /></span> : null}
              <span className="font-mono text-xs font-bold text-[#0b44fe]">{number}</span><p className="mt-4 text-sm font-semibold text-[#141a24]">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Payments({ setView }: { setView: (view: WorkspaceView) => void }) {
  return <div className="space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_.9fr]"><div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><StatusPill>Private payment</StatusPill><h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#141a24]">Start with a payment request.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Mercurii creates a guided flow so the right wallet performs each required step. Private data is activated before the amount and recipient are submitted.</p><div className="mt-7"><ActionButton onClick={() => setView("payees")} icon={Plus}>Select a registered payee</ActionButton></div></div><div className="rounded-3xl bg-[#141a24] p-6 text-white sm:p-8"><p className="text-xs font-bold uppercase tracking-[.1em] text-white/55">What a signer sees</p><div className="mt-7 space-y-4">{["Requested action and required signer", "Recipient and amount only with private access", "An unsigned transaction to review before signing"].map((item) => <div key={item} className="flex gap-3 text-sm leading-6 text-white/85"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10"><Check className="size-3" /></span>{item}</div>)}</div></div></section>
    <EmptyState icon={FileClock} title="No private payment requests loaded" description="Connect a wallet and select a company to retrieve the payment jobs your role may read. This preview never creates or signs a transaction." action={<ActionButton onClick={() => setView("team")} variant="secondary" icon={UsersRound}>Review company access</ActionButton>} />
  </div>;
}

function Payroll() {
  return <div className="space-y-6"><section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]"><div><StatusPill>Private payroll</StatusPill><h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#141a24]">Payroll is a controlled payout run.</h2><p className="mt-3 text-sm leading-6 text-slate-500">Schedules and private roster data stay within authorized access. Before launch, Mercury checks recipient readiness, budget, and a treasury snapshot.</p></div><ol className="space-y-4">{[["1", "Draft schedule", "Define the approved schedule and payout roster."],["2", "Check readiness", "Confirm recipients, policy budget, and treasury snapshot."],["3", "Approve & pay", "Required signers approve then complete each guided payout."]].map(([number,title,detail]) => <li key={number} className="flex gap-4 rounded-2xl bg-slate-950/[.035] p-4"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0b44fe] text-xs font-bold text-white">{number}</span><div><p className="text-sm font-semibold text-[#141a24]">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div></li>)}</ol></div></section><EmptyState icon={UsersRound} title="No payroll schedules loaded" description="Authenticated Founder access is required to read or create schedules and launch a private payroll run." /></div>;
}

function Payees() {
  return <div className="space-y-6"><section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><StatusPill>Founder managed</StatusPill><h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#141a24]">Pay only registered recipients.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Payees are company-scoped. The private payment flow can match a selected payee before it constructs a request.</p></div><ActionButton icon={Plus}>Add payee after login</ActionButton></div><div className="mt-8 grid gap-3 sm:grid-cols-3">{[["Register", "Founder confirms the recipient."],["Match", "A payment references the approved payee."],["Deactivate", "Stop new payments without losing the record."]].map(([title,detail]) => <div key={title} className="rounded-2xl bg-[#0b44fe]/[.045] p-4"><p className="text-sm font-semibold text-[#141a24]">{title}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div></section><EmptyState icon={Landmark} title="Payees are private company records" description="This workspace will show only the recipient directory allowed by the authenticated company policy." /></div>;
}

function Approvals({ setView }: { setView: (view: WorkspaceView) => void }) {
  return <div className="space-y-6"><section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center"><div><StatusPill>Signature required</StatusPill><h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#141a24]">Every company payment has a clear owner.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Approvals are not a backend signature. Mercurii builds the transaction for the permitted role, then the wallet holder reviews and signs it.</p></div><ActionButton onClick={() => setView("team")} variant="secondary" icon={ShieldCheck}>View role policy</ActionButton></div><div className="mt-8 grid gap-3 md:grid-cols-3">{[["Founder", "Full company policy and final oversight"],["Finance", "Capped scope, approved recipients"],["Manager", "Requests limited to their branch"]].map(([role,detail]) => <div key={role} className="rounded-2xl border border-slate-200 p-4"><p className="text-sm font-semibold text-[#141a24]">{role}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div></section><EmptyState icon={ClipboardCheck} title="Nothing is waiting for your signature" description="When a permitted wallet connects, the inbox will show only private payment requests that role can review." /></div>;
}

function Team() {
  const roles = [["Founder", "Sets policy, full company view", "Full control"],["Finance", "Works within caps and approved recipients", "Capped access"],["Manager", "Prepares or approves a branch request", "Branch scope"],["Requester", "Creates a payment request", "Request only"],["Viewer", "Reads permitted records", "Read only"],["Agent", "Uses policy-bound access and a separate budget", "No treasury key"]];
  return <div className="space-y-6"><section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-5"><div><StatusPill>On-chain policy</StatusPill><h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#141a24]">Access is a company policy, not a shared wallet.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Grants are created for specific wallets and scopes. Removing a grant begins the privacy-reader cleanup flow for records that wallet should no longer access.</p></div><UsersRound className="mt-1 hidden size-6 text-[#0b44fe] sm:block" /></div><div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roles.map(([role,detail,scope]) => <div key={role} className="rounded-2xl border border-slate-200 bg-[#fafafa] p-4"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-[#141a24]">{role}</p><StatusPill tone={role === "Founder" ? "blue" : "gray"}>{scope}</StatusPill></div><p className="mt-3 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div></section><EmptyState icon={UsersRound} title="No team grants loaded" description="The Team view will resolve active grants from the connected company and show their exact role, branch, and spending scope." /></div>;
}

function Agents() {
  return <div className="space-y-6"><section className="grid gap-4 lg:grid-cols-[.85fr_1.15fr]"><div className="rounded-3xl bg-[#0b44fe] p-6 text-white sm:p-8"><div className="flex size-11 items-center justify-center rounded-2xl bg-white/15"><Bot className="size-5" /></div><h2 className="mt-7 text-2xl font-semibold tracking-tight">A financial agent that can act within policy.</h2><p className="mt-3 text-sm leading-6 text-white/80">It understands the company from its authorized data, prepares private treasury payments for review, and can complete Founder-approved x402 tool and API payments from its separate agent budget.</p><div className="mt-7 text-sm font-semibold">Three payment modes</div><ul className="mt-4 space-y-3 text-sm text-white/85">{["Answer questions from its role-scoped company records", "Build company payment steps for the required human signer", "Pay an allowlisted x402 service within hard caps"].map((item) => <li className="flex gap-2" key={item}><Check className="mt-0.5 size-4 shrink-0" />{item}</li>)}</ul></div><div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[#0b44fe]/10 text-[#0b44fe]"><Bot className="size-5" /></span><div><p className="text-sm font-semibold text-[#141a24]">Mercurii Finance Agent</p><p className="mt-0.5 text-xs text-slate-500">Private, role-aware company operator</p></div></div><StatusPill tone="gray">Awaiting login</StatusPill></div><div className="mt-7 grid gap-3 sm:grid-cols-3">{[["1", "Assign", "Founder selects an allowlisted x402 service."],["2", "Inspect", "Agent checks the live 402 offer and exact price."],["3", "Pay", "Isolated wallet pays within its hard caps."]].map(([number,title,detail]) => <div key={number} className="rounded-2xl bg-[#0b44fe]/[.05] p-4"><span className="font-mono text-xs font-bold text-[#0b44fe]">{number}</span><p className="mt-3 text-sm font-semibold text-[#141a24]">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div><div className="mt-4 rounded-2xl bg-slate-950/[.035] p-5"><p className="text-sm font-medium text-[#141a24]">What can I help with?</p><p className="mt-2 text-sm leading-6 text-slate-500">Connect an authorized wallet to ask about company records, prepare a treasury payment, or inspect the agent&apos;s x402 spending policy.</p><div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="text-sm text-slate-400">Ask a company question…</span><span className="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><ArrowRight className="size-4" /></span></div></div></div></section></div>;
}

function Records() {
  return <div className="space-y-6"><section className="grid gap-3 md:grid-cols-3">{[["Payment activity", "Reconciled payment jobs and settlement observations", FileCheck2],["Reconciliation", "Private state checked against signatures and receipt status", RefreshCw],["Audit exports", "Founder-created, revocable, frozen views for auditors", FileText]].map(([title,detail,Icon]) => {
    const RecordIcon = Icon as typeof FileText;
    return <div key={title as string} className="rounded-3xl border border-slate-200 bg-white p-6"><span className="flex size-10 items-center justify-center rounded-xl bg-[#0b44fe]/10 text-[#0b44fe]"><RecordIcon className="size-5" /></span><p className="mt-5 text-sm font-semibold text-[#141a24]">{title as string}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail as string}</p></div>;
  })}</section><EmptyState icon={ReceiptText} title="No operational records loaded" description="After authentication, Mercurii can retrieve the private operational records allowed by your role and identify anything needing reconciliation." /></div>;
}

function SettingsView() {
  return <div className="space-y-6"><section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[#0b44fe]/10 text-[#0b44fe]"><SlidersHorizontal className="size-5" /></span><div><p className="text-sm font-semibold text-[#141a24]">Workspace connection</p><p className="mt-0.5 text-xs text-slate-500">A company context and authenticated wallet are required before private state is requested.</p></div></div><div className="mt-8 grid gap-3 md:grid-cols-2">{[["Company", "Not selected", "The backend resolves company context per request."],["Wallet", "Not connected", "A signed TEE login binds private read access to this wallet."],["Network", "Solana devnet", "Private operational state uses MagicBlock."],["Backend", "Not connected", "Connect the workspace to load real company data."]].map(([label,value,detail]) => <div key={label} className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-bold uppercase tracking-[.08em] text-slate-400">{label}</p><p className="mt-3 text-sm font-semibold text-[#141a24]">{value}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div></section><EmptyState icon={Settings} title="Connect this workspace when the wallet layer is ready" description="The frontend shell is structured around the backend’s company selector, TEE login, private reads, and guided signing routes." /></div>;
}

function WorkspaceContent({ view, setView }: { view: WorkspaceView; setView: (view: WorkspaceView) => void }) {
  switch (view) {
    case "overview": return <Overview setView={setView} />;
    case "payments": return <Payments setView={setView} />;
    case "payroll": return <Payroll />;
    case "payees": return <Payees />;
    case "approvals": return <Approvals setView={setView} />;
    case "team": return <Team />;
    case "agents": return <Agents />;
    case "records": return <Records />;
    case "settings": return <SettingsView />;
  }
}

export function MercuriiWorkspace() {
  const [view, setView] = useState<WorkspaceView>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const screen = screens[view];

  const selectView = (next: WorkspaceView) => {
    setView(next);
    setSidebarOpen(false);
  };

  return (
    <main className="min-h-screen bg-[#f5f5f4] text-[#141a24]">
      <div className="flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${compact ? "lg:w-[92px]" : "lg:w-[286px]"}`}>
          <div className={`flex h-20 items-center border-b border-slate-200 px-5 ${compact ? "lg:justify-center" : "justify-between"}`}>
            <Link href="/" className={`flex items-center gap-2.5 ${compact ? "lg:gap-0" : ""}`} aria-label="Back to Mercurii landing page"><BrandMark /><span className={`text-lg font-semibold tracking-tight ${compact ? "lg:hidden" : ""}`}>Mercurii</span></Link>
            <button className={`rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#141a24] ${compact ? "lg:hidden" : ""}`} onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X className="size-5" /></button>
          </div>
          <div className={`px-4 pt-5 ${compact ? "lg:px-3" : ""}`}><button className={`flex w-full items-center rounded-xl border border-slate-200 bg-[#fafafa] p-3 text-left hover:bg-slate-50 ${compact ? "lg:justify-center lg:p-2.5" : "gap-3"}`}><span className="flex size-8 items-center justify-center rounded-lg bg-[#0b44fe]/10 text-[#0b44fe]"><Landmark className="size-4" /></span><span className={`min-w-0 flex-1 ${compact ? "lg:hidden" : ""}`}><span className="block truncate text-sm font-semibold">Select company</span><span className="mt-0.5 block text-xs text-slate-500">Connect a wallet first</span></span><ChevronDown className={`size-4 text-slate-400 ${compact ? "lg:hidden" : ""}`} /></button></div>
          <nav className={`mt-6 flex-1 space-y-1 overflow-y-auto px-4 ${compact ? "lg:px-3" : ""}`} aria-label="Workspace navigation">
            {primaryNavigation.slice(0, 1).map((item) => <NavButton key={item.id} item={item} active={view === item.id} compact={compact} onClick={() => selectView(item.id)} />)}
            <p className={`px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.11em] text-slate-400 ${compact ? "lg:hidden" : ""}`}>Money</p>
            {primaryNavigation.slice(1, 4).map((item) => <NavButton key={item.id} item={item} active={view === item.id} compact={compact} onClick={() => selectView(item.id)} />)}
            <p className={`px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.11em] text-slate-400 ${compact ? "lg:hidden" : ""}`}>Company</p>
            {primaryNavigation.slice(4).map((item) => <NavButton key={item.id} item={item} active={view === item.id} compact={compact} onClick={() => selectView(item.id)} />)}
          </nav>
          <div className={`border-t border-slate-200 p-4 ${compact ? "lg:px-3" : ""}`}><NavButton item={{ id: "settings", label: "Settings", icon: Settings }} active={view === "settings"} compact={compact} onClick={() => selectView("settings")} /><button className={`mt-3 flex w-full items-center gap-2 rounded-xl bg-[#0b44fe]/[.06] px-3 py-2.5 text-left text-xs font-semibold text-[#0b44fe] ${compact ? "lg:justify-center lg:px-2" : ""}`}><span className={`size-2 rounded-full bg-emerald-500 ${compact ? "lg:hidden" : ""}`} /><span className={compact ? "lg:hidden" : ""}>Solana devnet</span></button></div>
        </aside>
        {sidebarOpen ? <button onClick={() => setSidebarOpen(false)} aria-label="Close navigation overlay" className="fixed inset-0 z-30 bg-slate-950/25 lg:hidden" /> : null}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-[#f5f5f4]/90 px-5 backdrop-blur sm:px-8"><div className="flex items-center gap-3"><button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-white lg:hidden" aria-label="Open navigation"><Menu className="size-5" /></button><button onClick={() => setCompact(!compact)} className="hidden rounded-lg p-2 text-slate-500 hover:bg-white lg:inline-flex" aria-label="Toggle compact navigation">{compact ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}</button><div><p className="text-sm font-semibold text-[#141a24]">{screen.eyebrow}</p><p className="mt-0.5 hidden text-xs text-slate-500 sm:block">Mercurii devnet workspace</p></div></div><div className="flex items-center gap-2"><button className="hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-50 sm:inline-flex" aria-label="Search workspace"><Search className="size-4" /></button><button className="hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-50 sm:inline-flex" aria-label="More workspace options"><MoreHorizontal className="size-4" /></button><ActionButton icon={WalletCards}>Connect wallet</ActionButton></div></header>
          <div className="mx-auto max-w-[1540px] px-5 py-8 sm:px-8 sm:py-10"><div className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-end"><div className="max-w-3xl"><p className="mercury-section-kicker text-[#0b44fe]">{screen.eyebrow}</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-[#141a24] sm:text-4xl">{screen.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">{screen.description}</p></div>{view === "payments" ? <ActionButton icon={Plus}>New payment</ActionButton> : null}</div><div className="mt-7 rounded-2xl border border-[#0b44fe]/15 bg-[#0b44fe]/[.045] px-4 py-3 text-sm leading-6 text-slate-600"><span className="mr-2 font-semibold text-[#0b44fe]">Workspace preview.</span>Connect a company wallet to load role-scoped private records. This screen does not create, approve, or sign payments yet.</div><div className="mt-7"><WorkspaceContent view={view} setView={selectView} /></div></div>
        </div>
      </div>
    </main>
  );
}

function NavButton({ item, active, compact, onClick }: { item: NavItem; active: boolean; compact: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button onClick={onClick} className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${active ? "bg-[#0b44fe]/10 text-[#0b44fe]" : "text-slate-600 hover:bg-slate-100 hover:text-[#141a24]"} ${compact ? "lg:justify-center lg:px-2" : "gap-3"}`}><Icon className="size-[18px] shrink-0" /><span className={compact ? "lg:hidden" : ""}>{item.label}</span>{item.id === "approvals" && !compact ? <span className="ml-auto rounded-full bg-[#0b44fe] px-1.5 py-0.5 text-[10px] font-bold text-white">0</span> : null}</button>;
}
