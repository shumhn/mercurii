import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import BN from "bn.js";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { parseVendorRegistry, suggestInvoicePayment } from "./invoice-agent.ts";
import { assertTeeTokenActor, createPersistentAssistantChallenge, consumePersistentAssistantChallenge,
  type X402PurchaseIntent } from "./assistant-auth.ts";
import { answerAssistantQuestion, classifyAssistantQuestion, resolveAssistantAccess } from "./finance-assistant.ts";
import { runMercuryAgent } from "./mercury-agent.ts";
import { AgentRateLimitError, enforceAgentRateLimit } from "./agent-rate-limit.ts";
import { appendAgentAudit, listAgentAudit } from "./agent-records.ts";
import { configuredX402SignerSecret, parseX402Registry } from "./x402-spender.ts";
import { listInvoicePaymentIds, reserveInvoiceFlow } from "./invoice-journal.ts";
import { inspectRootFinanceGrant } from "./finance-onboarding.ts";
import { inspectManagerGrant } from "./manager-onboarding.ts";
import { inspectMemberGrant } from "./member-onboarding.ts";
import { confirmOnboardingReceipt as confirmLocalOnboardingReceipt,
  expireUnsignedOnboardingReceipt as expireLocalOnboardingReceipt,
  getOnboardingReceipt as getLocalOnboardingReceipt,
  hydrateOnboardingReceiptCache, latestOnboardingReceipt as latestLocalOnboardingReceipt,
  listOnboardingReceipts as listLocalOnboardingReceipts,
  reconcileOnboardingReceipt as reconcileLocalOnboardingReceipt,
  recordOnboardingBuild as recordLocalOnboardingBuild,
  waitForCleanupReceipt, hasConfirmedRecipientDeposit, validateSignedOnboardingReceipt } from "./onboarding-journal.ts";
import { nextRecipientOnboarding } from "./recipient-onboarding.ts";
import { inspectAgentOnboarding } from "./agent-onboarding.ts";
import { listVisibleAgentPolicies } from "./agent-directory.ts";
import { nextTreasuryFundingStep, resumableFundingTarget } from "./treasury-funding.ts";
import { scanFinanceReaderCleanup } from "./finance-cleanup.ts";
import { scanManagerReaderCleanup } from "./manager-cleanup.ts";
import { scanMemberReaderCleanup } from "./member-cleanup.ts";
import { listTeamMembers } from "./team-directory.ts";
import { inspectCompanyOnboarding } from "./onboarding.ts";
import { abandonPreparedPayment as abandonLocalPayment, bindSignedPayment as bindLocalPayment, getPayment as getLocalPayment,
  listPayments as listLocalPayments, paymentId, paymentReconciliationPage as localPaymentReconciliationPage,
  preparePayment as prepareLocalPayment, reconcilePayment as reconcileLocalPayment, registerPayment as registerLocalPayment } from "./payment-journal.ts";
import { DatabasePaymentStore } from "./database-payment-store.ts";
import { paymentRecoveryAction } from "./reconciliation.ts";
import { createPayrollRun, getPayrollRun, listPayrollRuns, payrollNextAction, summarizePayroll } from "./payroll-run.ts";
import { checkPayrollReadiness } from "./payroll-readiness.ts";
import { buildPayrollApprovalChunk, MAX_APPROVALS_PER_TRANSACTION } from "./payroll-approval.ts";
import { previewPayrollCsv } from "./payroll-roster.ts";
import { createAuditShare, listAuditEvents, listAuditShares, openAuditShare, revokeAuditShare, type AuditBundle } from "./compliance-audit.ts";
import { createPayrollSchedule, getPayrollSchedule, launchScheduledPayroll, listPayrollSchedules,
  payrollScheduleView, updatePayrollSchedule, hydratePayrollScheduleCache } from "./payroll-schedule.ts";
import { verifyPayrollScheduleFounder } from "./payroll-schedule-auth.ts";
import { deactivatePayee as deactivateLocalPayee, linkPaymentPayee as linkLocalPaymentPayee,
  listPayees as listLocalPayees, matchPayee as matchLocalPayee,
  paymentPayee as localPaymentPayee, registerPayee as registerLocalPayee } from "./payee-journal.ts";
import { DatabasePayeeStore } from "./database-payee-store.ts";
import { DatabasePaymentFlowStore } from "./database-payment-flow-store.ts";
import { DatabaseInvoiceStore } from "./database-invoice-store.ts";
import { DatabasePayrollRunStore } from "./database-payroll-store.ts";
import { DatabasePayrollScheduleStore } from "./database-payroll-schedule-store.ts";
import { DatabaseOnboardingReceiptStore } from "./database-onboarding-receipt-store.ts";
import { SupabasePrivateStore } from "./supabase-private-store.ts";
import { requestedCompanySelector, resolveCompany, verifyAndRegisterCompany,
  type CompanyContext } from "./company-registry.ts";
import { founderCompanyAddress, validateSignedCompanyBootstrap } from "./company-bootstrap.ts";
import { completeTeeLogin, createTeeLoginChallenge } from "./tee-login.ts";
import { requireFounderPolicy } from "./founder-access.ts";
import { applyConfirmedReaderCleanup as applyLocalConfirmedReaderCleanup, flowReceiptOperation,
  getOrCreatePaymentFlow as getOrCreateLocalPaymentFlow,
  getPaymentFlow as getLocalPaymentFlow, inspectPaymentFlow,
  recordedRequestReaders as recordedLocalPaymentFlowReaders, validateRequesterGrantForFlow } from "./payment-flow.ts";
import {
  DEVNET_USDC, asAddress, asMicroAmount, assertRecipientWithdrawalBalance, canonicalTokenAccount, delegationStatus, preparePrivateReceive,
  prepareRecipientOnboarding, prepareRecipientWithdrawal, readRecipientBalance, teeConnection,
} from "./magicblock.ts";
import {
  BASE_RPC, PROGRAM_ID, TEE_RPC, TEE_VALIDATOR, agentPaymentAccounts, buildOperation,
  paymentExecutionAccounts, paymentRequestAddress, paymentStatusFromRequest, requestBranchScope,
  readAgentPolicy, readCompanyPolicy, readPaymentRequest, readTeamGrant, readTreasurySnapshot,
} from "./operations.ts";

// Every request names its company (x-mercury-company header, body.company, or
// ?company=). The server never silently selects an env-configured company.
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8787");
const databasePayments = DatabasePaymentStore.fromEnvironment();
const databasePayees = DatabasePayeeStore.fromEnvironment();
const databasePaymentFlows = DatabasePaymentFlowStore.fromEnvironment();
const databaseInvoices = DatabaseInvoiceStore.fromEnvironment();
const databasePayrollRuns = DatabasePayrollRunStore.fromEnvironment();
const databasePayrollSchedules = DatabasePayrollScheduleStore.fromEnvironment();
const databaseOnboardingReceipts = DatabaseOnboardingReceiptStore.fromEnvironment();
// App indexes follow the same explicit persistence switch as encrypted
// operational records. A configured development secret alone must not cause
// an unexpected remote write.
const appDatabase = process.env.MERCURY_SUPABASE_PERSISTENCE === "1" ?
  SupabasePrivateStore.fromEnvironment() : null;

const grantRoles: Record<number, "finance" | "manager" | "requester" | "viewer" | "agent"> = {
  1: "finance", 2: "manager", 3: "requester", 4: "viewer", 5: "agent",
};

function cacheTeamDirectory(company: string, members: Awaited<ReturnType<typeof listTeamMembers>>): void {
  if (!appDatabase) return;
  const entries = members.flatMap(({ member, grants }) => grants.flatMap((grant) => {
    const role = grantRoles[Number(grant.role)];
    const grantAddress = typeof grant.address === "string" ? grant.address : null;
    if (!role || !grantAddress) return [];
    return [{ walletAddress: member, grantAddress, role,
      state: grant.revoked === true || grant.active !== true ? "revoked" as const : "active" as const }];
  }));
  void appDatabase.upsertCompanyMemberCache(company, entries).catch(() => undefined);
}

async function getPayment(id: unknown, company: string) {
  return databasePayments ? databasePayments.get(id, company) : getLocalPayment(id, company);
}
async function listPayments(company: unknown, limit = 50) {
  return databasePayments ? databasePayments.list(company, limit) : listLocalPayments(company, limit);
}
async function paymentReconciliationPage(company: unknown, offset: number, limit = 50) {
  return databasePayments ? databasePayments.reconciliationPage(company, offset, limit) :
    localPaymentReconciliationPage(company, offset, limit);
}
async function registerPayment(args: { paymentId: unknown; company: string; request: string; requester: string; requestId: string }) {
  return databasePayments ? databasePayments.register(args) : registerLocalPayment(args);
}
async function preparePayment(id: unknown, company: string, actor: string, transactionBase64: string) {
  return databasePayments ? databasePayments.prepare(id, company, actor, transactionBase64) :
    prepareLocalPayment(id, company, actor, transactionBase64);
}
async function abandonPreparedPayment(id: unknown, company: string, blockhashExpired: boolean) {
  return databasePayments ? databasePayments.abandonPrepared(id, company, blockhashExpired) :
    abandonLocalPayment(id, company, blockhashExpired);
}
async function bindSignedPayment(id: unknown, company: string, signedTransactionBase64: string) {
  return databasePayments ? databasePayments.bindSigned(id, company, signedTransactionBase64) :
    bindLocalPayment(id, company, signedTransactionBase64);
}
async function reconcilePayment(id: unknown, company: string, requestStatus: string,
  chainStatus: "not_found" | "processed" | "confirmed" | "failed" | null) {
  return databasePayments ? databasePayments.reconcile(id, company, requestStatus, chainStatus) :
    reconcileLocalPayment(id, company, requestStatus, chainStatus);
}
async function listPayees(company: unknown) {
  return databasePayees ? databasePayees.list(company) : listLocalPayees(company);
}
async function registerPayee(company: unknown, input: Record<string, unknown>) {
  return databasePayees ? databasePayees.register(company, input) : registerLocalPayee(company, input);
}
async function deactivatePayee(company: unknown, id: unknown) {
  return databasePayees ? databasePayees.deactivate(company, id) : deactivateLocalPayee(company, id);
}
async function matchPayee(company: unknown, id: unknown, recipient: unknown) {
  return databasePayees ? databasePayees.match(company, id, recipient) : matchLocalPayee(company, id, recipient);
}
async function linkPaymentPayee(company: unknown, payment: unknown, payee: unknown) {
  return databasePayees ? databasePayees.linkPayment(company, payment, payee) : linkLocalPaymentPayee(company, payment, payee);
}
async function paymentPayee(company: unknown, payment: unknown) {
  return databasePayees ? databasePayees.paymentPayee(company, payment) : localPaymentPayee(company, payment);
}
async function getOrCreatePaymentFlow(payment: unknown, company: unknown, input: Record<string, unknown>) {
  return databasePaymentFlows ? databasePaymentFlows.getOrCreate(payment, company, input) :
    getOrCreateLocalPaymentFlow(payment, company, input);
}
async function getPaymentFlow(payment: unknown, company: unknown) {
  return databasePaymentFlows ? databasePaymentFlows.get(payment, company) : getLocalPaymentFlow(payment, company);
}
async function applyConfirmedReaderCleanup(company: unknown, request: unknown, kind: "finance" | "manager" | "all") {
  return databasePaymentFlows ? databasePaymentFlows.applyConfirmedReaderCleanup(company, request, kind) :
    applyLocalConfirmedReaderCleanup(company, request, kind);
}
async function persistLegacyPaymentFlow(payment: unknown, company: unknown): Promise<void> {
  if (!databasePaymentFlows) return;
  await databasePaymentFlows.adopt(getLocalPaymentFlow(payment, company));
}
async function recordedPaymentFlowReaders(company: unknown) {
  return databasePaymentFlows ? databasePaymentFlows.recordedRequestReaders(company) : recordedLocalPaymentFlowReaders(company);
}
async function getStoredPayrollRun(id: unknown, company: unknown) { return databasePayrollRuns ? databasePayrollRuns.get(id, company) : getPayrollRun(id, company); }
async function listStoredPayrollRuns(company: unknown) { return databasePayrollRuns ? databasePayrollRuns.list(company) : listPayrollRuns(company); }
async function persistPayrollRun(run: ReturnType<typeof getPayrollRun>) { if (databasePayrollRuns) await databasePayrollRuns.adopt(run); }
async function persistPayrollSchedule(schedule: ReturnType<typeof getPayrollSchedule>) {
  if (databasePayrollSchedules) await databasePayrollSchedules.persist(schedule);
}

// The JSON journal remains a derived local cache for synchronous contract
// inspectors. Supabase is hydrated first and receives every new receipt and
// state change before the HTTP request returns, so a restart recovers the
// guided-flow state without relying on the old journal as its source.
// Hydration is per company and lazy: the first request for a company loads
// its caches, so one process can serve many registered companies.
const hydrationByCompany = new Map<string, Promise<void>>();
async function ensureCompanyHydrated(company: string): Promise<void> {
  const existing = hydrationByCompany.get(company);
  if (existing) return existing;
  const hydration = (async () => {
    if (databaseOnboardingReceipts) {
      hydrateOnboardingReceiptCache(await databaseOnboardingReceipts.list(company));
    }
    if (databasePayrollSchedules) {
      hydratePayrollScheduleCache(await databasePayrollSchedules.list(company));
    }
  })();
  hydrationByCompany.set(company, hydration);
  try { await hydration; } catch (error) {
    hydrationByCompany.delete(company);
    throw error;
  }
}
async function recordOnboardingBuild(args: Parameters<typeof recordLocalOnboardingBuild>[0]) {
  const receipt = recordLocalOnboardingBuild(args);
  if (databaseOnboardingReceipts) await databaseOnboardingReceipts.record(receipt);
  return receipt;
}
async function confirmOnboardingReceipt(id: string, signedTransactionBase64: string, token: string) {
  const receipt = await confirmLocalOnboardingReceipt(id, signedTransactionBase64, token);
  if (databaseOnboardingReceipts) await databaseOnboardingReceipts.update(receipt.company, receipt.id, () => receipt);
  return receipt;
}
async function reconcileOnboardingReceipt(id: string, company: string, token: string) {
  const receipt = await reconcileLocalOnboardingReceipt(id, company, token);
  if (databaseOnboardingReceipts) await databaseOnboardingReceipts.update(receipt.company, receipt.id, () => receipt);
  return receipt;
}
async function expireUnsignedOnboardingReceipt(id: string, company: string, token: string) {
  const receipt = await expireLocalOnboardingReceipt(id, company, token);
  if (databaseOnboardingReceipts) await databaseOnboardingReceipts.update(receipt.company, receipt.id, () => receipt);
  return receipt;
}
// Reads are synchronous because the durable receipt set is hydrated into this
// process before routes are accepted. These names keep the contract inspectors
// and their route call sites simple while the database remains the restart
// recovery source.
const latestOnboardingReceipt = latestLocalOnboardingReceipt;
const getOnboardingReceipt = getLocalOnboardingReceipt;
const listOnboardingReceipts = listLocalOnboardingReceipts;

