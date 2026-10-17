import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { asAddress, asMicroAmount, delegationStatus, teeConnection } from "./magicblock.ts";
import { mirrorCompanyJournal } from "./supabase-journal-persistence.ts";
import { BASE_RPC, PROGRAM_ID, TEE_RPC, paymentRequestAddress, requestBranchScope } from "./operations.ts";
import { confirmedOnboardingStep } from "./onboarding-journal.ts";
import { paymentId } from "./payment-journal.ts";

const idl = JSON.parse(readFileSync(new URL("../idl/mercury.json", import.meta.url), "utf8")) as anchor.Idl;
const coder = new anchor.BorshAccountsCoder(idl);
const DEFAULT_PATH = new URL("../.state/payment-flows.json", import.meta.url).pathname;
const path = () => process.env.MERCURY_PAYMENT_FLOW_JOURNAL ?? DEFAULT_PATH;

export type PaymentFlow = {
  paymentId: string; company: string; requester: string; request: string; requestId: string;
  termsHash: string; createdAt: string;
  includeFinance?: boolean; manager?: string | null;
  branchId?: number | null;
  includeRequester?: boolean;
};
type Journal = { version: 1; flows: PaymentFlow[] };
type RequestData = { company: PublicKey; requester: PublicKey; id: anchor.BN; private_ready: boolean; status: number };

export type PaymentFlowTerms = {
  requester: string; recipient: string; amountMicro: number; includeFinance: boolean; manager: string | null;
  branchId: number | null;
};
export type PaymentFlowObservation = {
  exists: boolean; delegated: boolean; visibleOnTee: boolean; permissionExists: boolean;
  privateReady: boolean; status: "empty" | "submitted" | "approved" | "executed" | "rejected" | "unknown";
};
export type PaymentFlowStep = {
  status: "build" | "wait" | "approval_required" | "ready_to_execute" | "ready" | "rejected";
  operation: "prepareRequest" | "delegateRequest" | "activateFounderRequest" | "initRequestPermission" |
    "activateRequestPrivacy" | "submitPayment" | "approvePayment" | null;
  actor: string | null; sendTo: "base" | "ephemeral" | null; reason: string;
};

export function validateRequesterGrantForFlow(args: {
  company: string; founder: string; requester: string; requestId: string;
  grant: Record<string, unknown>;
}): void {
  const { company, founder, requester, requestId, grant } = args;
  const role = Number(grant.role);
  const financeRequester = role === 1;
  if ((role !== 1 && role !== 3) || grant.company !== company ||
      grant.member !== requester || grant.grantor !== founder ||
      grant.parent !== PublicKey.default.toBase58() ||
      grant.active !== true || grant.revoked !== false ||
      (!financeRequester && grant.scope !== PublicKey.default.toBase58() &&
        grant.scope !== requestBranchScope(new PublicKey(company), requestId).toBase58())) {
    throw new Error("Active requester grant for this payment branch is required");
  }
}

function readJournal(): Journal {
  try {
    const journal = JSON.parse(readFileSync(path(), "utf8")) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.flows)) throw new Error("Invalid payment flow journal");
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, flows: [] };
    throw error;
  }
}

function saveJournal(journal: Journal): void {
  const destination = path();
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
  mirrorCompanyJournal({ domain: "payment-flows", journal, rowKeys: ["flows"] });
}

function requestIdFor(id: string, branchId: number | null): string {
  const random = createHash("sha256").update(`mercury-payment-request:${id}`).digest().readBigUInt64LE(0);
  return (((BigInt(branchId ?? 0) << 40n) | (random & ((1n << 40n) - 1n)))).toString();
}

