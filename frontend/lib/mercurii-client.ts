export type AccessRole = "founder" | "finance" | "manager" | "requester" | "viewer" | "agent" | "member";

export type CompanyPolicy = {
  address: string;
  founder: string;
  finance: string;
  mint: string;
  monthlyLimitMicro: string;
  agentCapMicro: string;
  spentMicro: string;
  reservedMicro: string;
  period: string;
};

export type TreasurySnapshot = { balanceMicro: string; updatedSlot: string; mint: string };
export type RecipientBalance = { owner: string; mint: string; tokenAccount: string;
  location: "ephemeral"; balanceMicro: string };
export type TeamGrant = {
  address: string; member: string; grantor: string; role: number; active: boolean; revoked: boolean;
  mayDelegate: boolean; perPaymentCapMicro: string; periodCapMicro: string; spentMicro: string;
  approvedMicro: string; recipients: string[]; parent: string; scope: string;
};
export type TeamMember = { member: string; grants: TeamGrant[] };
export type Payee = { payeeId: string; kind: "employee" | "contractor" | "vendor"; teamId: string | null;
  active: boolean; createdAt: string };
export type PaymentRow = {
  record: { paymentId: string; request: string; state: string; signature: string | null; createdAt?: string };
  payee: { payeeId: string; kind: string; teamId: string | null } | null;
  requestStatus: string; chainStatus: string | null; snapshotNeedsSync: boolean | null;
  integrityWarning: string | null;
};
export type PayrollRun = { runId: string; createdAt: string; itemCount?: number; items?: unknown[]; status: string };
export type PayrollSchedule = { scheduleId: string; name: string; cadence: string; firstPayDate: string;
  timeZone: string; paused: boolean; revision: number; rosterRevision: number; nextPayDate?: string | null;
  dueCycles?: { payDate: string; state: string; launched: boolean }[] };

export class MercuryApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: {
  company?: string; token?: string; method?: "GET" | "POST" | "PATCH"; body?: Record<string, unknown>;
} = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid API path");
  const headers = new Headers({ accept: "application/json" });
  if (options.company) headers.set("x-mercury-company", options.company);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(`/api/mercurii${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"), headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new MercuryApiError(result.error ?? `Request failed (${response.status})`, response.status);
  return result;
}

export function formatUsdc(micro: string | number | null | undefined): string {
  if (micro == null) return "—";
  const amount = BigInt(String(micro));
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 1_000_000n;
  const fractional = (absolute % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${amount < 0n ? "−" : ""}${whole.toLocaleString("en-US")}${fractional ? `.${fractional}` : ""} USDC`;
}

export function parseUsdc(value: string): number {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new Error("Enter a positive USDC amount with up to six decimals");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const micro = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micro <= 0n || micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is outside the supported range");
  return Number(micro);
}

export function shortAddress(address: string | null | undefined): string {
  return address ? `${address.slice(0, 5)}…${address.slice(-5)}` : "—";
}

export function roleFromGrant(role: number): AccessRole {
  return ({ 1: "finance", 2: "manager", 3: "requester", 4: "viewer", 5: "agent" } as Record<number, AccessRole>)[role] ?? "member";
}