function x402PurchaseIntent(body: Record<string, unknown>): X402PurchaseIntent | undefined {
  if (body.allowX402Purchase !== true) return undefined;
  if (process.env.MERCURY_ENABLE_X402_AGENT !== "1") throw new Error("x402 agent purchases are disabled");
  const registry = parseX402Registry(process.env.MERCURY_X402_SERVICES_JSON ?? "");
  if (typeof body.selectedX402ServiceId !== "string" ||
      !Object.hasOwn(registry, body.selectedX402ServiceId)) throw new Error("x402 service is not allowlisted");
  const service = registry[body.selectedX402ServiceId]!;
  if (Date.parse(service.expiresAt) <= Date.now()) throw new Error("x402 service approval expired");
  return { serviceId: body.selectedX402ServiceId, taskId: String(body.x402TaskId),
    url: service.url, payTo: service.payTo, maxMicro: service.maxMicro };
}

function optionalAuditTime(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return value;
}

async function buildAuditBundle(ctx: CompanyContext, body: Record<string, unknown>, token: string): Promise<AuditBundle> {
  const companyAddress = ctx.company;
  const from = optionalAuditTime(body.from, "from");
  const to = optionalAuditTime(body.to, "to");
  if (from && to && Date.parse(from) > Date.parse(to)) throw new Error("Audit period ends before it starts");
  const available = await listStoredPayrollRuns(companyAddress);
  const selected = body.runIds === undefined
    ? available.filter((run) => (!from || run.createdAt >= from) && (!to || run.createdAt <= to)).map((run) => run.runId)
    : (() => {
      if (!Array.isArray(body.runIds) || body.runIds.length < 1 || body.runIds.length > 100) {
        throw new Error("runIds must contain 1 to 100 payroll runs");
      }
      if (!body.runIds.every((id) => typeof id === "string") || new Set(body.runIds).size !== body.runIds.length) {
        throw new Error("runIds must be unique UUIDs");
      }
      const ids = body.runIds as string[];
      if (ids.some((id) => !available.some((run) => run.runId === id))) throw new Error("runIds includes an unknown payroll run");
      if (ids.some((id) => {
        const run = available.find((item) => item.runId === id)!;
        return (from !== null && run.createdAt < from) || (to !== null && run.createdAt > to);
      })) throw new Error("runIds includes a payroll run outside the audit period");
      return ids;
    })();
  if (selected.length === 0) throw new Error("No payroll runs match this audit period");
  const payrollRuns = [];
  for (const runId of selected) {
    const run = await getStoredPayrollRun(runId, companyAddress);
    const items = [];
    for (const item of run.items) {
      const request = await readPaymentRequest(companyAddress, item.request, token);
      let payment = null;
      try { payment = await getPayment(item.paymentId, companyAddress); } catch { /* not executed yet */ }
      items.push({ paymentId: item.paymentId, request: item.request, recipient: String(request.recipient),
        amountMicro: String(request.amountMicro), requestStatus: String(request.status),
        payoutState: payment?.state ?? null, executionSignature: payment?.signature ?? null });
    }
    payrollRuns.push({ runId: run.runId, createdAt: run.createdAt, scheduleId: run.scheduleId,
      rosterRevision: run.rosterRevision, payDate: run.payDate, termsHash: run.termsHash, items });
  }
  return { version: 1, company: companyAddress, generatedAt: new Date().toISOString(),
    period: { from, to }, payrollRuns };
}

