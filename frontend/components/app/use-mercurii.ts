"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AccessRole, type CompanyPolicy, type Payee, type PaymentRow, type RecipientBalance,
  type PayrollRun, type PayrollSchedule, type TeamMember, type TreasurySnapshot, roleFromGrant } from "@/lib/mercurii-client";
import { signMessage, type BrowserWallet } from "@/lib/mercurii-wallet";

export type Resource<T> = { state: "idle" | "loading" | "ready" | "error"; value: T | null; error: string | null };
const idle = <T,>(): Resource<T> => ({ state: "idle", value: null, error: null });
const loading = <T,>(prior: Resource<T>): Resource<T> => ({ ...prior, state: "loading", error: null });

export type Session = { address: string; company: string; token: string; expiresAt: number;
  role: AccessRole; policy: CompanyPolicy | null; members: TeamMember[]; grantAddress: string | null };
export type Capabilities = { privateReceive: boolean; paymentExecution: boolean;
  financeAgent: boolean; x402: boolean; recipientWithdraw: boolean };
const unavailableCapabilities: Capabilities = { privateReceive: false, paymentExecution: false,
  financeAgent: false, x402: false, recipientWithdraw: false };

const COMPANY_STORAGE_KEY = "mercurii.company";

export function useMercurii(onClearPrivateDraft?: () => void) {
  // Keep the initial server and browser render identical. The remembered address
  // is restored after hydration, otherwise Next's instant navigation can fail.
  const [company, setCompanyState] = useState("");
  const setCompany = useCallback((value: string) => {
    setCompanyState(value);
    try {
      if (value.trim()) window.localStorage.setItem(COMPANY_STORAGE_KEY, value.trim());
      else window.localStorage.removeItem(COMPANY_STORAGE_KEY);
    } catch { /* Storage unavailable; session-only company. */ }
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [programId, setProgramId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(unavailableCapabilities);
  const [policy, setPolicy] = useState<Resource<CompanyPolicy>>(idle);
  const [snapshot, setSnapshot] = useState<Resource<TreasurySnapshot>>(idle);
  const [recipientBalance, setRecipientBalance] = useState<Resource<RecipientBalance>>(idle);
  const [members, setMembers] = useState<Resource<TeamMember[]>>(idle);
  const [payments, setPayments] = useState<Resource<PaymentRow[]>>(idle);
  const [payees, setPayees] = useState<Resource<Payee[]>>(idle);
  const [payrollRuns, setPayrollRuns] = useState<Resource<PayrollRun[]>>(idle);
  const [payrollSchedules, setPayrollSchedules] = useState<Resource<PayrollSchedule[]>>(idle);
  const [audits, setAudits] = useState<Resource<Record<string, unknown>[]>>(idle);
  const walletRef = useRef<BrowserWallet | null>(null);
  const generationRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);

  useEffect(() => {
    try { setCompanyState(window.localStorage.getItem(COMPANY_STORAGE_KEY) ?? ""); } catch { /* Storage unavailable. */ }
  }, []);

  const clearPrivateData = useCallback(() => {
    setPolicy(idle()); setSnapshot(idle()); setMembers(idle());
    setRecipientBalance(idle()); setPayments(idle()); setPayees(idle());
    setPayrollRuns(idle()); setPayrollSchedules(idle()); setAudits(idle());
  }, []);

  const clearSession = useCallback(() => {
    generationRef.current += 1;
    walletRef.current = null;
    setWallet(null);
    setSession(null);
    clearPrivateData();
    onClearPrivateDraft?.();
  }, [clearPrivateData, onClearPrivateDraft]);

  useEffect(() => {
    let active = true;
    api<{ ok: boolean; programId: string; capabilities?: Capabilities }>("/health")
      .then((health) => { if (active) { setBackendStatus("online"); setProgramId(health.programId); setCapabilities(health.capabilities ?? unavailableCapabilities); } })
      .catch(() => { if (active) setBackendStatus("offline"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!wallet || !session) return;
    const accountChanged = (...args: unknown[]) => {
      const nextAddress = args[0];
      if (!nextAddress || typeof nextAddress !== "object" ||
          !("toBase58" in nextAddress) ||
          typeof nextAddress.toBase58 !== "function" ||
          nextAddress.toBase58() !== session.address) {
        clearSession();
        setConnectionError("Wallet account changed. Sign in again to see private company data.");
      }
    };
    const disconnected = () => {
      if (intentionalDisconnectRef.current) return;
      clearSession();
      setConnectionError("Wallet disconnected. Sign in again.");
    };
    wallet.on?.("accountChanged", accountChanged);
    wallet.on?.("disconnect", disconnected);
    return () => {
      wallet.off?.("accountChanged", accountChanged);
      wallet.off?.("disconnect", disconnected);
    };
  }, [wallet, session, clearSession]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const delay = Math.max(0, Math.min(session.expiresAt - Date.now(), 2_147_483_647));
    const timeout = window.setTimeout(() => {
      if (session.expiresAt <= Date.now()) {
        clearSession();
        setConnectionError("Private session expired. Sign in again.");
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [session, clearSession]);

  const load = useCallback(async <T,>(setter: (value: Resource<T>) => void, previous: Resource<T>,
    task: Promise<T>, generation: number) => {
    if (generationRef.current !== generation) return;
    setter(loading(previous));
    try {
      const value = await task;
      if (generationRef.current === generation) setter({ state: "ready", value, error: null });
    } catch (cause) {
      if (generationRef.current === generation) setter({ state: "error", value: null,
        error: cause instanceof Error ? cause.message : "Could not load private data" });
    }
  }, []);

  const refresh = useCallback(async (current: Session) => {
    const generation = generationRef.current;
    if (current.expiresAt && current.expiresAt <= Date.now()) {
      clearSession();
      setConnectionError("Private session expired. Sign in again.");
      return;
    }
    if (walletRef.current?.publicKey?.toBase58() !== current.address) {
      clearSession();
      setConnectionError("Wallet account changed. Sign in again.");
      return;
    }
    const credentials = { company: current.company, token: current.token };
    const tasks: Promise<unknown>[] = [];
    tasks.push(load(setRecipientBalance, recipientBalance,
      api<RecipientBalance>(`/v1/recipient-balance/${current.address}`, credentials), generation));
    if (current.role === "founder" || current.role === "finance") {
      tasks.push(load(setPolicy, policy, api<CompanyPolicy>("/v1/company-policy", credentials), generation));
      tasks.push(load(setSnapshot, snapshot, api<TreasurySnapshot>("/v1/treasury-snapshot", credentials), generation));
      tasks.push(load(setPayments, payments, api<{ payments: PaymentRow[] }>("/v1/payment-jobs", credentials)
        .then((value) => value.payments), generation));
      tasks.push(load(setPayees, payees, api<{ payees: Payee[] }>("/v1/payees", credentials)
        .then((value) => value.payees), generation));
      tasks.push(load(setPayrollSchedules, payrollSchedules,
        api<{ schedules: PayrollSchedule[] }>("/v1/payroll-schedules", credentials).then((value) => value.schedules), generation));
    }
    if (current.role === "founder") {
      tasks.push(load(setPayrollRuns, payrollRuns,
        api<{ runs: PayrollRun[] }>("/v1/payroll-runs", credentials).then((value) => value.runs), generation));
      tasks.push(load(setAudits, audits,
        api<{ audits: Record<string, unknown>[] }>("/v1/compliance/audits", credentials).then((value) => value.audits), generation));
    }
    if (current.role !== "member") {
      tasks.push(load(setMembers, members,
        api<{ members: TeamMember[] }>("/v1/team-members", credentials).then((value) => value.members), generation));
    } else {
      setMembers({ state: "ready", value: [], error: null });
    }
    await Promise.allSettled(tasks);
  }, [audits, clearSession, load, members, payees, payments, payrollRuns, payrollSchedules, policy, recipientBalance, snapshot]);

  const connect = useCallback(async (wallet: BrowserWallet, companyOverride?: string) => {
    setConnectionError(null);
    const companyAddress = (companyOverride ?? company).trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(companyAddress)) {
      setConnectionError("Enter the company account address before connecting"); return;
    }
    const generation = ++generationRef.current;
    clearPrivateData();
    setConnecting(true);
    try {
      const address = (await wallet.connect()).publicKey.toBase58();
      if (companyAddress !== company.trim()) setCompany(companyAddress);
      const credentials = { company: companyAddress };
      const challenge = await api<{ challenge: string }>("/v1/auth/tee-login/challenge",
        { ...credentials, body: { wallet: address } });
      const signature = await signMessage(wallet, challenge.challenge);
      const login = await api<{ token: string; expiresAt: number }>("/v1/auth/tee-login",
        { ...credentials, body: { wallet: address, challenge: challenge.challenge, signature } });
      if (generationRef.current !== generation || wallet.publicKey?.toBase58() !== address) {
        throw new Error("Wallet account changed during sign-in. Please connect again.");
      }
      const [policyResult, teamResult, contextResult] = await Promise.allSettled([
        api<CompanyPolicy>("/v1/company-policy", { ...credentials, token: login.token }),
        api<{ members: TeamMember[] }>("/v1/team-members", { ...credentials, token: login.token }),
        api<{ founder: string }>(`/v1/company-context?actor=${encodeURIComponent(address)}`,
          { ...credentials, token: login.token }),
      ]);
      const privatePolicy = policyResult.status === "fulfilled" ? policyResult.value : null;
      const privateMembers = teamResult.status === "fulfilled" ? teamResult.value.members : [];
      const grants = privateMembers.flatMap((item) => item.grants)
        .filter((grant) => grant.member === address && grant.active && !grant.revoked);
      const priority: Record<AccessRole, number> = { founder: 0, finance: 1, manager: 2, requester: 3,
        viewer: 4, agent: 5, member: 6 };
      grants.sort((a, b) => priority[roleFromGrant(a.role)] - priority[roleFromGrant(b.role)]);
      const registeredFounder = contextResult.status === "fulfilled" ? contextResult.value.founder : null;
      const role: AccessRole = privatePolicy?.founder === address || registeredFounder === address ? "founder" :
        grants.length ? roleFromGrant(grants[0]!.role) : privatePolicy?.finance === address ? "finance" : "member";
      const next: Session = { address, company: credentials.company, token: login.token,
        expiresAt: login.expiresAt > 0 && login.expiresAt < 1_000_000_000_000 ? login.expiresAt * 1000 : login.expiresAt,
        role, policy: privatePolicy,
        members: privateMembers, grantAddress: grants[0]?.address ?? null };
      if (generationRef.current !== generation) return;
      walletRef.current = wallet;
      setWallet(wallet);
      setSession(next);
      setBackendStatus("online");
      if (privatePolicy) setPolicy({ state: "ready", value: privatePolicy, error: null });
      if (teamResult.status === "fulfilled") setMembers({ state: "ready", value: privateMembers, error: null });
      void refresh(next);
    } catch (cause) {
      if (generationRef.current === generation) setConnectionError(cause instanceof Error ? cause.message : "Wallet login failed");
    } finally { setConnecting(false); }
  }, [clearPrivateData, company, refresh, setCompany]);

  const disconnect = useCallback(async () => {
    const previous = walletRef.current;
    intentionalDisconnectRef.current = true;
    clearSession();
    await previous?.disconnect?.().catch(() => undefined);
    intentionalDisconnectRef.current = false;
  }, [clearSession]);

  const request = useCallback(<T,>(path: string, body?: Record<string, unknown>, method?: "GET" | "POST" | "PATCH") => {
    if (!session) throw new Error("Connect and sign in first");
    if (walletRef.current?.publicKey?.toBase58() !== session.address) {
      clearSession();
      throw new Error("Wallet account changed. Sign in again before accessing private data.");
    }
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      clearSession();
      throw new Error("Private session expired. Sign in again.");
    }
    return api<T>(path, { company: session.company, token: session.token, body, method });
  }, [clearSession, session]);

  return { company, setCompany, session, wallet, connecting, connectionError,
    backendStatus, programId, capabilities, connect, disconnect, refresh: () => session ? refresh(session) : Promise.resolve(),
    request, policy, snapshot, recipientBalance, members, payments, payees, payrollRuns, payrollSchedules, audits };
}

export type MercuriiController = ReturnType<typeof useMercurii>;