function normalizedTerms(input: Record<string, unknown>, legacy = false): PaymentFlowTerms {
  const requester = asAddress(input.requester, "requester");
  const recipient = asAddress(input.recipient, "recipient");
  const amountMicro = asMicroAmount(input.amountMicro);
  if (requester === recipient) throw new Error("Requester cannot be the payment recipient");
  if (input.includeFinance !== undefined && typeof input.includeFinance !== "boolean") {
    throw new Error("includeFinance must be boolean");
  }
  const manager = input.manager === undefined || input.manager === null ? null : asAddress(input.manager, "manager");
  if (manager === requester || manager === recipient) throw new Error("Manager conflicts with the payment request");
  const branchId = input.branchId === undefined || input.branchId === null ? null : input.branchId;
  if (branchId !== null && (typeof branchId !== "number" || !Number.isInteger(branchId) ||
      branchId < 1 || branchId > 0xff_ffff)) {
    throw new Error("branchId must be an integer from 1 to 16777215");
  }
  if (manager && branchId === null && !legacy) throw new Error("Manager payments require branchId");
  return { requester, recipient, amountMicro, includeFinance: input.includeFinance !== false, manager, branchId };
}

function hashTerms(terms: PaymentFlowTerms): string {
  const { branchId, ...legacyTerms } = terms;
  return createHash("sha256").update(JSON.stringify(branchId === null ? legacyTerms : terms)).digest("hex");
}

export function getOrCreatePaymentFlow(paymentIdInput: unknown, companyInput: unknown,
  input: Record<string, unknown>): { flow: PaymentFlow; terms: PaymentFlowTerms } {
  const payment = paymentId(paymentIdInput);
  const company = asAddress(companyInput, "company");
  const journal = readJournal();
  const existing = journal.flows.find((item) => item.paymentId === payment);
  const terms = normalizedTerms(input, existing !== undefined && existing.branchId === undefined);
  const requestId = existing?.requestId ?? requestIdFor(payment, terms.branchId);
  const request = paymentRequestAddress(new PublicKey(company), new PublicKey(terms.requester), new BN(requestId)).toBase58();
  if (existing) {
    if (existing.company !== company || existing.requester !== terms.requester || existing.request !== request ||
        existing.requestId !== requestId || existing.termsHash !== hashTerms(terms)) {
      throw new Error("Payment ID is already bound to different private request terms");
    }
    if (existing.includeFinance === undefined || existing.manager === undefined) {
      existing.includeFinance = terms.includeFinance;
      existing.manager = terms.manager;
      saveJournal(journal);
    }
    return { flow: existing, terms };
  }
  if (journal.flows.some((item) => item.company === company && item.request === request)) {
    throw new Error("Derived payment request is already bound to another payment ID");
  }
  const flow: PaymentFlow = { paymentId: payment, company, requester: terms.requester, request, requestId,
    termsHash: hashTerms(terms), createdAt: new Date().toISOString(),
    includeFinance: terms.includeFinance, manager: terms.manager, branchId: terms.branchId };
  journal.flows.push(flow);
  saveJournal(journal);
  return { flow, terms };
}

export function recordedRequestReaders(companyInput: unknown): Map<string, {
  requester: string; includeFinance: boolean; manager: string | null;
}> {
  const company = asAddress(companyInput, "company");
  return new Map(readJournal().flows.filter((flow) => flow.company === company &&
    typeof flow.includeFinance === "boolean" && flow.manager !== undefined)
    .map((flow) => [flow.request, { requester: flow.requester,
      includeFinance: flow.includeFinance!, manager: flow.manager! }]));
}

export function applyConfirmedReaderCleanup(companyInput: unknown, requestInput: unknown,
  kind: "finance" | "manager" | "all"): void {
  const company = asAddress(companyInput, "company");
  const request = asAddress(requestInput, "request");
  const journal = readJournal();
  const flow = journal.flows.find((item) => item.company === company && item.request === request);
  if (!flow) return;
  if (kind === "finance") flow.includeFinance = false;
  else if (kind === "manager") flow.manager = null;
  else {
    flow.includeFinance = false;
    flow.manager = null;
    flow.includeRequester = false;
  }
  saveJournal(journal);
}

export function getPaymentFlow(paymentIdInput: unknown, companyInput: unknown): PaymentFlow {
  const payment = paymentId(paymentIdInput);
  const company = asAddress(companyInput, "company");
  const flow = readJournal().flows.find((item) => item.paymentId === payment && item.company === company);
  if (!flow) throw new Error("Unknown payment flow ID");
  return flow;
}

function status(value: number | undefined): PaymentFlowObservation["status"] {
  return ["empty", "submitted", "approved", "executed", "rejected"][value ?? -1] as PaymentFlowObservation["status"] ?? "unknown";
}