function reply(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function matchesAgentApiKey(header: string | undefined): boolean {
  const expected = process.env.MERCURY_AGENT_API_KEY;
  const supplied = header?.match(/^Bearer (.+)$/)?.[1];
  if (!expected || expected.length < 16 || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function nextTeamReaderCleanup(ctx: CompanyContext, grant: string, role: number, parentGrant: string,
  token: string): Promise<Record<string, unknown>> {
  const companyAddress = ctx.company;
  const founderAddress = ctx.founder;
  let targets: Array<{ address: string; kind: "request" | "snapshot" | "agent" }>;
  let operationKey: string;
  if (role === 1) {
    const scan = await scanFinanceReaderCleanup({ company: companyAddress, founder: founderAddress,
      grant, teeToken: token });
    targets = scan.targets;
    operationKey = `cleanupFinanceV2:${grant}`;
  } else if (role === 2) {
    const scan = await scanManagerReaderCleanup({ company: companyAddress, founder: founderAddress,
      grant, parentGrant, teeToken: token });
    targets = scan.targets.map((target) => ({ ...target, kind: "request" as const }));
    operationKey = `cleanupManagerV2:${grant}`;
  } else {
    const scan = await scanMemberReaderCleanup({ company: companyAddress, founder: founderAddress,
      grant, teeToken: token });
    targets = scan.targets.map((address) => ({ address, kind: "request" as const }));
    operationKey = `cleanupMember:${grant}`;
  }
  let confirmedCount = 0;
  for (const target of targets) {
    const prior = latestOnboardingReceipt(companyAddress, target.address, operationKey);
    if (prior?.status === "confirmed") {
      if (target.kind === "request") await applyConfirmedReaderCleanup(companyAddress, target.address, "all");
      confirmedCount++;
      continue;
    }
    const progress = { grant, totalTargets: targets.length, confirmedCount, target: target.address,
      targetKind: target.kind };
    if (prior && (prior.status === "pending" || waitForCleanupReceipt(prior))) {
      return { status: "wait_for_cleanup_receipt", ...progress, receiptId: prior.id,
        receiptStatus: prior.status, reconcile: `/v1/onboarding/receipts/${prior.id}/reconcile` };
    }
    const operation = target.kind === "request" ? "setRequestReadersV2" :
      target.kind === "snapshot" ? "setSnapshotReaders" : "removeFinanceAgentReader";
    const transaction = await buildOperation({ operation, actor: founderAddress,
      request: target.address, agentPolicy: target.address, includeRequester: false,
      includeFinance: false, manager: null, viewer: null,
    }, { company: companyAddress, founder: founderAddress, teeToken: token });
    const receipt = await recordOnboardingBuild({ company: companyAddress, target: target.address,
      operation: operationKey, chain: transaction.sendTo,
      transactionBase64: transaction.transactionBase64 });
    return { status: "sign_cleanup", ...progress, receiptId: receipt.id, transaction };
  }
  return { status: "ready", grant, totalTargets: targets.length, confirmedCount,
    note: "All discovered private readers were reset; verify revoked-wallet read denial." };
}

// The body is parsed once per request and memoized: the handler reads it to
// resolve the company context before routing, and individual routes re-read
// the cached value. Per-route size caps still apply to the cached length.
const MAX_REQUEST_BYTES = 131_072;
const requestBodies = new WeakMap<IncomingMessage, Promise<{ bytes: number; json: Record<string, unknown> }>>();

async function readRequestBody(req: IncomingMessage): Promise<{ bytes: number; json: Record<string, unknown> }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request too large");
    chunks.push(buf);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return { bytes: size, json: parsed as Record<string, unknown> };
}

async function readJson(req: IncomingMessage, maxBytes = 16_384): Promise<Record<string, unknown>> {
  let cached = requestBodies.get(req);
  if (!cached) {
    cached = readRequestBody(req);
    requestBodies.set(req, cached);
  }
  const { bytes, json } = await cached;
  if (bytes > maxBytes) throw new Error("Request too large");
  return json;
}

async function executionPlan(ctx: CompanyContext, requestAddress: string, actor: string,
  grantInput: unknown, token: string) {
  const companyAddress = ctx.company;
  const founderAddress = ctx.founder;
  const [policy, request, snapshot] = await Promise.all([
    readCompanyPolicy(companyAddress, token), readPaymentRequest(companyAddress, requestAddress, token),
    readTreasurySnapshot(companyAddress, token).catch(() => null),
  ]);
  const accounts = paymentExecutionAccounts(companyAddress, actor, policy, request);
  const grantAddress = actor === policy.founder ? null : asAddress(grantInput, "grant");
  if (grantAddress) {
    const grant = await readTeamGrant(companyAddress, grantAddress, token);
    if (grant.member !== actor || actor !== policy.finance || grant.grantor !== policy.founder ||
        grant.parent !== PublicKey.default.toBase58() || grant.role !== 1 ||
        grant.active !== true || grant.revoked !== false ||
        !Array.isArray(grant.recipients) || !grant.recipients.includes(accounts.recipient) ||
        BigInt(accounts.amountMicro) > BigInt(String(grant.perPaymentCapMicro))) {
      throw new Error("Finance grant does not allow this payment");
    }
  }
  const transaction = await buildOperation({
    operation: actor === founderAddress ? "executePaymentAndSync" : "executePayment",
    actor, request: requestAddress, grant: grantAddress,
    treasuryToken: accounts.treasuryToken, recipientToken: accounts.recipientToken,
  }, { company: companyAddress, founder: founderAddress, teeToken: token });
  const treasuryObservation = snapshot === null ? null : {
    balanceMicro: snapshot.balanceMicro, updatedSlot: snapshot.updatedSlot,
    coversPaymentAtLastSync: BigInt(snapshot.balanceMicro) >= BigInt(accounts.amountMicro),
  };
  return {
    requestAddress, recipient: accounts.recipient, amountMicro: accounts.amountMicro,
    treasuryObservation,
    warning: treasuryObservation?.coversPaymentAtLastSync === false
      ? "Last treasury snapshot is below this payment; fund and resync before signing" : null,
    transaction,
  };
}

async function approvalPlan(ctx: CompanyContext, requestAddress: string, actor: string, grantInput: unknown,
  parentGrantInput: unknown, token: string) {
  const companyAddress = ctx.company;
  const founderAddress = ctx.founder;
  const [policy, request] = await Promise.all([
    readCompanyPolicy(companyAddress, token), readPaymentRequest(companyAddress, requestAddress, token),
  ]);
  if (request.status !== "submitted") throw new Error("Payment request is not awaiting approval");
  let grantAddress: string | null = null;
  let parentGrantAddress: string | null = null;
  if (actor !== policy.founder) {
    grantAddress = asAddress(grantInput, "grant");
    const grant = await readTeamGrant(companyAddress, grantAddress, token);
    if (grant.member !== actor || grant.active !== true || grant.revoked !== false ||
        !Array.isArray(grant.recipients) || !grant.recipients.includes(request.recipient) ||
        BigInt(String(request.amountMicro)) > BigInt(String(grant.perPaymentCapMicro))) {
      throw new Error("Approval grant does not allow this payment");
    }
    if (grant.role === 1) {
      if (actor !== policy.finance || grant.grantor !== policy.founder ||
          grant.parent !== PublicKey.default.toBase58()) throw new Error("Invalid Finance approval grant");
    } else if (grant.role === 2) {
      const expectedScope = requestBranchScope(new PublicKey(companyAddress), String(request.id)).toBase58();
      if (grant.scope !== expectedScope) throw new Error("Manager grant does not cover this payment branch");
      parentGrantAddress = asAddress(parentGrantInput, "parentGrant");
      if (grant.parent !== parentGrantAddress) throw new Error("Manager grant has a different parent");
      const parent = await readTeamGrant(companyAddress, parentGrantAddress, token);
      if (parent.member !== grant.grantor || parent.member !== policy.finance || parent.active !== true ||
          parent.grantor !== policy.founder || parent.parent !== PublicKey.default.toBase58() ||
          parent.revoked !== false || parent.role !== 1 || parent.mayDelegate !== true) {
        throw new Error("Parent Finance grant does not authorize Manager approval");
      }
      if (BigInt(String(grant.perPaymentCapMicro)) > BigInt(String(parent.perPaymentCapMicro)) ||
          BigInt(String(grant.periodCapMicro)) > BigInt(String(parent.periodCapMicro)) ||
          !(parent.recipients as string[]).includes(request.recipient as string)) {
        throw new Error("Manager grant exceeds its active parent Finance scope");
      }
    } else {
      throw new Error("Grant role cannot approve payments");
    }
  }
  const transaction = await buildOperation({ operation: "approvePayment", actor, request: requestAddress,
    grant: grantAddress, parentGrant: parentGrantAddress },
  { company: companyAddress, founder: founderAddress, teeToken: token });
  return { requestAddress, transaction };
}

async function paymentChainObservation(signature: string, token: string): Promise<{
  status: "not_found" | "processed" | "confirmed" | "failed"; slot: number | null;
}> {
  const status = (await teeConnection(token)
    .getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  return { status: status === null ? "not_found" : status.err ? "failed" :
    status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" ? "confirmed" : "processed",
    slot: status?.slot ?? null };
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, 200, { ok: true, multiCompany: true, programId: PROGRAM_ID.toBase58(), capabilities: {
          privateReceive: process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE === "1",
          paymentExecution: process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS === "1",
          financeAgent: process.env.MERCURY_ENABLE_FINANCE_ASSISTANT === "1",
          x402: process.env.MERCURY_ENABLE_X402_AGENT === "1",
          recipientWithdraw: process.env.MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW === "1",
        } });
    }
    if (req.method === "POST" && req.url === "/v1/companies/register") {
      const body = await readJson(req);
      const context = await verifyAndRegisterCompany({ company: body.company, founder: body.founder });
      return reply(res, 200, { status: "registered", ...context,
        note: "On-chain shell verified against the founder-derived policy PDA. Private operations still require TEE access." });
    }
    if (req.method === "POST" && req.url === "/v1/companies/bootstrap/prepare") {
      const body = await readJson(req);
      const founder = asAddress(body.founder, "founder");
      const finance = asAddress(body.finance, "finance");
      const company = founderCompanyAddress(founder);
      const existing = await new Connection(BASE_RPC, "confirmed").getAccountInfo(new PublicKey(company), "confirmed");
      if (existing) return reply(res, 200, { status: "shell_exists", company });
      const transaction = await buildOperation({ operation: "initializeCompanyWorkspace", actor: founder,
        finance, mint: DEVNET_USDC }, { company, founder });
      return reply(res, 200, { status: "sign", company, mint: DEVNET_USDC, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/companies/bootstrap/submit") {
      const body = await readJson(req);
      const founder = asAddress(body.founder, "founder");
      const finance = asAddress(body.finance, "finance");
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("Signed bootstrap transaction is required");
      const company = founderCompanyAddress(founder);
      const expected = await buildOperation({ operation: "initializeCompanyWorkspace", actor: founder,
        finance, mint: DEVNET_USDC }, { company, founder });
      const verified = validateSignedCompanyBootstrap({ expectedTransactionBase64: expected.transactionBase64,
        signedTransactionBase64: body.signedTransactionBase64, founder });
      const connection = new Connection(BASE_RPC, "confirmed");
      const existing = await connection.getAccountInfo(new PublicKey(company), "confirmed");
      if (existing) return reply(res, 200, { status: "shell_exists", company, signature: verified.signature });
      let broadcast: "submitted" | "uncertain" = "submitted";
      try {
        const returned = await connection.sendRawTransaction(verified.bytes, { maxRetries: 3 });
        if (returned !== verified.signature) throw new Error("RPC returned another signature");
      } catch { broadcast = "uncertain"; }
      return reply(res, 200, { status: "pending", company, signature: verified.signature, broadcast,
        note: "Check the on-chain shell before registering or preparing another transaction." });
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/companies/bootstrap/status?")) {
      const url = new URL(req.url, "http://mercury.local");
      const founder = asAddress(url.searchParams.get("founder"), "founder");
      const company = founderCompanyAddress(founder);
      const connection = new Connection(BASE_RPC, "confirmed");
      const account = await connection.getAccountInfo(new PublicKey(company), "confirmed");
      const signature = url.searchParams.get("signature");
      const state = signature ? (await connection.getSignatureStatuses([signature],
        { searchTransactionHistory: true })).value[0] : null;
      return reply(res, 200, { company, shellExists: account !== null,
        signatureStatus: !signature ? null : !state ? "not_found" : state.err ? "failed" :
          state.confirmationStatus === "confirmed" || state.confirmationStatus === "finalized" ? "confirmed" : "processed" });
    }
    // Resolve the per-request company before any route runs. Every route below
    // sees the shadowed companyAddress/founderAddress for THIS company only.
    const requestUrl = new URL(req.url ?? "/", "http://mercury.local");
    const routePath = requestUrl.pathname;
    const parsedBody = req.method === "POST" || req.method === "PATCH" ?
      await readJson(req, MAX_REQUEST_BYTES) : null;
    const companyContext = await resolveCompany(requestedCompanySelector({
      header: req.headers["x-mercury-company"] as string | undefined,
      body: parsedBody?.company,
      query: requestUrl.searchParams.get("company"),
    }));
    const companyAddress = companyContext.company;
    const founderAddress = companyContext.founder;
    await ensureCompanyHydrated(companyAddress);
    if (req.method === "GET" && routePath === "/v1/company-context") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const actor = asAddress(requestUrl.searchParams.get("actor"), "actor");
      assertTeeTokenActor(token, actor);
      return reply(res, 200, { company: companyAddress, founder: founderAddress,
        mint: companyContext.mint, validator: companyContext.validator });
    }
    if (req.method === "POST" && routePath === "/v1/auth/tee-login/challenge") {
      return reply(res, 200, { ...await createTeeLoginChallenge({ wallet: parsedBody!.wallet }),
        company: companyAddress });
    }
    if (req.method === "POST" && routePath === "/v1/auth/tee-login") {
      const session = await completeTeeLogin({ wallet: parsedBody!.wallet, challenge: parsedBody!.challenge,
        signature: parsedBody!.signature });
      return reply(res, 200, { ...session, company: companyAddress,
        note: "This token reads only what the PER allows for this wallet. It grants no company authority by itself." });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      if (companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Onboarding currently requires a Circle devnet USDC company" });
      }
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must run company onboarding");
      const result = await inspectCompanyOnboarding({
        company: companyAddress, founder: founderAddress, finance: body.finance,
        mint: companyContext.mint,
        monthlyLimitMicro: body.monthlyLimitMicro, agentCapMicro: body.agentCapMicro,
        teeToken: token,
      });
      if (result.next.status !== "build") return reply(res, 200, result);
      const input: Record<string, unknown> = {
        operation: result.next.operation, actor,
        finance: body.finance, mint: companyContext.mint,
        monthlyLimitMicro: body.monthlyLimitMicro, agentCapMicro: body.agentCapMicro,
      };
      const transaction = await buildOperation(input as { operation: string; actor: string }, {
        company: companyAddress, founder: founderAddress, teeToken: token,
      });
      const target = result.next.operation?.includes("Snapshot") || result.next.operation?.includes("BalanceTracker")
        ? result.snapshotAddress : companyAddress;
      const receipt = await recordOnboardingBuild({
        company: companyAddress, target, operation: result.next.operation!,
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/finance-grant/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must issue the initial Finance grant");
      const result = await inspectRootFinanceGrant({
        company: companyAddress, founder: founderAddress, finance: body.finance,
        grantId: body.grantId, perPaymentCapMicro: body.perPaymentCapMicro,
        periodCapMicro: body.periodCapMicro, recipients: body.recipients,
        mayDelegate: body.mayDelegate, teeToken: token,
      });
      if (result.next.status !== "build") return reply(res, 200, result);
      const transaction = await buildOperation({
        operation: result.next.operation!, actor, member: body.finance, grantId: body.grantId,
        grant: result.grantAddress, role: "finance", parentGrant: null,
        perPaymentCapMicro: body.perPaymentCapMicro, periodCapMicro: body.periodCapMicro,
        recipients: body.recipients, mayDelegate: body.mayDelegate,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({
        company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/manager-grant/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Finance TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== asAddress(body.finance, "finance")) throw new Error("Finance must issue the Manager grant");
      const result = await inspectManagerGrant({
        company: companyAddress, founder: founderAddress, finance: actor,
        manager: body.manager, grantId: body.grantId, parentGrant: body.parentGrant,
        branchId: body.branchId, perPaymentCapMicro: body.perPaymentCapMicro,
        periodCapMicro: body.periodCapMicro, recipients: body.recipients, teeToken: token,
      });
      if (result.next.status !== "build") return reply(res, 200, result);
      const transaction = await buildOperation({
        operation: result.next.operation!, actor, member: body.manager, grantId: body.grantId,
        grant: result.grantAddress, role: "manager", parentGrant: body.parentGrant, scope: result.scopeAddress,
        perPaymentCapMicro: body.perPaymentCapMicro, periodCapMicro: body.periodCapMicro,
        recipients: body.recipients, mayDelegate: false,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({
        company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/member-grant/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must issue member grants");
      const result = await inspectMemberGrant({ company: companyAddress, founder: founderAddress,
        member: body.member, role: body.role, grantId: body.grantId, branchId: body.branchId, teeToken: token });
      if (result.next.status !== "build") return reply(res, 200, result);
      const transaction = await buildOperation({ operation: result.next.operation!, actor,
        member: body.member, grantId: body.grantId, grant: result.grantAddress,
        role: body.role, scope: result.scopeAddress, recipients: [], mayDelegate: false,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "GET" && routePath === "/v1/team-members") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const members = await listTeamMembers(companyAddress, token);
      cacheTeamDirectory(companyAddress, members);
      return reply(res, 200, { members });
    }
    const revokeGrantRoute = routePath?.match(/^\/v1\/team-grants\/([^/?]+)\/revoke\/next$/);
    if (req.method === "POST" && revokeGrantRoute) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must revoke team access");
      const grantAddress = asAddress(decodeURIComponent(revokeGrantRoute[1]!), "grant");
      const [grant, policy] = await Promise.all([
        readTeamGrant(companyAddress, grantAddress, token), readCompanyPolicy(companyAddress, token),
      ]);
      const root = grant.parent === PublicKey.default.toBase58();
      const validRoot = [1, 3, 4].includes(Number(grant.role)) && root &&
        grant.grantor === founderAddress &&
        (grant.role !== 1 || grant.member === policy.finance);
      const validManager = grant.role === 2 && !root && grant.grantor === policy.finance;
      if (!validRoot && !validManager) throw new Error("Unsupported grant hierarchy");
      const cleanup = grant.role === 1 ? "/v1/access/finance-revocation-cleanup/plan" :
        grant.role === 2 ? "/v1/access/manager-revocation-cleanup/plan" :
        "/v1/access/member-revocation-cleanup/plan";
      const cleanupBody = grant.role === 2
        ? { actor: founderAddress, grant: grantAddress, parentGrant: grant.parent }
        : { actor: founderAddress, grant: grantAddress };
      if (grant.revoked === true && grant.active === false) {
        return reply(res, 200, await nextTeamReaderCleanup(companyContext, grantAddress, Number(grant.role),
          String(grant.parent), token));
      }
      if (grant.active !== true || grant.revoked !== false) throw new Error("Grant is not active");
      const prior = latestOnboardingReceipt(companyAddress, grantAddress, "revokeGrant");
      if (prior?.status === "confirmed") {
        throw new Error("Confirmed revoke receipt disagrees with the private grant; inspect before retrying");
      }
      if (prior && (prior.status === "pending" || waitForCleanupReceipt(prior))) {
        return reply(res, 200, { status: "wait_for_receipt", grant: grantAddress,
          receiptId: prior.id, cleanup: { endpoint: cleanup, body: cleanupBody } });
      }
      const transaction = await buildOperation({ operation: "revokeGrant", actor: founderAddress,
        grant: grantAddress, parentGrant: grant.role === 2 ? grant.parent : null,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target: grantAddress,
        operation: "revokeGrant", chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "sign_revoke", grant: grantAddress,
        receiptId: receipt.id, transaction, next: `/v1/team-grants/${grantAddress}/revoke/next`,
        cleanup: { endpoint: cleanup, body: cleanupBody } });
    }
    if (req.method === "POST" && routePath?.startsWith("/v1/onboarding/receipts/") && routePath.endsWith("/submit")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = routePath.slice("/v1/onboarding/receipts/".length, -"/submit".length);
      const body = await readJson(req);
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("signedTransactionBase64 is required");
      // Local signature and message verification does not depend on an RPC
      // status lookup. A retry can only submit the same receipt-bound bytes.
      const verified = validateSignedOnboardingReceipt(id, companyAddress, body.signedTransactionBase64);
      let receipt = verified.receipt;
      if (receipt.status === "failed") return reply(res, 200, { receipt, broadcast: "failed" });
      if (receipt.status === "confirmed") return reply(res, 200, { receipt, broadcast: "already_confirmed" });
      let broadcast = "submitted";
      try {
        const connection = receipt.chain === "base"
          ? new Connection(process.env.MERCURY_BASE_SUBMIT_RPC ?? BASE_RPC, "confirmed") : teeConnection(token);
        const signature = await connection.sendRawTransaction(verified.bytes, {
          skipPreflight: receipt.chain === "ephemeral", maxRetries: 3,
        });
        if (signature !== verified.signature) throw new Error("RPC returned a different signature");
      } catch { broadcast = "uncertain"; }
      try { receipt = await confirmOnboardingReceipt(id, body.signedTransactionBase64, token); }
      catch { broadcast = "uncertain"; }
      return reply(res, 200, { receipt, broadcast });
    }
    if (req.method === "POST" && routePath?.startsWith("/v1/onboarding/receipts/") && routePath.endsWith("/confirm")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const id = routePath.slice("/v1/onboarding/receipts/".length, -"/confirm".length);
      const body = await readJson(req);
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("signedTransactionBase64 is required");
      getOnboardingReceipt(id, companyAddress);
      const receipt = await confirmOnboardingReceipt(id, body.signedTransactionBase64, token);
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupFinanceV2:") &&
          receipt.target !== companyAddress) {
        await applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupManagerV2:")) {
        await applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupMember:")) {
        await applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      return reply(res, 200, receipt);
    }
    if (req.method === "POST" && routePath?.startsWith("/v1/onboarding/receipts/") && routePath.endsWith("/reconcile")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = routePath.slice("/v1/onboarding/receipts/".length, -"/reconcile".length);
      const body = await readJson(req);
      getOnboardingReceipt(id, companyAddress);
      const receipt = typeof body.signedTransactionBase64 === "string"
        ? await confirmOnboardingReceipt(id, body.signedTransactionBase64, token)
        : await reconcileOnboardingReceipt(id, companyAddress, token);
      if (receipt.status === "confirmed" && /^(cleanupFinanceV2:|cleanupManagerV2:|cleanupMember:)/.test(receipt.operation) &&
          receipt.target !== companyAddress) {
        await applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      return reply(res, 200, { receipt, next: receipt.status === "built" ? "provide_original_signed_transaction_or_inspect_target_state"
        : receipt.status === "pending" ? "wait_and_reconcile_same_signature"
        : receipt.status === "confirmed" ? "continue_guided_flow" : "inspect_target_before_rebuilding" });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/recipient/next") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Recipient onboarding requires the verified Circle devnet USDC receive flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Recipient TEE auth token required");
      const body = await readJson(req);
      const recipient = asAddress(body.recipient, "recipient");
      if (body.depositId !== undefined &&
          (typeof body.depositId !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(body.depositId))) {
        throw new Error("depositId must be 1 to 48 letters, digits, underscores, or hyphens");
      }
      const depositId = body.depositId ?? "initial";
      const target = `${recipient}:${depositId}`;
      const result = await nextRecipientOnboarding({
        recipient, payer: body.payer, amountMicro: body.amountMicro, teeToken: token,
        receipt: latestOnboardingReceipt(companyAddress, target, "recipientDeposit"),
      });
      if (!result.transaction) return reply(res, 200, result);
      const receipt = await recordOnboardingBuild({
        company: companyAddress, target, operation: "recipientDeposit",
        chain: result.transaction.sendTo, transactionBase64: result.transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, receiptId: receipt.id });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/agent/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must configure agent policy");
      assertTeeTokenActor(token, actor);
      const result = await inspectAgentOnboarding({ company: companyAddress, founder: founderAddress,
        agent: body.agent, recipient: body.recipient, perPaymentCapMicro: body.perPaymentCapMicro,
        periodCapMicro: body.periodCapMicro, teeToken: token });
      if (result.next.status !== "build") return reply(res, 200, result);
      const operation = result.next.operation!;
      let prior = latestOnboardingReceipt(companyAddress, result.agentPolicyAddress, operation);
      if (prior?.status === "built") prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
      if (prior && (prior.status === "built" || prior.status === "pending" || prior.status === "confirmed")) {
        return reply(res, 200, { ...result, next: { status: "wait", operation: null,
          reason: "Reconcile the prior agent policy receipt before continuing" },
          receiptId: prior.id, receiptStatus: prior.status });
      }
      const transaction = await buildOperation({ operation, actor, agent: body.agent,
        agentPolicy: result.agentPolicyAddress, recipient: body.recipient,
        perPaymentCapMicro: body.perPaymentCapMicro, periodCapMicro: body.periodCapMicro },
      { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress,
        target: result.agentPolicyAddress, operation, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if ((req.method === "GET" || req.method === "POST") && routePath === "/v1/onboarding/company-funding/resume") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Treasury funding requires the verified Circle devnet USDC receive flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      assertTeeTokenActor(token, founderAddress);
      const journal = listOnboardingReceipts(companyAddress);
      const target = resumableFundingTarget(journal);
      if (!target) return reply(res, 200, { status: "ready", receiptId: null, transaction: null });
      let prior = latestOnboardingReceipt(companyAddress, target, "syncTreasurySnapshot");
      if (prior?.status === "pending") prior = await reconcileOnboardingReceipt(prior.id, companyAddress, token);
      if (prior?.status === "confirmed") {
        return reply(res, 200, { status: "ready", receiptId: prior.id, transaction: null });
      }
      if (req.method === "GET") {
        return reply(res, 200, { status: prior?.status === "built" || prior?.status === "pending"
          ? "wait_for_receipt" : "resume_snapshot_sync",
          receiptId: prior?.id ?? null, transaction: null });
      }
      if (prior?.status === "built") prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
      if (prior && (prior.status === "built" || prior.status === "pending")) {
        return reply(res, 200, { status: "wait_for_receipt", receiptId: prior.id, transaction: null });
      }
      const transaction = await buildOperation({ operation: "syncTreasurySnapshot", actor: founderAddress,
        treasuryToken: canonicalTokenAccount(companyAddress, DEVNET_USDC),
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target,
        operation: "syncTreasurySnapshot", chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build_snapshot_sync", receiptId: receipt.id, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/company-funding/next") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Treasury funding requires the verified Circle devnet USDC receive flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must start treasury funding");
      const payer = asAddress(body.payer, "payer");
      const amountMicro = asMicroAmount(body.amountMicro);
      const targetBalanceMicro = asMicroAmount(body.targetBalanceMicro);
      if (typeof body.fundingId !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(body.fundingId)) {
        throw new Error("fundingId must be 1 to 48 letters, digits, underscores, or hyphens");
      }
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) {
        throw new Error("Private company policy does not match this funding request");
      }
      const target = `${companyAddress}:${body.fundingId}`;
      const prior = latestOnboardingReceipt(companyAddress, target, "privateReceive");
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch((error: unknown) => {
        if (error instanceof Error && (error.message === "Private treasury snapshot has not been synchronized" ||
            error.message === "Private TreasurySnapshot unavailable")) return null;
        throw error;
      });
      const next = nextTreasuryFundingStep(snapshot?.balanceMicro ?? null, targetBalanceMicro, prior?.status ?? null);
      if (next === "ready" || next === "wait_for_receipt") {
        return reply(res, 200, { status: next, observedBalanceMicro: snapshot?.balanceMicro ?? null,
          receiptId: prior?.id ?? null, transaction: null });
      }
      if (next === "build_deposit") {
        const transaction = await preparePrivateReceive({
          payer, company: companyAddress, amountMicro, teeToken: token,
          cluster: process.env.MAGICBLOCK_CLUSTER ?? "devnet-private",
          expectedValidator: TEE_VALIDATOR.toBase58(),
          privacy: body.privacy,
        });
        const receipt = await recordOnboardingBuild({
          company: companyAddress, target, operation: "privateReceive",
          chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
        });
        return reply(res, 200, { status: next, observedBalanceMicro: snapshot?.balanceMicro ?? null,
          receiptId: receipt.id, transaction });
      }
      const transaction = await buildOperation({
        operation: "syncTreasurySnapshot", actor: founderAddress,
        treasuryToken: canonicalTokenAccount(companyAddress, DEVNET_USDC),
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({
        company: companyAddress, target, operation: "syncTreasurySnapshot",
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { status: next, observedBalanceMicro: snapshot?.balanceMicro ?? null,
        receiptId: receipt.id, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/access/finance-revocation-cleanup/plan") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must run Finance reader cleanup");
      const scan = await scanFinanceReaderCleanup({
        company: companyAddress, founder: founderAddress, grant: body.grant, teeToken: token,
        recordedReaders: await recordedPaymentFlowReaders(companyAddress),
      });
      const operationKey = `cleanupFinanceV2:${scan.grant}`;
      const pending = [];
      for (const target of scan.targets) {
        const prior = latestOnboardingReceipt(companyAddress, target.address, operationKey);
        if (prior?.status === "confirmed") {
          if (target.kind === "request") await applyConfirmedReaderCleanup(companyAddress, target.address, "all");
          continue;
        }
        if (prior && waitForCleanupReceipt(prior)) {
          pending.push({ target: target.address, kind: target.kind, receiptId: prior.id, transaction: null });
          continue;
        }
        if (pending.length >= 10) break;
        const transaction = await buildOperation({
          operation: target.kind === "request" ? "setRequestReadersV2" :
            target.kind === "snapshot" ? "setSnapshotReaders" : "removeFinanceAgentReader",
          actor: founderAddress, request: target.address, includeRequester: false,
          includeFinance: false, manager: null, viewer: null, agentPolicy: target.address,
        }, { company: companyAddress, founder: founderAddress, teeToken: token });
        const receipt = await recordOnboardingBuild({
          company: companyAddress, target: target.address, operation: operationKey,
          chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
        });
        pending.push({ target: target.address, kind: target.kind, receiptId: receipt.id, transaction });
      }
      const confirmedCount = scan.targets.filter((target) =>
        latestOnboardingReceipt(companyAddress, target.address, operationKey)?.status === "confirmed").length;
      return reply(res, 200, {
        status: confirmedCount === scan.targets.length ? "ready" : "cleanup_required",
        grant: scan.grant, totalTargets: scan.targets.length, confirmedCount, pending,
        residualReadAccess: {
          financeOwnedRequests: scan.financeOwnedRequests,
          agentPolicies: scan.agentPolicies.filter((address) =>
            latestOnboardingReceipt(companyAddress, address, operationKey)?.status !== "confirmed"),
          historicalResetRequests: scan.historicalResetRequests,
        },
      });
    }
    if (req.method === "POST" && routePath === "/v1/access/manager-revocation-cleanup/plan") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must run Manager reader cleanup");
      const scan = await scanManagerReaderCleanup({
        company: companyAddress, founder: founderAddress, grant: body.grant,
        parentGrant: body.parentGrant, teeToken: token,
        recordedReaders: await recordedPaymentFlowReaders(companyAddress),
      });
      const operationKey = `cleanupManagerV2:${scan.grant}`;
      const pending = [];
      for (const target of scan.targets) {
        const prior = latestOnboardingReceipt(companyAddress, target.address, operationKey);
        if (prior?.status === "confirmed") {
          await applyConfirmedReaderCleanup(companyAddress, target.address, "all");
          continue;
        }
        if (prior && waitForCleanupReceipt(prior)) {
          pending.push({ target: target.address, receiptId: prior.id, transaction: null });
          continue;
        }
        if (pending.length >= 10) break;
        const transaction = await buildOperation({
          operation: "setRequestReadersV2", actor: founderAddress, request: target.address,
          includeRequester: false, includeFinance: false, manager: null, viewer: null,
        }, { company: companyAddress, founder: founderAddress, teeToken: token });
        const receipt = await recordOnboardingBuild({
          company: companyAddress, target: target.address, operation: operationKey,
          chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
        });
        pending.push({ target: target.address, receiptId: receipt.id, transaction });
      }
      const confirmedCount = scan.targets.filter((target) =>
        latestOnboardingReceipt(companyAddress, target.address, operationKey)?.status === "confirmed").length;
      return reply(res, 200, {
        status: confirmedCount === scan.targets.length ? "ready" : "cleanup_required",
        grant: scan.grant, manager: scan.manager, totalTargets: scan.targets.length, confirmedCount, pending,
        residualReadAccess: { managerOwnedRequests: scan.managerOwnedRequests,
          historicalResetRequests: scan.historicalResetRequests },
      });
    }
    if (req.method === "POST" && routePath === "/v1/access/member-revocation-cleanup/plan") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must run member reader cleanup");
      const scan = await scanMemberReaderCleanup({ company: companyAddress, founder: founderAddress,
        grant: body.grant, teeToken: token });
      const operationKey = `cleanupMember:${scan.grant}`;
      const pending = [];
      for (const address of scan.targets) {
        const prior = latestOnboardingReceipt(companyAddress, address, operationKey);
        if (prior?.status === "confirmed") {
          await applyConfirmedReaderCleanup(companyAddress, address, "all");
          continue;
        }
        if (prior && waitForCleanupReceipt(prior)) {
          pending.push({ target: address, receiptId: prior.id, transaction: null });
          continue;
        }
        if (pending.length >= 10) break;
        const transaction = await buildOperation({ operation: "setRequestReadersV2",
          actor: founderAddress, request: address, includeRequester: false,
          includeFinance: false, manager: null, viewer: null,
        }, { company: companyAddress, founder: founderAddress, teeToken: token });
        const receipt = await recordOnboardingBuild({ company: companyAddress, target: address,
          operation: operationKey, chain: transaction.sendTo,
          transactionBase64: transaction.transactionBase64 });
        pending.push({ target: address, receiptId: receipt.id, transaction });
      }
      const confirmedCount = scan.targets.filter((address) =>
        latestOnboardingReceipt(companyAddress, address, operationKey)?.status === "confirmed").length;
      return reply(res, 200, { status: confirmedCount === scan.targets.length ? "ready" : "cleanup_required",
        ...scan, totalTargets: scan.targets.length, confirmedCount, pending });
    }
    if (req.method === "POST" && (routePath === "/v1/access/request-viewer/build" ||
        routePath === "/v1/access/request-viewer/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must share a request");
      const requestAddress = asAddress(body.request, "request");
      const viewerGrantAddress = asAddress(body.viewerGrant, "viewerGrant");
      const [request, viewerGrant, policy] = await Promise.all([
        readPaymentRequest(companyAddress, requestAddress, token),
        readTeamGrant(companyAddress, viewerGrantAddress, token),
        readCompanyPolicy(companyAddress, token),
      ]);
      const viewer = asAddress(body.viewer, "viewer");
      if (viewer === request.requester || viewer === policy.finance || viewer === founderAddress) {
        throw new Error("Viewer must be distinct from Founder, Finance, and requester");
      }
      if (viewerGrant.member !== viewer || viewerGrant.grantor !== founderAddress ||
          viewerGrant.role !== 4 || viewerGrant.active !== true || viewerGrant.revoked !== false ||
          (viewerGrant.scope !== PublicKey.default.toBase58() &&
            viewerGrant.scope !== requestBranchScope(new PublicKey(companyAddress), String(request.id)).toBase58())) {
        throw new Error("Active Viewer grant does not cover this request");
      }
      if (body.includeRequester !== true && body.includeRequester !== false) {
        throw new Error("includeRequester must be boolean");
      }
      if (body.includeRequester && request.requester !== founderAddress) {
        const requesterGrantAddress = asAddress(body.requesterGrant, "requesterGrant");
        const requesterGrant = await readTeamGrant(companyAddress, requesterGrantAddress, token);
        const requesterIsFinance = request.requester === policy.finance;
        if (requesterGrant.member !== request.requester || requesterGrant.grantor !== founderAddress ||
            requesterGrant.role !== (requesterIsFinance ? 1 : 3) ||
            requesterGrant.active !== true || requesterGrant.revoked !== false ||
            (!requesterIsFinance && requesterGrant.scope !== PublicKey.default.toBase58() &&
              requesterGrant.scope !== requestBranchScope(new PublicKey(companyAddress), String(request.id)).toBase58())) {
          throw new Error("Active requester grant is required to keep requester access");
        }
      }
      const readers = (await recordedPaymentFlowReaders(companyAddress)).get(requestAddress);
      if (!readers) throw new Error("Request reader scope is unavailable; sharing would replace unknown private readers");
      const activeGrants = (await listTeamMembers(companyAddress, token)).flatMap((entry) => entry.grants);
      const branchScope = requestBranchScope(new PublicKey(companyAddress), String(request.id)).toBase58();
      const includeFinance = readers.includeFinance && request.requester !== policy.finance &&
        activeGrants.some((grant) => grant.member === policy.finance && grant.role === 1 &&
          grant.grantor === founderAddress && grant.active === true && grant.revoked === false);
      const manager = readers.manager && !(body.includeRequester && readers.manager === request.requester) &&
        activeGrants.some((grant) => grant.member === readers.manager &&
        grant.role === 2 && grant.scope === branchScope && grant.active === true && grant.revoked === false)
        ? readers.manager : null;
      if (viewer === manager) throw new Error("Viewer wallet is already the Manager reader");
      const transaction = await buildOperation({ operation: "setRequestReadersV2",
        actor: founderAddress, request: requestAddress, includeRequester: body.includeRequester,
        includeFinance, manager, viewer, viewerGrant: viewerGrantAddress,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      if (routePath === "/v1/access/request-viewer/next") {
        const operation = `shareViewer:${viewer}:${body.includeRequester}`;
        const prior = latestOnboardingReceipt(companyAddress, requestAddress, operation);
        if (prior && (prior.status === "built" || prior.status === "pending")) {
          return reply(res, 200, { status: "wait", request: requestAddress,
            viewer, receiptId: prior.id, receiptStatus: prior.status });
        }
        const receipt = await recordOnboardingBuild({ company: companyAddress,
          target: requestAddress, operation, chain: transaction.sendTo,
          transactionBase64: transaction.transactionBase64 });
        return reply(res, 200, { status: "build", request: requestAddress,
          viewer, transaction, receiptId: receipt.id });
      }
      return reply(res, 200, { status: "unsigned", request: requestAddress, viewer, transaction });
    }
    if (req.method === "POST" && (routePath === "/v1/access/policy-readers/restore/build" ||
        routePath === "/v1/access/policy-readers/restore/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must restore policy readers");
      const grantAddress = asAddress(body.grant, "grant");
      const [policy, grant] = await Promise.all([
        readCompanyPolicy(companyAddress, token), readTeamGrant(companyAddress, grantAddress, token),
      ]);
      if (grant.role !== 1 || grant.member !== policy.finance || grant.grantor !== founderAddress ||
          grant.parent !== PublicKey.default.toBase58() || grant.active !== true || grant.revoked !== false) {
        throw new Error("Active Founder-issued Finance grant is required");
      }
      const transaction = await buildOperation({ operation: "restorePolicyReaders",
        actor: founderAddress, grant: grantAddress,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      if (routePath === "/v1/access/policy-readers/restore/next") {
        let prior = latestOnboardingReceipt(companyAddress, companyAddress, `restorePolicyReaders:${grantAddress}`);
        if (prior?.status === "built") prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
        if (prior && (prior.status === "built" || prior.status === "pending")) {
          return reply(res, 200, { status: "wait", grant: grantAddress,
            receiptId: prior.id, receiptStatus: prior.status });
        }
        const receipt = await recordOnboardingBuild({ company: companyAddress, target: companyAddress,
          operation: `restorePolicyReaders:${grantAddress}`, chain: transaction.sendTo,
          transactionBase64: transaction.transactionBase64 });
        return reply(res, 200, { status: "build", grant: grantAddress,
          transaction, receiptId: receipt.id });
      }
      return reply(res, 200, { status: "unsigned", grant: grantAddress, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/assistant/challenge") {
      if (process.env.MERCURY_ENABLE_FINANCE_ASSISTANT !== "1") return reply(res, 503, { error: "Finance assistant is disabled" });
      const body = await readJson(req);
      return reply(res, 200, await createPersistentAssistantChallenge(companyAddress, body.actor,
        Date.now(), x402PurchaseIntent(body)));
    }
    if (req.method === "POST" && routePath === "/v1/assistant/query") {
      if (process.env.MERCURY_ENABLE_FINANCE_ASSISTANT !== "1") return reply(res, 503, { error: "Finance assistant is disabled" });
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = await consumePersistentAssistantChallenge({ company: companyAddress, actor: body.actor,
        challengeId: body.challengeId, signature: body.signature });
      assertTeeTokenActor(token, actor);
      const access = await resolveAssistantAccess({ company: companyAddress, founder: founderAddress,
        actor, grant: body.grant, teeToken: token });
      const intent = await classifyAssistantQuestion({ question: body.question,
        modelUrl: process.env.MERCURY_LLM_URL ?? "", modelName: process.env.MERCURY_LLM_MODEL ?? "",
        modelApiKey: process.env.MERCURY_LLM_API_KEY,
        allowRemoteModel: process.env.MERCURY_ALLOW_REMOTE_LLM === "1" });
      return reply(res, 200, await answerAssistantQuestion({ company: companyAddress, access, teeToken: token,
        intent, requestAddress: body.requestAddress }));
    }
    if (req.method === "POST" && routePath === "/v1/agent/chat") {
      if (process.env.MERCURY_ENABLE_FINANCE_ASSISTANT !== "1") return reply(res, 503, { error: "Mercury agent is disabled" });
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req, 70_000);
      const actor = await consumePersistentAssistantChallenge({ company: companyAddress, actor: body.actor,
        challengeId: body.challengeId, signature: body.signature,
        x402Intent: x402PurchaseIntent(body) });
      assertTeeTokenActor(token, actor);
      enforceAgentRateLimit(companyAddress, actor);
      const grant = typeof body.grant === "string" ? body.grant : null;
      try {
      const result = await runMercuryAgent({ company: companyAddress, founder: founderAddress,
        actor, grant: body.grant, teeToken: token, message: body.message,
        requestedTool: body.requestedTool,
        sessionId: body.sessionId, useSessions: true,
        auditTool: (entry) => appendAgentAudit({ company: companyAddress, actor, grant,
          event: "tool", tool: entry.tool, details: {
            arguments: entry.arguments, result: entry.result,
          } }),
        requestAddress: body.requestAddress, selectedPayeeId: body.selectedPayeeId,
        selectedRecipient: body.selectedRecipient, selectedAmountMicro: body.selectedAmountMicro,
        paymentId: body.paymentId, selectedPayrollRunId: body.selectedPayrollRunId,
        selectedPayrollItems: body.selectedPayrollItems,
        invoiceText: body.invoiceText, selectedVendorId: body.selectedVendorId,
        vendorRegistry: process.env.MERCURY_VENDOR_REGISTRY_JSON ?
          parseVendorRegistry(process.env.MERCURY_VENDOR_REGISTRY_JSON) : undefined,
        reserveInvoice: databaseInvoices ? async (invoice) => databaseInvoices.reserve({
          company: invoice.company, vendorId: invoice.vendorId, invoiceNumber: invoice.invoiceNumber,
          agent: invoice.agent, recipient: invoice.recipient, amountMicro: invoice.amountMicro,
          createFlow: getOrCreatePaymentFlow,
        }) : reserveInvoiceFlow,
        selectedX402ServiceId: body.selectedX402ServiceId, x402TaskId: body.x402TaskId,
        allowX402Purchase: process.env.MERCURY_ENABLE_X402_AGENT === "1" && body.allowX402Purchase === true,
        x402Registry: process.env.MERCURY_X402_SERVICES_JSON ?
          parseX402Registry(process.env.MERCURY_X402_SERVICES_JSON) : undefined,
        x402SignerSecret: process.env.MERCURY_ENABLE_X402_AGENT === "1" ?
          configuredX402SignerSecret() : undefined,
        x402RpcUrl: process.env.MERCURY_X402_RPC_URL ?? BASE_RPC,
        modelUrl: process.env.MERCURY_AGENT_MODEL_URL ??
          "https://api.fireworks.ai/inference/v1/chat/completions",
        modelName: process.env.MERCURY_AGENT_MODEL ??
          "accounts/fireworks/models/kimi-k3",
        reasoningEffort: (process.env.MERCURY_AGENT_REASONING_EFFORT ?? "low") as "low" | "high" | "max",
        modelApiKey: process.env.MERCURY_FIREWORKS_API_KEY ?? process.env.MERCURY_AGENT_MODEL_API_KEY,
        allowRemoteModel: process.env.MERCURY_ALLOW_REMOTE_LLM === "1" });
      if (typeof result.paymentId === "string") {
        await persistLegacyPaymentFlow(result.paymentId, companyAddress);
      }
      await appendAgentAudit({ company: companyAddress, actor, grant, event: "completed",
        details: { sessionId: result.sessionId, toolCount: (result.actions as unknown[]).length } });
      return reply(res, 200, result);
      } catch (error) {
        await appendAgentAudit({ company: companyAddress, actor, grant, event: "failed",
          details: { reason: error instanceof Error ? error.message : "Unknown error" } });
        throw error;
      }
    }
    if (req.method === "POST" && routePath === "/v1/agent/audit") {
      if (process.env.MERCURY_ENABLE_FINANCE_ASSISTANT !== "1") return reply(res, 503, { error: "Mercury agent is disabled" });
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = await consumePersistentAssistantChallenge({ company: companyAddress, actor: body.actor,
        challengeId: body.challengeId, signature: body.signature });
      assertTeeTokenActor(token, actor);
      await resolveAssistantAccess({ company: companyAddress, founder: founderAddress,
        actor, grant: body.grant, teeToken: token });
      const grant = typeof body.grant === "string" ? body.grant : null;
      return reply(res, 200, { events: await listAgentAudit(companyAddress, actor, grant,
        body.limit === undefined ? 50 : Number(body.limit)) });
    }
    if (req.method === "POST" && routePath === "/v1/agent/invoice-suggestions") {
      if (process.env.MERCURY_ENABLE_INVOICE_AGENT !== "1") return reply(res, 503, { error: "Invoice agent is disabled" });
      if (!matchesAgentApiKey(req.headers.authorization)) return reply(res, 401, { error: "Agent API key required" });
      if (companyContext.mint !== DEVNET_USDC) throw new Error("Invoice agent requires the Circle devnet USDC company");
      const body = await readJson(req);
      const suggestion = await suggestInvoicePayment({
        invoiceText: body.invoiceText,
        vendorId: body.vendorId,
        companyAddress,
        founderAddress,
        agentAddress: asAddress(process.env.MERCURY_SUGGEST_AGENT_ADDRESS, "MERCURY_SUGGEST_AGENT_ADDRESS"),
        registry: parseVendorRegistry(process.env.MERCURY_VENDOR_REGISTRY_JSON ?? ""),
        modelUrl: process.env.MERCURY_LLM_URL ?? "",
        modelName: process.env.MERCURY_LLM_MODEL ?? "",
        modelApiKey: process.env.MERCURY_LLM_API_KEY,
        allowRemoteModel: process.env.MERCURY_ALLOW_REMOTE_LLM === "1",
      });
      const linked = databaseInvoices ? await databaseInvoices.reserve({
        company: companyAddress, vendorId: String(suggestion.vendorId),
        invoiceNumber: String(suggestion.invoiceNumber), agent: String(suggestion.agent),
        recipient: String(suggestion.recipient), amountMicro: String(suggestion.amountMicro), createFlow: getOrCreatePaymentFlow,
      }) : reserveInvoiceFlow({ company: companyAddress, vendorId: String(suggestion.vendorId),
        invoiceNumber: String(suggestion.invoiceNumber), agent: String(suggestion.agent),
        recipient: String(suggestion.recipient), amountMicro: String(suggestion.amountMicro) });
      await persistLegacyPaymentFlow(linked.paymentId, companyAddress);
      const { requestPlan: _requestPlan, nextStep: _nextStep, ...draft } = suggestion;
      return reply(res, 200, {
        ...draft, ...linked,
        guidedFlow: `/v1/payment-flows/${linked.paymentId}/next`,
        flowTerms: {
          requester: suggestion.agent, recipient: suggestion.recipient,
          amountMicro: Number(suggestion.amountMicro), includeFinance: true,
        },
        nextStep: "Review the draft. The Agent needs a Founder-issued Requester grant and signs request steps; Founder activates privacy; Founder or Finance approves and executes the private payment.",
      });
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/delegation/")) {
      const account = decodeURIComponent(routePath.slice("/v1/delegation/".length));
      return reply(res, 200, { account, status: await delegationStatus({ account }) });
    }
    if (req.method === "GET" && routePath === "/v1/treasury-snapshot") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      return reply(res, 200, await readTreasurySnapshot(companyAddress, token));
    }
    if (req.method === "GET" && routePath === "/v1/company-policy") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      return reply(res, 200, await readCompanyPolicy(companyAddress, token));
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/payment-requests/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const request = decodeURIComponent(routePath.slice("/v1/payment-requests/".length));
      return reply(res, 200, await readPaymentRequest(companyAddress, request, token));
    }
    if (req.method === "POST" && routePath === "/v1/payment-jobs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const requestAddress = asAddress(body.request, "request");
      const request = await readPaymentRequest(companyAddress, requestAddress, token);
      const derived = paymentRequestAddress(new PublicKey(companyAddress),
        new PublicKey(String(request.requester)), new BN(String(request.id)));
      if (derived.toBase58() !== requestAddress) throw new Error("Request address does not match its private identity");
      const record = await registerPayment({ paymentId: body.paymentId, company: companyAddress,
        request: requestAddress, requester: String(request.requester), requestId: String(request.id) });
      return reply(res, 200, { record: await reconcilePayment(record.paymentId, companyAddress, String(request.status), null),
        requestStatus: request.status });
    }
    if (routePath === "/v1/payees" && (req.method === "GET" || req.method === "POST")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      if (req.method === "GET") {
        const policy = await readCompanyPolicy(companyAddress, token);
        if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
        return reply(res, 200, { payees: (await listPayees(companyAddress)).map(({ recipientHash, ...payee }) => payee) });
      }
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must register a payee");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      const { recipientHash, ...payee } = await registerPayee(companyAddress, body);
      return reply(res, 200, { payee });
    }
    const deactivate = routePath?.match(/^\/v1\/payees\/([^/?]+)\/deactivate$/);
    if (deactivate && req.method === "POST") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must deactivate a payee");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      const { recipientHash, ...payee } = await deactivatePayee(companyAddress, deactivate[1]);
      return reply(res, 200, { payee });
    }
    if (req.method === "GET" && routePath === "/v1/compliance/audits") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      return reply(res, 200, { audits: listAuditShares(companyAddress) });
    }
    if (req.method === "POST" && routePath === "/v1/compliance/audits") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must create auditor access");
      const policy = await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      if (policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      const expiresInDays = body.expiresInDays === undefined ? 30 : body.expiresInDays;
      if (!Number.isInteger(expiresInDays) || Number(expiresInDays) < 1 || Number(expiresInDays) > 365) {
        throw new Error("expiresInDays must be an integer from 1 to 365");
      }
      const bundle = await buildAuditBundle(companyContext, body, token);
      const created = createAuditShare({ company: companyAddress, label: body.label,
        expiresAt: new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString(),
        period: { from: bundle.period.from, to: bundle.period.to }, actor, bundle });
      return reply(res, 201, { audit: created.share, auditorAccess: {
        endpoint: `/v1/compliance/audits/${created.share.auditId}`,
        token: created.token,
        authentication: "Authorization: Bearer <auditor token>",
        note: "The auditor can read this frozen payroll snapshot only. It cannot execute payments or read the live treasury.",
      } });
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/compliance/audit-events")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      const url = requestUrl;
      const auditId = url.searchParams.get("auditId") ?? undefined;
      return reply(res, 200, { events: listAuditEvents(companyAddress, auditId) });
    }
    const complianceAudit = routePath?.match(/^\/v1\/compliance\/audits\/([^/?]+)(?:\/(revoke))?$/);
    if (complianceAudit && req.method === "GET" && !complianceAudit[2]) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Auditor token required");
      return reply(res, 200, openAuditShare(companyAddress, complianceAudit[1], token));
    }
    if (complianceAudit && req.method === "POST" && complianceAudit[2] === "revoke") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must revoke auditor access");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      return reply(res, 200, { audit: revokeAuditShare(companyAddress, complianceAudit[1], actor) });
    }
    if (routePath === "/v1/payroll-schedules" && (req.method === "GET" || req.method === "POST")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      if (req.method === "GET") return reply(res, 200, {
        schedules: listPayrollSchedules(companyAddress).map((schedule) => payrollScheduleView(schedule)),
      });
      const body = await readJson(req, 90_000);
      verifyPayrollScheduleFounder("create", companyAddress, founderAddress, body);
      const schedule = createPayrollSchedule(companyAddress, body);
      await persistPayrollSchedule(schedule);
      return reply(res, 200, payrollScheduleView(schedule));
    }
    const payrollSchedule = routePath?.match(/^\/v1\/payroll-schedules\/([^/?]+)(?:\/(launch))?$/);
    if (payrollSchedule && ["GET", "PATCH", "POST"].includes(req.method ?? "")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      if (req.method === "GET" && !payrollSchedule[2]) {
        const schedule = getPayrollSchedule(companyAddress, payrollSchedule[1]);
        return reply(res, 200, { ...payrollScheduleView(schedule), encryptedRoster: schedule.encryptedRoster });
      }
      const body = await readJson(req, 90_000);
      if (req.method === "PATCH" && !payrollSchedule[2]) {
        verifyPayrollScheduleFounder("update", companyAddress, founderAddress, body, payrollSchedule[1]);
        const schedule = updatePayrollSchedule(companyAddress, payrollSchedule[1], body);
        await persistPayrollSchedule(schedule);
        return reply(res, 200, payrollScheduleView(schedule));
      }
      if (req.method === "POST" && payrollSchedule[2] === "launch") {
        verifyPayrollScheduleFounder("launch", companyAddress, founderAddress, body, payrollSchedule[1]);
        if (asAddress(body.requester, "requester") !== founderAddress) throw new Error("Founder must launch this MVP payroll run");
        const launched = launchScheduledPayroll(companyAddress, payrollSchedule[1], body);
        // A schedule creates the same immutable payroll run shape as the manual
        // route. Persist it before returning its payment-flow links so a restart
        // cannot make a launched cycle disappear from the run index.
        await persistPayrollRun(getPayrollRun(launched.runId, companyAddress));
        await Promise.all(launched.items.map((item) => persistLegacyPaymentFlow(item.paymentId, companyAddress)));
        return reply(res, 200, launched);
      }
    }
    if (req.method === "POST" && routePath === "/v1/payroll-runs/preview") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req, 70_000);
      const [policy, snapshot] = await Promise.all([
        readCompanyPolicy(companyAddress, token), readTreasurySnapshot(companyAddress, token).catch(() => null),
      ]);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      const preview = previewPayrollCsv(body.csvText);
      const available = BigInt(String(policy.monthlyLimitMicro)) - BigInt(String(policy.spentMicro)) -
        BigInt(String(policy.reservedMicro));
      const total = BigInt(preview.totalMicro);
      return reply(res, 200, { ...preview, remainingPolicyBudgetMicro: available.toString(),
        budgetCoversValidRows: preview.errors.length === 0 && available >= total,
        snapshotBalanceMicro: snapshot?.balanceMicro ?? null,
        snapshotCoversValidRows: snapshot ? BigInt(snapshot.balanceMicro) >= total : null,
        snapshotUpdatedSlot: snapshot?.updatedSlot ?? null,
        note: "Snapshot can be stale; contract rechecks the current period budget and token balance at approval and payout" });
    }
    if (req.method === "POST" && routePath === "/v1/payroll-runs/readiness") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req, 70_000);
      const [policy, snapshot, readiness] = await Promise.all([
        readCompanyPolicy(companyAddress, token),
        readTreasurySnapshot(companyAddress, token).catch(() => null),
        checkPayrollReadiness({ items: body.items, isRegistered: hasConfirmedRecipientDeposit }),
      ]);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      const total = BigInt(readiness.totalMicro);
      const remainingPolicyBudgetMicro = BigInt(String(policy.monthlyLimitMicro)) - BigInt(String(policy.spentMicro)) -
        BigInt(String(policy.reservedMicro));
      const recipientsReady = readiness.readyCount === readiness.items.length;
      const snapshotCoversTotal = snapshot === null ? null : BigInt(snapshot.balanceMicro) >= total;
      return reply(res, 200, { ...readiness, recipientsReady,
        remainingPolicyBudgetMicro: remainingPolicyBudgetMicro.toString(),
        policyCoversTotal: remainingPolicyBudgetMicro >= total,
        snapshotBalanceMicro: snapshot?.balanceMicro ?? null, snapshotCoversTotal,
        canCreateRun: recipientsReady && remainingPolicyBudgetMicro >= total && snapshotCoversTotal === true,
        note: "This is a private preflight only. The contract rechecks budget and token balance before each payout." });
    }
    if (req.method === "POST" && routePath === "/v1/payroll-runs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.requester, "requester") !== founderAddress) throw new Error("Founder must create this MVP payroll run");
      const policy = await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      if (policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      const run = createPayrollRun(body.runId, companyAddress, body);
      await persistPayrollRun(run);
      await Promise.all(run.items.map((item) => persistLegacyPaymentFlow(item.paymentId, companyAddress)));
      return reply(res, 200, { runId: run.runId, items: run.items.map((item, index) => ({
        index, paymentId: item.paymentId, request: item.request,
        next: `/v1/payment-flows/${item.paymentId}/next`,
      })), approve: `/v1/payroll-runs/${run.runId}/approve`, status: `/v1/payroll-runs/${run.runId}` });
    }
    if (req.method === "GET" && routePath === "/v1/payroll-runs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      return reply(res, 200, { runs: (await listStoredPayrollRuns(companyAddress)).map((run) => ({
        ...run, status: `/v1/payroll-runs/${run.runId}`,
      })) });
    }
    const payrollRun = routePath?.match(/^\/v1\/payroll-runs\/([^/?]+)(?:\/(approve|recover))?$/);
    if (payrollRun && req.method === "GET" && !payrollRun[2]) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      const run = await getStoredPayrollRun(payrollRun[1], companyAddress);
      const items = [];
      for (let offset = 0; offset < run.items.length; offset += 5) {
        const batch = await Promise.all(run.items.slice(offset, offset + 5).map(async (item) => {
          const inspected = await inspectPaymentFlow(await getPaymentFlow(item.paymentId, companyAddress), founderAddress, token);
          const requestStatus = inspected.observation.status;
          const privateRequest = inspected.observation.privateReady && requestStatus !== "empty"
            ? await readPaymentRequest(companyAddress, item.request, token) : null;
          const amountMicro = privateRequest ? String(privateRequest.amountMicro) : null;
          const recipient = privateRequest ? String(privateRequest.recipient) : null;
          let payment = null;
          if (["approved", "executed", "rejected"].includes(requestStatus)) {
            const record = await registerPayment({ paymentId: item.paymentId, company: companyAddress,
              request: item.request, requester: item.requester, requestId: item.requestId });
            const chain = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
            payment = await reconcilePayment(item.paymentId, companyAddress, requestStatus, chain?.status ?? null);
          }
          return { paymentId: item.paymentId, request: item.request, requestStatus, recipient, amountMicro,
            next: `/v1/payment-flows/${item.paymentId}/next`,
            paymentJob: `/v1/payment-jobs/${item.paymentId}`, paymentState: payment?.state ?? null,
            signature: payment?.signature ?? null,
            nextAction: payrollNextAction({ paymentId: item.paymentId, requestStatus,
              paymentState: payment?.state ?? null, amountMicro }) };
        }));
        items.push(...batch);
      }
      return reply(res, 200, { runId: run.runId, items, ...summarizePayroll(items) });
    }
    if (payrollRun && req.method === "POST" && payrollRun[2] === "approve") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const run = await getStoredPayrollRun(payrollRun[1], companyAddress);
      const statuses = await Promise.all(run.items.map(async (item) =>
        String((await readPaymentRequest(companyAddress, item.request, token)).status)));
      if (statuses.every((status) => status === "approved" || status === "executed")) {
        return reply(res, 200, { status: "ready", runId: run.runId });
      }
      if (!statuses.every((status) => ["submitted", "approved", "executed"].includes(status))) {
        throw new Error("Every payroll item must be submitted before approving the run");
      }
      const pending = run.items.filter((_, index) => statuses[index] === "submitted");
      const operation = `payrollApprove:${pending[0]!.paymentId}`;
      const previous = latestOnboardingReceipt(companyAddress, run.runId, operation);
      if (previous && (previous.status === "confirmed" ||
          ((previous.status === "built" || previous.status === "pending") && waitForCleanupReceipt(previous)))) {
        return reply(res, 200, { status: "wait", receiptId: previous.id, receiptStatus: previous.status });
      }
      const approvals = [];
      for (const item of pending.slice(0, MAX_APPROVALS_PER_TRANSACTION)) {
        const plan = await approvalPlan(companyContext, item.request, actor, body.grant, body.parentGrant, token);
        const transaction = Transaction.from(Buffer.from(plan.transaction.transactionBase64, "base64"));
        if (transaction.instructions.length !== 1) throw new Error("Unexpected payroll approval instruction count");
        approvals.push(transaction.instructions[0]!);
      }
      const blockhash = (await teeConnection(token).getLatestBlockhash()).blockhash;
      const { transactionBase64, itemCount } = buildPayrollApprovalChunk({ actor, blockhash, instructions: approvals });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target: run.runId,
        operation, chain: "ephemeral", transactionBase64 });
      return reply(res, 200, { status: "build", runId: run.runId, receiptId: receipt.id,
        itemCount, remainingAfterConfirmation: pending.length - itemCount,
        transaction: { status: "unsigned", operation: "approvePayroll", transactionBase64,
          requiredSigners: [actor], sendTo: "ephemeral", sendRpcEndpoint: TEE_RPC } });
    }
    const rejectFlow = routePath?.match(/^\/v1\/payment-flows\/([^/?]+)\/reject$/);
    if (req.method === "POST" && rejectFlow) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const flow = await getPaymentFlow(rejectFlow[1], companyAddress);
      const operation = flowReceiptOperation(flow, "rejectPayment");
      const current = await readPaymentRequest(companyAddress, flow.request, token);
      if (current.status === "rejected") return reply(res, 200, { status: "ready", request: flow.request });
      if (current.status !== "submitted") throw new Error("Only a submitted payment can be rejected");
      // Use the same Founder/Finance/Manager scope checks as approval before
      // building the contract's rejection instruction.
      await approvalPlan(companyContext, flow.request, actor, body.grant, body.parentGrant, token);
      const previous = latestOnboardingReceipt(companyAddress, flow.request, operation);
      if (previous && (previous.status === "built" || previous.status === "pending" || previous.status === "confirmed")) {
        return reply(res, 200, { status: "wait", request: flow.request,
          receiptId: previous.id, receiptStatus: previous.status });
      }
      const transaction = await buildOperation({ operation: "rejectPayment", actor, request: flow.request,
        grant: body.grant, parentGrant: body.parentGrant },
      { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target: flow.request,
        operation, chain: transaction.sendTo, transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build", request: flow.request, receiptId: receipt.id, transaction });
    }
    const paymentFlow = routePath?.match(/^\/v1\/payment-flows\/([^/?]+)(?:\/next)?$/);
    if (paymentFlow && req.method === "GET" && !routePath?.endsWith("/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const flow = await getPaymentFlow(paymentFlow[1], companyAddress);
      const inspected = await inspectPaymentFlow(flow, founderAddress, token);
      const result: Record<string, unknown> = {
        paymentId: flow.paymentId, request: flow.request, requestId: flow.requestId, requester: flow.requester,
        ...inspected,
      };
      if (inspected.observation.privateReady) {
        const privateRequest = await readPaymentRequest(companyAddress, flow.request, token);
        result.terms = { requester: flow.requester, recipient: privateRequest.recipient,
          amountMicro: privateRequest.amountMicro, includeFinance: flow.includeFinance ?? true,
          manager: flow.manager ?? null, branchId: flow.branchId ?? null };
      }
      if (["approved", "executed", "rejected"].includes(inspected.observation.status)) {
        const record = await registerPayment({ paymentId: flow.paymentId, company: companyAddress,
          request: flow.request, requester: flow.requester, requestId: flow.requestId });
        result.record = await reconcilePayment(record.paymentId, companyAddress, inspected.observation.status, null);
        result.paymentJob = {
          prepare: `/v1/payment-jobs/${flow.paymentId}/prepare`,
          status: `/v1/payment-jobs/${flow.paymentId}`,
          snapshotSync: `/v1/payment-jobs/${flow.paymentId}/snapshot-sync`,
        };
      }
      return reply(res, 200, result);
    }
    if (paymentFlow && req.method === "POST" && routePath?.endsWith("/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      if (body.payeeId !== undefined) await matchPayee(companyAddress, body.payeeId, body.recipient);
      const { flow, terms } = await getOrCreatePaymentFlow(paymentFlow[1], companyAddress, body);
      if (body.payeeId !== undefined) await linkPaymentPayee(companyAddress, flow.paymentId, body.payeeId);
      const inspected = await inspectPaymentFlow(flow, founderAddress, token);
      const baseResult = {
        paymentId: flow.paymentId, request: flow.request, requestId: flow.requestId, requester: flow.requester,
        observation: inspected.observation, step: inspected.step,
      };
      if (inspected.step.status === "wait") return reply(res, 200, baseResult);
      if (inspected.step.status === "ready_to_execute" || inspected.step.status === "ready" ||
          inspected.step.status === "rejected") {
        const status = inspected.observation.status;
        const record = await registerPayment({ paymentId: flow.paymentId, company: companyAddress,
          request: flow.request, requester: flow.requester, requestId: flow.requestId });
        return reply(res, 200, { ...baseResult,
          record: await reconcilePayment(record.paymentId, companyAddress, status, null),
          paymentJob: {
            prepare: `/v1/payment-jobs/${flow.paymentId}/prepare`,
            status: `/v1/payment-jobs/${flow.paymentId}`,
            snapshotSync: `/v1/payment-jobs/${flow.paymentId}/snapshot-sync`,
          },
        });
      }
      const actor = asAddress(body.actor, "actor");
      let operation = inspected.step.operation!;
      let transaction: Awaited<ReturnType<typeof buildOperation>>;
      if (inspected.step.status === "approval_required") {
        operation = "approvePayment";
        const plan = await approvalPlan(companyContext, flow.request, actor, body.grant, body.parentGrant, token);
        transaction = plan.transaction;
      } else {
        if (actor !== inspected.step.actor) throw new Error(`This step requires ${inspected.step.actor}`);
        const input: Record<string, unknown> = { operation, actor };
        if (operation === "prepareRequest" || operation === "delegateRequest") {
          input.requestId = flow.requestId;
        }
        if (operation === "initRequestPermission") input.request = flow.request;
        if (operation === "activateFounderRequest") {
          input.request = flow.request;
          input.includeFinance = terms.includeFinance;
          input.manager = terms.manager;
          input.recipient = terms.recipient;
          input.amountMicro = terms.amountMicro;
        }
        if (operation === "activateRequestPrivacy") {
          input.request = flow.request;
          input.includeFinance = terms.includeFinance;
          input.manager = terms.manager;
        }
        if (operation === "submitPayment") {
          input.request = flow.request;
          input.recipient = terms.recipient;
          input.amountMicro = terms.amountMicro;
        }
        if ((operation === "activateRequestPrivacy" || operation === "submitPayment") &&
            flow.requester !== founderAddress) {
          const grantAddress = asAddress(body.requesterGrant, "requesterGrant");
          const grant = await readTeamGrant(companyAddress, grantAddress, token);
          validateRequesterGrantForFlow({ company: companyAddress, founder: founderAddress,
            requester: flow.requester, requestId: flow.requestId, grant });
          input.requesterGrant = grantAddress;
        }
        transaction = await buildOperation(input as { operation: string; actor: string }, {
          company: companyAddress, founder: founderAddress, teeToken: token,
        });
      }
      const operationKey = flowReceiptOperation(flow, operation);
      let prior = latestOnboardingReceipt(companyAddress, flow.request, operationKey);
      if (prior?.status === "built") {
        prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
        if (prior.status === "expired") {
          const refreshed = await inspectPaymentFlow(flow, founderAddress, token);
          if (refreshed.step.operation !== operation || refreshed.step.status !== inspected.step.status) {
            return reply(res, 200, { ...baseResult, observation: refreshed.observation, step: refreshed.step });
          }
        }
      } else if (prior?.status === "pending") {
        prior = await reconcileOnboardingReceipt(prior.id, companyAddress, token);
      }
      if (prior && (prior.status === "built" || prior.status === "pending" || prior.status === "confirmed")) {
        return reply(res, 200, { ...baseResult, step: { status: "wait", operation: null, actor: null,
          sendTo: null, reason: "Wait for the prior signed step to confirm and state to propagate" },
          receiptId: prior.id, receiptStatus: prior.status, transaction: null });
      }
      const receipt = await recordOnboardingBuild({ company: companyAddress, target: flow.request, operation: operationKey,
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { ...baseResult, transaction, receiptId: receipt.id });
    }
    if (req.method === "GET" && routePath === "/v1/payment-jobs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      const query = requestUrl;
      const limit = query.searchParams.has("limit") ? Number(query.searchParams.get("limit")) : 50;
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch(() => null);
      const rows = [];
      let unavailableCount = 0;
      for (const record of await listPayments(companyAddress, limit)) {
        try {
          const request = await readPaymentRequest(companyAddress, record.request, token);
          const chain = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
          const updated = await reconcilePayment(record.paymentId, companyAddress, String(request.status), chain?.status ?? null);
          rows.push({ record: updated, payee: await paymentPayee(companyAddress, record.paymentId),
            requestStatus: request.status, chainStatus: chain?.status ?? null,
            snapshotNeedsSync: request.status === "executed" && chain?.status === "confirmed" &&
              chain.slot !== null && snapshot !== null
              ? BigInt(snapshot.updatedSlot) < BigInt(chain.slot) : null,
            integrityWarning: chain?.status === "confirmed" && request.status !== "executed"
              ? "Confirmed signature without executed request" : null });
        } catch {
          // PER ACL can hide records outside this reader's scope.
          unavailableCount++;
        }
      }
      return reply(res, 200, { payments: rows, unavailableCount,
        snapshotUpdatedSlot: snapshot?.updatedSlot ?? null });
    }
    if (req.method === "POST" && routePath === "/v1/reconciliation/run") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      await requireFounderPolicy({ company: companyAddress, founder: founderAddress, teeToken: token });
      const body = await readJson(req);
      const offset = body.paymentOffset === undefined ? 0 : Number(body.paymentOffset);
      const receiptOffset = body.receiptOffset === undefined ? 0 : Number(body.receiptOffset);
      const limit = body.limit === undefined ? 20 : Number(body.limit);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(receiptOffset) || receiptOffset < 0 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid reconciliation page");
      const page = await paymentReconciliationPage(companyAddress, offset, limit);
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch(() => null);
      const invoicePaymentIds = new Set(listInvoicePaymentIds(companyAddress));
      const payments = [];
      for (const record of page.payments) {
        try {
          const request = await readPaymentRequest(companyAddress, record.request, token);
          const observation = record.signature
            ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
          const chainStatus = record.signature && observation === null ? "unavailable" : observation?.status ?? null;
          const updated = await reconcilePayment(record.paymentId, companyAddress, String(request.status), observation?.status ?? null);
          payments.push({ paymentId: record.paymentId, source: invoicePaymentIds.has(record.paymentId) ? "invoice" : "payment",
            request: record.request, requestStatus: request.status, paymentState: updated.state, chainStatus, signature: updated.signature,
            next: paymentRecoveryAction({ record: updated, requestStatus: String(request.status), chainStatus,
              executionSlot: observation?.slot ?? null, snapshotSlot: snapshot?.updatedSlot ?? null }) });
        } catch (error) {
          payments.push({ paymentId: record.paymentId, next: "manual_review",
            error: error instanceof Error ? error.message : "State unavailable" });
        }
      }
      const receiptJournal = listOnboardingReceipts(companyAddress);
      const receipts = [];
      for (const current of receiptJournal.slice(receiptOffset, receiptOffset + limit)) {
        try {
          const receipt = await reconcileOnboardingReceipt(current.id, companyAddress, token);
          if (receipt.status === "confirmed" && /^(cleanupFinanceV2:|cleanupManagerV2:|cleanupMember:)/.test(receipt.operation) &&
              receipt.target !== companyAddress) {
            await applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
          }
          receipts.push({ id: receipt.id, operation: receipt.operation, status: receipt.status,
            signature: receipt.signature, next: receipt.status === "built"
              ? "provide_original_signed_transaction_or_inspect_target_state"
              : receipt.status === "pending" ? "wait_and_reconcile_same_signature"
              : receipt.status === "confirmed" ? "continue_guided_flow" : "inspect_target_before_rebuilding" });
        } catch (error) {
          receipts.push({ id: current.id, operation: current.operation, status: current.status,
            next: "manual_review", error: error instanceof Error ? error.message : "State unavailable" });
        }
      }
      return reply(res, 200, { companyAddress, payments, receipts,
        nextPaymentOffset: page.nextOffset,
        nextReceiptOffset: receiptOffset + receipts.length < receiptJournal.length ? receiptOffset + receipts.length : null,
        totalPayments: page.total,
        unresolvedReceiptsAtStart: receiptJournal.filter((item) => item.status === "built" || item.status === "pending").length,
        snapshotUpdatedSlot: snapshot?.updatedSlot ?? null,
        note: "This sweep only observes and updates receipts. Any new transfer or snapshot sync still needs an authorized wallet signature." });
    }
    const paymentJob = routePath?.match(/^\/v1\/payment-jobs\/([^/?]+)(?:\/(prepare|submit|snapshot-sync|rebuild))?$/);
    if (paymentJob && req.method === "GET" && !paymentJob[2]) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = await getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      const observation = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
      const chainStatus = observation?.status ?? null;
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch(() => null);
      const snapshotNeedsSync = request.status === "executed" && observation?.status === "confirmed" &&
        observation.slot !== null && snapshot !== null
        ? BigInt(snapshot.updatedSlot) < BigInt(observation.slot) : null;
      return reply(res, 200, { record: await reconcilePayment(id, companyAddress, String(request.status), chainStatus),
        requestStatus: request.status, chainStatus, executionSlot: observation?.slot ?? null,
        paymentSettled: request.status === "executed",
        signatureLinked: chainStatus === "confirmed" && request.status === "executed",
        chainStatusUnavailable: record.signature !== null && observation === null,
        snapshotUpdatedSlot: snapshot?.updatedSlot ?? null, snapshotNeedsSync,
        integrityWarning: chainStatus === "confirmed" && request.status !== "executed"
          ? "Execution signature confirmed without an executed private request; investigate before retrying" : null });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "snapshot-sync") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must sync the treasury snapshot");
      const id = paymentId(paymentJob[1]);
      const record = await getPayment(id, companyAddress);
      const [request, policy, snapshot] = await Promise.all([
        readPaymentRequest(companyAddress, record.request, token), readCompanyPolicy(companyAddress, token),
        readTreasurySnapshot(companyAddress, token),
      ]);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      if (request.status !== "executed" || !record.signature) throw new Error("Payment is not settled");
      const observation = await paymentChainObservation(record.signature, token);
      if (observation.status !== "confirmed" || observation.slot === null) {
        return reply(res, 200, { status: "wait_for_execution", executionSlot: observation.slot });
      }
      if (BigInt(snapshot.updatedSlot) >= BigInt(observation.slot)) {
        return reply(res, 200, { status: "ready", updatedSlot: snapshot.updatedSlot, balanceMicro: snapshot.balanceMicro });
      }
      const target = `${record.request}:snapshot`;
      const prior = latestOnboardingReceipt(companyAddress, target, "paymentSnapshotSync");
      if (prior && (prior.status === "built" || prior.status === "pending" || prior.status === "confirmed")) {
        return reply(res, 200, { status: "wait_for_snapshot", receiptId: prior.id, receiptStatus: prior.status });
      }
      const transaction = await buildOperation({ operation: "syncTreasurySnapshot", actor: founderAddress,
        treasuryToken: canonicalTokenAccount(companyAddress, DEVNET_USDC) },
      { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target,
        operation: "paymentSnapshotSync", chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build", receiptId: receipt.id, transaction });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "prepare") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Payment execution requires the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = await getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status !== "approved") return reply(res, 200, {
        record: await reconcilePayment(id, companyAddress, String(request.status), null), requestStatus: request.status,
        transaction: null,
      });
      if (record.state !== "registered" && record.state !== "failed") return reply(res, 200, {
        record, requestStatus: request.status, transaction: null,
        next: record.state === "prepared" ? "submit_original_signed_transaction" : "reconcile_first",
      });
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const plan = await executionPlan(companyContext, record.request, actor, body.grant, token);
      const prepared = await preparePayment(id, companyAddress, actor, plan.transaction.transactionBase64);
      return reply(res, 200, { record: prepared, ...plan });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "rebuild") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = await getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status !== "approved") throw new Error("Payment must still be approved before rebuilding");
      if (!record.preparedBlockhash) throw new Error("Prepared blockhash is unavailable; inspect this payment manually");
      const valid = (await teeConnection(token)
        .isBlockhashValid(record.preparedBlockhash, { commitment: "confirmed" })).value;
      return reply(res, 200, { record: await abandonPreparedPayment(id, companyAddress, valid === false),
        next: `/v1/payment-jobs/${id}/prepare` });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "submit") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = await getPayment(id, companyAddress);
      await readPaymentRequest(companyAddress, record.request, token);
      const body = await readJson(req);
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("signedTransactionBase64 is required");
      const bound = await bindSignedPayment(id, companyAddress, body.signedTransactionBase64);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status === "executed") return reply(res, 200, {
        record: await reconcilePayment(id, companyAddress, "executed", null), broadcast: "already_settled",
      });
      try {
        const submitted = await teeConnection(token)
          .sendRawTransaction(Transaction.from(Buffer.from(body.signedTransactionBase64, "base64")).serialize(),
            { skipPreflight: true, maxRetries: 3 });
        if (submitted !== bound.signature) throw new Error("PER returned a different signature");
        return reply(res, 200, { record: bound, broadcast: "submitted" });
      } catch {
        return reply(res, 200, { record: bound, broadcast: "uncertain",
          next: "reconcile_or_retry_same_signed_transaction" });
      }
    }
    if (payrollRun && req.method === "POST" && payrollRun[2] === "recover") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Payment execution requires the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const run = await getStoredPayrollRun(payrollRun[1], companyAddress);
      const wanted = body.paymentIds === undefined ? null : new Set(
        Array.isArray(body.paymentIds) ? body.paymentIds.map(paymentId) : (() => { throw new Error("paymentIds must be an array"); })(),
      );
      if (wanted && [...wanted].some((id) => !run.items.some((item) => item.paymentId === id))) {
        throw new Error("paymentIds includes an item outside this payroll run");
      }
      const recoveries = [];
      for (const item of run.items.filter((row) => wanted === null || wanted.has(row.paymentId))) {
        const request = await readPaymentRequest(companyAddress, item.request, token);
        const record = await registerPayment({ paymentId: item.paymentId, company: companyAddress,
          request: item.request, requester: item.requester, requestId: item.requestId });
        const chain = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
        const reconciled = await reconcilePayment(item.paymentId, companyAddress, String(request.status), chain?.status ?? null);
        if (request.status === "executed") {
          recoveries.push({ paymentId: item.paymentId, status: "settled" });
        } else if (request.status === "approved" && reconciled.state === "failed") {
          const plan = await executionPlan(companyContext, item.request, actor, body.grant, token);
          const rebuilt = await preparePayment(item.paymentId, companyAddress, actor, plan.transaction.transactionBase64);
          recoveries.push({ paymentId: item.paymentId, status: "build", record: rebuilt, transaction: plan.transaction });
        } else {
          recoveries.push({ paymentId: item.paymentId, status: "reconcile", requestStatus: request.status,
            paymentState: reconciled.state, chainStatus: chain?.status ?? null,
            next: `/v1/payment-jobs/${item.paymentId}` });
        }
      }
      return reply(res, 200, { runId: run.runId, recoveries,
        note: "Only confirmed failed signatures are rebuilt. Each replacement payout still needs the authorized signer." });
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/payments/") && routePath.endsWith("/status")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const request = decodeURIComponent(routePath.slice("/v1/payments/".length, -"/status".length));
      return reply(res, 200, paymentStatusFromRequest(await readPaymentRequest(companyAddress, request, token)));
    }
    if (req.method === "POST" && routePath?.startsWith("/v1/payments/") && routePath.endsWith("/build-execution")) {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Payment execution requires the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const requestAddress = decodeURIComponent(routePath.slice("/v1/payments/".length, -"/build-execution".length));
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      return reply(res, 200, await executionPlan(companyContext, requestAddress, actor, body.grant, token));
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/team-grants/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const grant = decodeURIComponent(routePath.slice("/v1/team-grants/".length));
      return reply(res, 200, await readTeamGrant(companyAddress, grant, token));
    }
    if (req.method === "GET" && routePath === "/v1/agent-policies") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      return reply(res, 200, { policies: await listVisibleAgentPolicies(companyAddress, token) });
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/agent-policies/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const agentPolicy = decodeURIComponent(routePath.slice("/v1/agent-policies/".length));
      return reply(res, 200, await readAgentPolicy(companyAddress, agentPolicy, token));
    }
    const revokeAgentRoute = routePath?.match(/^\/v1\/agent-policies\/([^/?]+)\/revoke\/next$/);
    if (req.method === "POST" && revokeAgentRoute) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must revoke agent policy");
      assertTeeTokenActor(token, actor);
      const agentPolicyAddress = asAddress(decodeURIComponent(revokeAgentRoute[1]), "agentPolicy");
      const policy = await readAgentPolicy(companyAddress, agentPolicyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Agent policy belongs to another Founder");
      if (policy.revoked === true) return reply(res, 200, { status: "ready", agentPolicyAddress });
      let prior = latestOnboardingReceipt(companyAddress, agentPolicyAddress, "revokeAgent");
      if (prior?.status === "built") prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
      if (prior && (prior.status === "built" || prior.status === "pending" || prior.status === "confirmed")) {
        return reply(res, 200, { status: "wait", agentPolicyAddress,
          receiptId: prior.id, receiptStatus: prior.status });
      }
      const transaction = await buildOperation({ operation: "revokeAgent", actor,
        agentPolicy: agentPolicyAddress }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress,
        target: agentPolicyAddress, operation: "revokeAgent", chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build", agentPolicyAddress,
        receiptId: receipt.id, transaction });
    }
    const agentMoneyRoute = routePath?.match(/^\/v1\/agent-policies\/([^/?]+)\/(fund|reclaim|pay)\/next$/);
    if (req.method === "POST" && agentMoneyRoute) {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Agent token transfers require the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      assertTeeTokenActor(token, actor);
      const agentPolicyAddress = asAddress(decodeURIComponent(agentMoneyRoute[1]), "agentPolicy");
      const kind = agentMoneyRoute[2] as "fund" | "reclaim" | "pay";
      const policy = await readAgentPolicy(companyAddress, agentPolicyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== companyContext.mint) {
        throw new Error("Agent policy does not belong to this company");
      }
      if (kind === "pay" ? actor !== policy.agent : actor !== founderAddress) {
        throw new Error(kind === "pay" ? "Only the configured agent can pay" : "Only the Founder can move agent float");
      }
      if (kind !== "reclaim" && policy.revoked !== false) throw new Error("Agent policy is revoked");
      const amountMicro = asMicroAmount(body.amountMicro);
      const actionId = body.actionId;
      if (typeof actionId !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(actionId)) {
        throw new Error("actionId must be 1 to 48 letters, digits, underscores, or hyphens");
      }
      const target = `${agentPolicyAddress}:${actionId}`;
      const operation = kind === "fund" ? "fundAgentFloat" : kind === "reclaim" ? "reclaimAgentFloat" : "agentPay";
      const operationKey = `${operation}:${actor}:${amountMicro}:${policy.allowedRecipient}`;
      if (listOnboardingReceipts(companyAddress).some((receipt) =>
        receipt.target === target && receipt.operation !== operationKey)) {
        throw new Error("Agent action ID is already bound to different payment terms");
      }
      let prior = latestOnboardingReceipt(companyAddress, target, operationKey);
      if (prior?.status === "confirmed") return reply(res, 200, { status: "ready", agentPolicyAddress,
        actionId, receiptId: prior.id });
      if (prior?.status === "built") prior = await expireUnsignedOnboardingReceipt(prior.id, companyAddress, token);
      if (prior && (prior.status === "built" || prior.status === "pending")) {
        return reply(res, 200, { status: "wait", agentPolicyAddress,
          actionId, receiptId: prior.id, receiptStatus: prior.status });
      }
      const accounts = kind === "pay" ? agentPaymentAccounts(companyAddress, actor, policy, amountMicro) : null;
      const transaction = await buildOperation({ operation, actor, agentPolicy: agentPolicyAddress,
        amountMicro,
        ...(accounts ? { agentFloatToken: accounts.agentFloatToken, recipientToken: accounts.recipientToken } : {
          treasuryToken: canonicalTokenAccount(companyAddress, companyContext.mint),
          agentFloatToken: canonicalTokenAccount(agentPolicyAddress, companyContext.mint),
        }) }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target,
        operation: operationKey, chain: transaction.sendTo, transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build", agentPolicyAddress, actionId,
        recipient: accounts?.recipient ?? null, receiptId: receipt.id, transaction });
    }
    if (req.method === "POST" && routePath?.startsWith("/v1/agents/") && routePath.endsWith("/build-payment")) {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Agent USDC payments are not enabled for this company" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const agentPolicyAddress = decodeURIComponent(routePath.slice("/v1/agents/".length, -"/build-payment".length));
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const policy = await readAgentPolicy(companyAddress, agentPolicyAddress, token);
      const accounts = agentPaymentAccounts(companyAddress, actor, policy, body.amountMicro);
      const transaction = await buildOperation({
        operation: "agentPay", actor, agentPolicy: agentPolicyAddress,
        amountMicro: accounts.amountMicro, agentFloatToken: accounts.agentFloatToken,
        recipientToken: accounts.recipientToken,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      return reply(res, 200, {
        agentPolicyAddress, recipient: accounts.recipient, amountMicro: accounts.amountMicro,
        transaction,
      });
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/recipient-balance/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const owner = decodeURIComponent(routePath.slice("/v1/recipient-balance/".length));
      return reply(res, 200, await readRecipientBalance({
        owner, mint: companyContext.mint, teeToken: token,
      }));
    }
    if (req.method === "POST" && routePath === "/v1/private-receive/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1") {
        return reply(res, 503, { error: "Private receive to the company PDA is still an integration experiment" });
      }
      if (companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Private USDC receive requires a verified USDC company policy mint" });
      }
      const body = await readJson(req);
      const transaction = await preparePrivateReceive({
        payer: body.payer,
        company: companyAddress,
        amountMicro: body.amountMicro,
        teeToken: typeof body.teeToken === "string" ? body.teeToken : undefined,
        cluster: process.env.MAGICBLOCK_CLUSTER ?? "devnet-private",
        expectedValidator: TEE_VALIDATOR.toBase58(),
        privacy: body.privacy,
      });
      return reply(res, 200, { status: "unsigned", companyAddress, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/recipient-onboard/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || companyContext.mint !== DEVNET_USDC) {
        return reply(res, 503, { error: "Private recipient onboarding requires the verified Circle devnet USDC receive flow" });
      }
      const body = await readJson(req);
      const recipient = asAddress(body.recipient, "recipient");
      const transaction = await prepareRecipientOnboarding({
        payer: body.payer,
        recipient,
        amountMicro: body.amountMicro,
        teeToken: typeof body.teeToken === "string" ? body.teeToken : undefined,
        cluster: process.env.MAGICBLOCK_CLUSTER ?? "devnet-private",
        expectedValidator: TEE_VALIDATOR.toBase58(),
        privacy: body.privacy,
      });
      return reply(res, 200, { status: "unsigned", recipient, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/onboarding/recipient-withdraw/next") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW !== "1") {
        return reply(res, 503, { error: "Recipient withdrawal is gated until the configured mint is verified" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Recipient TEE auth token required");
      const body = await readJson(req);
      const owner = asAddress(body.owner, "owner");
      assertTeeTokenActor(token, owner);
      if (typeof body.withdrawalId !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(body.withdrawalId)) {
        throw new Error("withdrawalId must be 1 to 48 letters, digits, underscores, or hyphens");
      }
      const privateBalance = await readRecipientBalance({ owner, mint: companyContext.mint, teeToken: token });
      const amountMicro = assertRecipientWithdrawalBalance(body.amountMicro, privateBalance.balanceMicro);
      const target = `${owner}:${body.withdrawalId}`;
      const prior = latestOnboardingReceipt(companyAddress, target, "recipientWithdraw");
      if (prior) return reply(res, 200, { status: prior.status === "confirmed" ? "ready" : "wait_for_receipt",
        receiptId: prior.id, receiptStatus: prior.status, transaction: null });
      const transaction = await prepareRecipientWithdrawal({ owner, mint: companyContext.mint,
        amountMicro, validator: TEE_VALIDATOR.toBase58(), cluster: process.env.MAGICBLOCK_CLUSTER ?? "devnet-private" });
      const receipt = await recordOnboardingBuild({ company: companyAddress, target,
        operation: "recipientWithdraw", chain: "base", transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "sign_withdrawal", receiptId: receipt.id, transaction });
    }
    if (req.method === "POST" && routePath === "/v1/recipient-withdraw/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW !== "1") {
        return reply(res, 503, { error: "Recipient withdrawal is gated until the configured mint is verified" });
      }
      const mint = companyContext.mint;
      const body = await readJson(req);
      const transaction = await prepareRecipientWithdrawal({
        owner: body.owner,
        mint,
        amountMicro: body.amountMicro,
        validator: TEE_VALIDATOR.toBase58(),
        cluster: process.env.MAGICBLOCK_CLUSTER ?? "devnet-private",
      });
      return reply(res, 200, { status: "unsigned", transaction });
    }
    if (req.method === "POST" && routePath === "/v1/operations/build") {
      const body = await readJson(req);
      if (
        ["executePayment", "fundAgentFloat", "agentPay", "reclaimAgentFloat"].includes(String(body.operation)) &&
        process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1"
      ) {
        return reply(res, 503, { error: "Token CPI builder is gated until the configured USDC deployment is verified" });
      }
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const result = await buildOperation(body as { operation: string; actor: string }, {
        company: companyAddress,
        founder: founderAddress,
        teeToken: bearer,
      });
      return reply(res, 200, result);
    }
    if (req.method === "GET" && routePath?.startsWith("/v1/transactions/")) {
      const url = requestUrl;
      const signature = url.pathname.slice("/v1/transactions/".length);
      if (!/^[1-9A-HJ-NP-Za-km-z]{70,90}$/.test(signature)) throw new Error("Invalid transaction signature");
      const chain = url.searchParams.get("chain");
      if (chain !== "base" && chain !== "ephemeral") throw new Error("chain must be base or ephemeral");
      const connection = chain === "base" ? new Connection(BASE_RPC, "confirmed") : (() => {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!token) throw new Error("TEE auth token required");
        return teeConnection(token);
      })();
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      return reply(res, 200, {
        signature, chain,
        chainConfirmation: status === null ? "not_found" : status.err ? "failed" : status.confirmationStatus ?? "processed",
        error: status?.err ?? null,
        paymentSettled: null,
      });
    }
    return reply(res, 404, { error: "Not found" });
  } catch (error) {
    return reply(res, error instanceof AgentRateLimitError ? 429 : 400,
      { error: error instanceof Error ? error.message : "Unknown error" });
  }
}).listen(port, host, () => {
  process.stdout.write(`Mercury backend listening on http://${host}:${port}\n`);
});