export function nextPaymentFlowStep(observation: PaymentFlowObservation, flow: PaymentFlow, founder: string): PaymentFlowStep {
  if (!observation.exists) return { status: "build", operation: "prepareRequest", actor: flow.requester, sendTo: "base", reason: "Create and route the payment request with one approval" };
  if (!observation.delegated) return { status: "build", operation: "delegateRequest", actor: flow.requester, sendTo: "base", reason: "Delegate the request to the selected PER" };
  if (!observation.visibleOnTee) return { status: "wait", operation: null, actor: null, sendTo: null, reason: "Wait for the delegated request to appear on the selected PER" };
  if (!observation.permissionExists && flow.requester === founder) {
    return { status: "build", operation: "activateFounderRequest", actor: founder, sendTo: "ephemeral", reason: "Protect and submit the Founder request with one approval" };
  }
  if (!observation.permissionExists) return { status: "build", operation: "initRequestPermission", actor: flow.requester, sendTo: "ephemeral", reason: "Create the request's ER-local permission" };
  if (!observation.privateReady) return { status: "build", operation: "activateRequestPrivacy", actor: founder, sendTo: "ephemeral", reason: "Restrict request access before storing recipient or amount" };
  if (observation.status === "empty") return { status: "build", operation: "submitPayment", actor: flow.requester, sendTo: "ephemeral", reason: "Write the private recipient and amount" };
  if (observation.status === "submitted") return { status: "approval_required", operation: "approvePayment", actor: null, sendTo: "ephemeral", reason: "Founder, Finance, or a scoped Manager must approve this request" };
  if (observation.status === "approved") return { status: "ready_to_execute", operation: null, actor: null, sendTo: null, reason: "Request is approved; prepare the linked payment job" };
  if (observation.status === "executed") return { status: "ready", operation: null, actor: null, sendTo: null, reason: "Payment is executed; reconcile and refresh the snapshot if needed" };
  return { status: "rejected", operation: null, actor: null, sendTo: null, reason: "Payment request was rejected" };
}

export async function inspectPaymentFlow(flow: PaymentFlow, founder: string, teeToken: string): Promise<{
  observation: PaymentFlowObservation; step: PaymentFlowStep;
}> {
  const request = new PublicKey(flow.request);
  const route = await delegationStatus({ account: flow.request });
  if (route.isDelegated === true && (typeof route.fqdn !== "string" || new URL(route.fqdn).hostname !== new URL(TEE_RPC).hostname)) {
    throw new Error("Payment request is delegated to a different PER validator");
  }
  const delegated = route.isDelegated === true;
  const base = new Connection(BASE_RPC, "confirmed");
  const tee = teeConnection(teeToken);
  const [baseAccount, teeAccount, permission] = await Promise.all([
    base.getAccountInfo(request), delegated ? tee.getAccountInfo(request) : Promise.resolve(null),
    delegated ? tee.getAccountInfo(permissionPdaFromAccount(request)) : Promise.resolve(null),
  ]);
  if (!baseAccount && delegated) throw new Error("Router and base disagree about payment request existence");
  const account = delegated ? teeAccount : baseAccount;
  if (account && !account.owner.equals(PROGRAM_ID)) throw new Error("Payment request has an unexpected owner");
  const data = account ? coder.decode("PaymentRequest", account.data) as RequestData : null;
  if (data && (!data.company.equals(new PublicKey(flow.company)) || !data.requester.equals(new PublicKey(flow.requester)) ||
      data.id.toString() !== flow.requestId)) throw new Error("Payment request identity does not match the flow");
  const observation: PaymentFlowObservation = {
    exists: baseAccount !== null, delegated, visibleOnTee: teeAccount !== null,
    permissionExists: permission !== null || data?.private_ready === true ||
      confirmedOnboardingStep(flow.company, flow.request, `paymentFlow:${flow.paymentId}:initRequestPermission`),
    privateReady: data?.private_ready === true, status: status(data?.status),
  };
  return { observation, step: nextPaymentFlowStep(observation, flow, founder) };
}

export function flowReceiptOperation(flow: PaymentFlow, operation: string): string {
  return `paymentFlow:${flow.paymentId}:${operation}`;
}
