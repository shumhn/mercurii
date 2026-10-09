import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { parseVendorRegistry, suggestInvoicePayment } from "./invoice-agent.ts";
import { inspectRootFinanceGrant } from "./finance-onboarding.ts";
import { inspectManagerGrant } from "./manager-onboarding.ts";
import { inspectMemberGrant } from "./member-onboarding.ts";
import { confirmOnboardingReceipt, latestOnboardingReceipt, recordOnboardingBuild,
  waitForCleanupReceipt } from "./onboarding-journal.ts";
import { nextRecipientOnboarding } from "./recipient-onboarding.ts";
import { nextTreasuryFundingStep } from "./treasury-funding.ts";
import { scanFinanceReaderCleanup } from "./finance-cleanup.ts";
import { scanManagerReaderCleanup } from "./manager-cleanup.ts";
import { scanMemberReaderCleanup } from "./member-cleanup.ts";
import { inspectCompanyOnboarding } from "./onboarding.ts";
import { abandonPreparedPayment, bindSignedPayment, getPayment, listPayments, paymentId, preparePayment, reconcilePayment, registerPayment } from "./payment-journal.ts";
import { createPayrollRun, getPayrollRun, listPayrollRuns, payrollNextAction, summarizePayroll } from "./payroll-run.ts";
import { buildPayrollApprovalChunk, MAX_APPROVALS_PER_TRANSACTION } from "./payroll-approval.ts";
import { previewPayrollCsv } from "./payroll-roster.ts";
import { createPayrollSchedule, getPayrollSchedule, launchScheduledPayroll, listPayrollSchedules,
  payrollScheduleView, updatePayrollSchedule } from "./payroll-schedule.ts";
import { verifyPayrollScheduleFounder } from "./payroll-schedule-auth.ts";
import { deactivatePayee, linkPaymentPayee, listPayees, matchPayee, paymentPayee, registerPayee } from "./payee-journal.ts";
import { applyConfirmedReaderCleanup, flowReceiptOperation, getOrCreatePaymentFlow,
  getPaymentFlow, inspectPaymentFlow } from "./payment-flow.ts";
import {
  DEVNET_USDC, asAddress, asMicroAmount, canonicalTokenAccount, delegationStatus, preparePrivateReceive,
  prepareRecipientOnboarding, prepareRecipientWithdrawal, readRecipientBalance,
} from "./magicblock.ts";
import {
  BASE_RPC, PROGRAM_ID, TEE_RPC, TEE_VALIDATOR, agentPaymentAccounts, buildOperation,
  paymentExecutionAccounts, paymentRequestAddress, paymentStatusFromRequest, requestBranchScope,
  readAgentPolicy, readCompanyPolicy, readPaymentRequest, readTeamGrant, readTreasurySnapshot,
} from "./operations.ts";

const companyAddress = asAddress(process.env.MERCURY_COMPANY_ADDRESS, "MERCURY_COMPANY_ADDRESS");
const founderAddress = asAddress(process.env.MERCURY_FOUNDER_ADDRESS, "MERCURY_FOUNDER_ADDRESS");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8787");

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

async function readJson(req: IncomingMessage, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("Request too large");
    chunks.push(buf);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function executionPlan(requestAddress: string, actor: string, grantInput: unknown, token: string) {
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
    operation: "executePayment", actor, request: requestAddress, grant: grantAddress,
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

async function approvalPlan(requestAddress: string, actor: string, grantInput: unknown, parentGrantInput: unknown,
  token: string) {
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
  const endpoint = new URL(TEE_RPC);
  endpoint.searchParams.set("token", token);
  const status = (await new Connection(endpoint.toString(), "confirmed")
    .getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  return { status: status === null ? "not_found" : status.err ? "failed" :
    status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" ? "confirmed" : "processed",
    slot: status?.slot ?? null };
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, 200, { ok: true, companyAddress, programId: PROGRAM_ID.toBase58() });
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/next") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      if (process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
        return reply(res, 503, { error: "Onboarding currently requires a Circle devnet USDC company" });
      }
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      if (actor !== founderAddress) throw new Error("Founder must run company onboarding");
      const result = await inspectCompanyOnboarding({
        company: companyAddress, founder: founderAddress, finance: body.finance,
        mint: process.env.MERCURY_COMPANY_MINT,
        monthlyLimitMicro: body.monthlyLimitMicro, agentCapMicro: body.agentCapMicro,
        teeToken: token,
      });
      if (result.next.status !== "build") return reply(res, 200, result);
      const input: Record<string, unknown> = {
        operation: result.next.operation, actor,
        finance: body.finance, mint: process.env.MERCURY_COMPANY_MINT,
        monthlyLimitMicro: body.monthlyLimitMicro, agentCapMicro: body.agentCapMicro,
      };
      const transaction = await buildOperation(input as { operation: string; actor: string }, {
        company: companyAddress, founder: founderAddress, teeToken: token,
      });
      const target = result.next.operation?.includes("Snapshot") ? result.snapshotAddress : companyAddress;
      const receipt = recordOnboardingBuild({
        company: companyAddress, target, operation: result.next.operation!,
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/finance-grant/next") {
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
      const receipt = recordOnboardingBuild({
        company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/manager-grant/next") {
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
      const receipt = recordOnboardingBuild({
        company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/member-grant/next") {
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
      const receipt = recordOnboardingBuild({ company: companyAddress, target: result.grantAddress,
        operation: result.next.operation!, chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { ...result, transaction, receiptId: receipt.id });
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/onboarding/receipts/") && req.url.endsWith("/confirm")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const id = req.url.slice("/v1/onboarding/receipts/".length, -"/confirm".length);
      const body = await readJson(req);
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("signedTransactionBase64 is required");
      const receipt = await confirmOnboardingReceipt(id, body.signedTransactionBase64, token);
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupFinanceV2:") &&
          receipt.target !== companyAddress) {
        applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupManagerV2:")) {
        applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      if (receipt.status === "confirmed" && receipt.operation.startsWith("cleanupMember:")) {
        applyConfirmedReaderCleanup(receipt.company, receipt.target, "all");
      }
      return reply(res, 200, receipt);
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/recipient/next") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
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
      const receipt = recordOnboardingBuild({
        company: companyAddress, target, operation: "recipientDeposit",
        chain: result.transaction.sendTo, transactionBase64: result.transaction.transactionBase64,
      });
      return reply(res, 200, { ...result, receiptId: receipt.id });
    }
    if (req.method === "POST" && req.url === "/v1/onboarding/company-funding/next") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
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
        });
        const receipt = recordOnboardingBuild({
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
      const receipt = recordOnboardingBuild({
        company: companyAddress, target, operation: "syncTreasurySnapshot",
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
      });
      return reply(res, 200, { status: next, observedBalanceMicro: snapshot?.balanceMicro ?? null,
        receiptId: receipt.id, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/access/finance-revocation-cleanup/plan") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must run Finance reader cleanup");
      const scan = await scanFinanceReaderCleanup({
        company: companyAddress, founder: founderAddress, grant: body.grant, teeToken: token,
      });
      const operationKey = `cleanupFinanceV2:${scan.grant}`;
      const pending = [];
      for (const target of scan.targets) {
        const prior = latestOnboardingReceipt(companyAddress, target.address, operationKey);
        if (prior?.status === "confirmed") {
          if (target.kind === "request") applyConfirmedReaderCleanup(companyAddress, target.address, "all");
          continue;
        }
        if (prior && waitForCleanupReceipt(prior)) {
          pending.push({ target: target.address, kind: target.kind, receiptId: prior.id, transaction: null });
          continue;
        }
        if (pending.length >= 10) break;
        const transaction = await buildOperation({
          operation: target.kind === "request" ? "setRequestReadersV2" : "setSnapshotReaders",
          actor: founderAddress, request: target.address, includeRequester: false,
          includeFinance: false, manager: null, viewer: null,
        }, { company: companyAddress, founder: founderAddress, teeToken: token });
        const receipt = recordOnboardingBuild({
          company: companyAddress, target: target.address, operation: operationKey,
          chain: transaction.sendTo, transactionBase64: transaction.transactionBase64,
        });
        pending.push({ target: target.address, kind: target.kind, receiptId: receipt.id, transaction });
      }
      const confirmedCount = scan.targets.filter((target) =>
        latestOnboardingReceipt(companyAddress, target.address, operationKey)?.status === "confirmed").length;
      return reply(res, 200, {
        status: confirmedCount === scan.targets.length && scan.agentPolicies.length === 0 ? "ready" : "cleanup_required",
        grant: scan.grant, totalTargets: scan.targets.length, confirmedCount, pending,
        residualReadAccess: {
          financeOwnedRequests: scan.financeOwnedRequests,
          agentPolicies: scan.agentPolicies,
          historicalResetRequests: scan.historicalResetRequests,
        },
      });
    }
    if (req.method === "POST" && req.url === "/v1/access/manager-revocation-cleanup/plan") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must run Manager reader cleanup");
      const scan = await scanManagerReaderCleanup({
        company: companyAddress, founder: founderAddress, grant: body.grant,
        parentGrant: body.parentGrant, teeToken: token,
      });
      const operationKey = `cleanupManagerV2:${scan.grant}`;
      const pending = [];
      for (const target of scan.targets) {
        const prior = latestOnboardingReceipt(companyAddress, target.address, operationKey);
        if (prior?.status === "confirmed") {
          applyConfirmedReaderCleanup(companyAddress, target.address, "all");
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
        const receipt = recordOnboardingBuild({
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
    if (req.method === "POST" && req.url === "/v1/access/member-revocation-cleanup/plan") {
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
          applyConfirmedReaderCleanup(companyAddress, address, "all");
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
        const receipt = recordOnboardingBuild({ company: companyAddress, target: address,
          operation: operationKey, chain: transaction.sendTo,
          transactionBase64: transaction.transactionBase64 });
        pending.push({ target: address, receiptId: receipt.id, transaction });
      }
      const confirmedCount = scan.targets.filter((address) =>
        latestOnboardingReceipt(companyAddress, address, operationKey)?.status === "confirmed").length;
      return reply(res, 200, { status: confirmedCount === scan.targets.length ? "ready" : "cleanup_required",
        ...scan, totalTargets: scan.targets.length, confirmedCount, pending });
    }
    if (req.method === "POST" && req.url === "/v1/access/request-viewer/build") {
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
      const transaction = await buildOperation({ operation: "setRequestReadersV2",
        actor: founderAddress, request: requestAddress, includeRequester: body.includeRequester,
        includeFinance: false, manager: null, viewer, viewerGrant: viewerGrantAddress,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      return reply(res, 200, { status: "unsigned", request: requestAddress, viewer, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/access/policy-readers/restore/build") {
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
      return reply(res, 200, { status: "unsigned", grant: grantAddress, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/agent/invoice-suggestions") {
      if (process.env.MERCURY_ENABLE_INVOICE_AGENT !== "1") return reply(res, 503, { error: "Invoice agent is disabled" });
      if (!matchesAgentApiKey(req.headers.authorization)) return reply(res, 401, { error: "Agent API key required" });
      if (process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) throw new Error("Invoice agent requires the Circle devnet USDC company");
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
      return reply(res, 200, suggestion);
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/delegation/")) {
      const account = decodeURIComponent(req.url.slice("/v1/delegation/".length));
      return reply(res, 200, { account, status: await delegationStatus({ account }) });
    }
    if (req.method === "GET" && req.url === "/v1/treasury-snapshot") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      return reply(res, 200, await readTreasurySnapshot(companyAddress, token));
    }
    if (req.method === "GET" && req.url === "/v1/company-policy") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      return reply(res, 200, await readCompanyPolicy(companyAddress, token));
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/payment-requests/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const request = decodeURIComponent(req.url.slice("/v1/payment-requests/".length));
      return reply(res, 200, await readPaymentRequest(companyAddress, request, token));
    }
    if (req.method === "POST" && req.url === "/v1/payment-jobs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      const requestAddress = asAddress(body.request, "request");
      const request = await readPaymentRequest(companyAddress, requestAddress, token);
      const derived = paymentRequestAddress(new PublicKey(companyAddress),
        new PublicKey(String(request.requester)), new BN(String(request.id)));
      if (derived.toBase58() !== requestAddress) throw new Error("Request address does not match its private identity");
      const record = registerPayment({ paymentId: body.paymentId, company: companyAddress,
        request: requestAddress, requester: String(request.requester), requestId: String(request.id) });
      return reply(res, 200, { record: reconcilePayment(record.paymentId, companyAddress, String(request.status), null),
        requestStatus: request.status });
    }
    if (req.url === "/v1/payees" && (req.method === "GET" || req.method === "POST")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      if (req.method === "GET") return reply(res, 200, { payees: listPayees(companyAddress).map(({ recipientHash, ...payee }) => payee) });
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must register a payee");
      const { recipientHash, ...payee } = registerPayee(companyAddress, body);
      return reply(res, 200, { payee });
    }
    const deactivate = req.url?.match(/^\/v1\/payees\/([^/?]+)\/deactivate$/);
    if (deactivate && req.method === "POST") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      const body = await readJson(req);
      if (asAddress(body.actor, "actor") !== founderAddress) throw new Error("Founder must deactivate a payee");
      const { recipientHash, ...payee } = deactivatePayee(companyAddress, deactivate[1]);
      return reply(res, 200, { payee });
    }
    if (req.url === "/v1/payroll-schedules" && (req.method === "GET" || req.method === "POST")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      if (req.method === "GET") return reply(res, 200, {
        schedules: listPayrollSchedules(companyAddress).map((schedule) => payrollScheduleView(schedule)),
      });
      const body = await readJson(req, 90_000);
      verifyPayrollScheduleFounder("create", companyAddress, founderAddress, body);
      return reply(res, 200, payrollScheduleView(createPayrollSchedule(companyAddress, body)));
    }
    const payrollSchedule = req.url?.match(/^\/v1\/payroll-schedules\/([^/?]+)(?:\/(launch))?$/);
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
        return reply(res, 200, payrollScheduleView(updatePayrollSchedule(companyAddress, payrollSchedule[1], body)));
      }
      if (req.method === "POST" && payrollSchedule[2] === "launch") {
        verifyPayrollScheduleFounder("launch", companyAddress, founderAddress, body, payrollSchedule[1]);
        if (asAddress(body.requester, "requester") !== founderAddress) throw new Error("Founder must launch this MVP payroll run");
        return reply(res, 200, launchScheduledPayroll(companyAddress, payrollSchedule[1], body));
      }
    }
    if (req.method === "POST" && req.url === "/v1/payroll-runs/preview") {
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
    if (req.method === "POST" && req.url === "/v1/payroll-runs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const body = await readJson(req);
      if (asAddress(body.requester, "requester") !== founderAddress) throw new Error("Founder must create this MVP payroll run");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress || policy.mint !== DEVNET_USDC) throw new Error("Wrong private company policy");
      const run = createPayrollRun(body.runId, companyAddress, body);
      return reply(res, 200, { runId: run.runId, items: run.items.map((item, index) => ({
        index, paymentId: item.paymentId, request: item.request,
        next: `/v1/payment-flows/${item.paymentId}/next`,
      })), approve: `/v1/payroll-runs/${run.runId}/approve`, status: `/v1/payroll-runs/${run.runId}` });
    }
    if (req.method === "GET" && req.url === "/v1/payroll-runs") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      return reply(res, 200, { runs: listPayrollRuns(companyAddress).map((run) => ({
        ...run, status: `/v1/payroll-runs/${run.runId}`,
      })) });
    }
    const payrollRun = req.url?.match(/^\/v1\/payroll-runs\/([^/?]+)(?:\/(approve))?$/);
    if (payrollRun && req.method === "GET" && !payrollRun[2]) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("Founder TEE auth token required");
      const run = getPayrollRun(payrollRun[1], companyAddress);
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      const items = [];
      for (let offset = 0; offset < run.items.length; offset += 5) {
        const batch = await Promise.all(run.items.slice(offset, offset + 5).map(async (item) => {
          const inspected = await inspectPaymentFlow(getPaymentFlow(item.paymentId, companyAddress), founderAddress, token);
          const requestStatus = inspected.observation.status;
          const privateRequest = inspected.observation.privateReady && requestStatus !== "empty"
            ? await readPaymentRequest(companyAddress, item.request, token) : null;
          const amountMicro = privateRequest ? String(privateRequest.amountMicro) : null;
          let payment = null;
          if (["approved", "executed", "rejected"].includes(requestStatus)) {
            const record = registerPayment({ paymentId: item.paymentId, company: companyAddress,
              request: item.request, requester: item.requester, requestId: item.requestId });
            const chain = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
            payment = reconcilePayment(item.paymentId, companyAddress, requestStatus, chain?.status ?? null);
          }
          return { paymentId: item.paymentId, request: item.request, requestStatus, amountMicro,
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
      const run = getPayrollRun(payrollRun[1], companyAddress);
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
        const plan = await approvalPlan(item.request, actor, body.grant, body.parentGrant, token);
        const transaction = Transaction.from(Buffer.from(plan.transaction.transactionBase64, "base64"));
        if (transaction.instructions.length !== 1) throw new Error("Unexpected payroll approval instruction count");
        approvals.push(transaction.instructions[0]!);
      }
      const endpoint = new URL(TEE_RPC);
      endpoint.searchParams.set("token", token);
      const blockhash = (await new Connection(endpoint.toString(), "confirmed").getLatestBlockhash()).blockhash;
      const { transactionBase64, itemCount } = buildPayrollApprovalChunk({ actor, blockhash, instructions: approvals });
      const receipt = recordOnboardingBuild({ company: companyAddress, target: run.runId,
        operation, chain: "ephemeral", transactionBase64 });
      return reply(res, 200, { status: "build", runId: run.runId, receiptId: receipt.id,
        itemCount, remainingAfterConfirmation: pending.length - itemCount,
        transaction: { status: "unsigned", operation: "approvePayroll", transactionBase64,
          requiredSigners: [actor], sendTo: "ephemeral", sendRpcEndpoint: TEE_RPC } });
    }
    const paymentFlow = req.url?.match(/^\/v1\/payment-flows\/([^/?]+)(?:\/next)?$/);
    if (paymentFlow && req.method === "GET" && !req.url?.endsWith("/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const flow = getPaymentFlow(paymentFlow[1], companyAddress);
      const inspected = await inspectPaymentFlow(flow, founderAddress, token);
      const result: Record<string, unknown> = {
        paymentId: flow.paymentId, request: flow.request, requestId: flow.requestId, requester: flow.requester,
        ...inspected,
      };
      if (["approved", "executed", "rejected"].includes(inspected.observation.status)) {
        const record = registerPayment({ paymentId: flow.paymentId, company: companyAddress,
          request: flow.request, requester: flow.requester, requestId: flow.requestId });
        result.record = reconcilePayment(record.paymentId, companyAddress, inspected.observation.status, null);
        result.paymentJob = {
          prepare: `/v1/payment-jobs/${flow.paymentId}/prepare`,
          status: `/v1/payment-jobs/${flow.paymentId}`,
          snapshotSync: `/v1/payment-jobs/${flow.paymentId}/snapshot-sync`,
        };
      }
      return reply(res, 200, result);
    }
    if (paymentFlow && req.method === "POST" && req.url?.endsWith("/next")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const body = await readJson(req);
      if (body.payeeId !== undefined) matchPayee(companyAddress, body.payeeId, body.recipient);
      const { flow, terms } = getOrCreatePaymentFlow(paymentFlow[1], companyAddress, body);
      if (body.payeeId !== undefined) linkPaymentPayee(companyAddress, flow.paymentId, body.payeeId);
      const inspected = await inspectPaymentFlow(flow, founderAddress, token);
      const baseResult = {
        paymentId: flow.paymentId, request: flow.request, requestId: flow.requestId, requester: flow.requester,
        observation: inspected.observation, step: inspected.step,
      };
      if (inspected.step.status === "wait") return reply(res, 200, baseResult);
      if (inspected.step.status === "ready_to_execute" || inspected.step.status === "ready" ||
          inspected.step.status === "rejected") {
        const status = inspected.observation.status;
        const record = registerPayment({ paymentId: flow.paymentId, company: companyAddress,
          request: flow.request, requester: flow.requester, requestId: flow.requestId });
        return reply(res, 200, { ...baseResult,
          record: reconcilePayment(record.paymentId, companyAddress, status, null),
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
        const plan = await approvalPlan(flow.request, actor, body.grant, body.parentGrant, token);
        transaction = plan.transaction;
      } else {
        if (actor !== inspected.step.actor) throw new Error(`This step requires ${inspected.step.actor}`);
        const input: Record<string, unknown> = { operation, actor };
        if (operation === "createRequestShell" || operation === "delegateRequest") input.requestId = flow.requestId;
        if (operation === "initRequestPermission") input.request = flow.request;
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
          const policy = await readCompanyPolicy(companyAddress, token);
          const financeRequester = flow.requester === policy.finance;
          const grantAddress = asAddress(body.requesterGrant, "requesterGrant");
          const grant = await readTeamGrant(companyAddress, grantAddress, token);
          if (grant.role !== (financeRequester ? 1 : 3) || grant.member !== flow.requester ||
              grant.grantor !== founderAddress || grant.active !== true || grant.revoked !== false ||
              (!financeRequester && grant.scope !== PublicKey.default.toBase58() &&
                grant.scope !== requestBranchScope(new PublicKey(companyAddress), flow.requestId).toBase58())) {
            throw new Error("Active requester grant for this payment branch is required");
          }
          input.requesterGrant = grantAddress;
        }
        transaction = await buildOperation(input as { operation: string; actor: string }, {
          company: companyAddress, founder: founderAddress, teeToken: token,
        });
      }
      const operationKey = flowReceiptOperation(flow, operation);
      const prior = latestOnboardingReceipt(companyAddress, flow.request, operationKey);
      if (prior && (prior.status === "built" || prior.status === "pending" || prior.status === "confirmed")) {
        return reply(res, 200, { ...baseResult, step: { status: "wait", operation: null, actor: null,
          sendTo: null, reason: "Wait for the prior signed step to confirm and state to propagate" },
          receiptId: prior.id, receiptStatus: prior.status, transaction: null });
      }
      const receipt = recordOnboardingBuild({ company: companyAddress, target: flow.request, operation: operationKey,
        chain: transaction.sendTo, transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { ...baseResult, transaction, receiptId: receipt.id });
    }
    if (req.method === "GET" && (req.url === "/v1/payment-jobs" || req.url?.startsWith("/v1/payment-jobs?"))) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const policy = await readCompanyPolicy(companyAddress, token);
      if (policy.founder !== founderAddress) throw new Error("Wrong private company policy");
      const query = new URL(req.url, "http://localhost");
      const limit = query.searchParams.has("limit") ? Number(query.searchParams.get("limit")) : 50;
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch(() => null);
      const rows = [];
      let unavailableCount = 0;
      for (const record of listPayments(companyAddress, limit)) {
        try {
          const request = await readPaymentRequest(companyAddress, record.request, token);
          const chain = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
          const updated = reconcilePayment(record.paymentId, companyAddress, String(request.status), chain?.status ?? null);
          rows.push({ record: updated, payee: paymentPayee(companyAddress, record.paymentId),
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
    const paymentJob = req.url?.match(/^\/v1\/payment-jobs\/([^/?]+)(?:\/(prepare|submit|snapshot-sync|rebuild))?$/);
    if (paymentJob && req.method === "GET" && !paymentJob[2]) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      const observation = record.signature ? await paymentChainObservation(record.signature, token).catch(() => null) : null;
      const chainStatus = observation?.status ?? null;
      const snapshot = await readTreasurySnapshot(companyAddress, token).catch(() => null);
      const snapshotNeedsSync = request.status === "executed" && observation?.status === "confirmed" &&
        observation.slot !== null && snapshot !== null
        ? BigInt(snapshot.updatedSlot) < BigInt(observation.slot) : null;
      return reply(res, 200, { record: reconcilePayment(id, companyAddress, String(request.status), chainStatus),
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
      const record = getPayment(id, companyAddress);
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
      const receipt = recordOnboardingBuild({ company: companyAddress, target,
        operation: "paymentSnapshotSync", chain: transaction.sendTo,
        transactionBase64: transaction.transactionBase64 });
      return reply(res, 200, { status: "build", receiptId: receipt.id, transaction });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "prepare") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
        return reply(res, 503, { error: "Payment execution requires the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status !== "approved") return reply(res, 200, {
        record: reconcilePayment(id, companyAddress, String(request.status), null), requestStatus: request.status,
        transaction: null,
      });
      if (record.state !== "registered" && record.state !== "failed") return reply(res, 200, {
        record, requestStatus: request.status, transaction: null,
        next: record.state === "prepared" ? "submit_original_signed_transaction" : "reconcile_first",
      });
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      const plan = await executionPlan(record.request, actor, body.grant, token);
      const prepared = preparePayment(id, companyAddress, actor, plan.transaction.transactionBase64);
      return reply(res, 200, { record: prepared, ...plan });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "rebuild") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = getPayment(id, companyAddress);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status !== "approved") throw new Error("Payment must still be approved before rebuilding");
      return reply(res, 200, { record: abandonPreparedPayment(id, companyAddress),
        next: `/v1/payment-jobs/${id}/prepare` });
    }
    if (paymentJob && req.method === "POST" && paymentJob[2] === "submit") {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const id = paymentId(paymentJob[1]);
      const record = getPayment(id, companyAddress);
      await readPaymentRequest(companyAddress, record.request, token);
      const body = await readJson(req);
      if (typeof body.signedTransactionBase64 !== "string") throw new Error("signedTransactionBase64 is required");
      const bound = bindSignedPayment(id, companyAddress, body.signedTransactionBase64);
      const request = await readPaymentRequest(companyAddress, record.request, token);
      if (request.status === "executed") return reply(res, 200, {
        record: reconcilePayment(id, companyAddress, "executed", null), broadcast: "already_settled",
      });
      const endpoint = new URL(TEE_RPC);
      endpoint.searchParams.set("token", token);
      try {
        const submitted = await new Connection(endpoint.toString(), "confirmed")
          .sendRawTransaction(Transaction.from(Buffer.from(body.signedTransactionBase64, "base64")).serialize(),
            { skipPreflight: true, maxRetries: 3 });
        if (submitted !== bound.signature) throw new Error("PER returned a different signature");
        return reply(res, 200, { record: bound, broadcast: "submitted" });
      } catch {
        return reply(res, 200, { record: bound, broadcast: "uncertain",
          next: "reconcile_or_retry_same_signed_transaction" });
      }
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/payments/") && req.url.endsWith("/status")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const request = decodeURIComponent(req.url.slice("/v1/payments/".length, -"/status".length));
      return reply(res, 200, paymentStatusFromRequest(await readPaymentRequest(companyAddress, request, token)));
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/payments/") && req.url.endsWith("/build-execution")) {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
        return reply(res, 503, { error: "Payment execution requires the verified Circle devnet USDC token CPI flow" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const requestAddress = decodeURIComponent(req.url.slice("/v1/payments/".length, -"/build-execution".length));
      const body = await readJson(req);
      const actor = asAddress(body.actor, "actor");
      return reply(res, 200, await executionPlan(requestAddress, actor, body.grant, token));
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/team-grants/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const grant = decodeURIComponent(req.url.slice("/v1/team-grants/".length));
      return reply(res, 200, await readTeamGrant(companyAddress, grant, token));
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/agent-policies/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const agentPolicy = decodeURIComponent(req.url.slice("/v1/agent-policies/".length));
      return reply(res, 200, await readAgentPolicy(companyAddress, agentPolicy, token));
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/agents/") && req.url.endsWith("/build-payment")) {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
        return reply(res, 503, { error: "Agent USDC payments are not enabled for this company" });
      }
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const agentPolicyAddress = decodeURIComponent(req.url.slice("/v1/agents/".length, -"/build-payment".length));
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
    if (req.method === "GET" && req.url?.startsWith("/v1/recipient-balance/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const owner = decodeURIComponent(req.url.slice("/v1/recipient-balance/".length));
      return reply(res, 200, await readRecipientBalance({
        owner, mint: process.env.MERCURY_COMPANY_MINT, teeToken: token,
      }));
    }
    if (req.method === "POST" && req.url === "/v1/private-receive/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1") {
        return reply(res, 503, { error: "Private receive to the company PDA is still an integration experiment" });
      }
      if (process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
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
      });
      return reply(res, 200, { status: "unsigned", companyAddress, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/recipient-onboard/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_RECEIVE !== "1" || process.env.MERCURY_COMPANY_MINT !== DEVNET_USDC) {
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
      });
      return reply(res, 200, { status: "unsigned", recipient, transaction });
    }
    if (req.method === "POST" && req.url === "/v1/recipient-withdraw/build") {
      if (process.env.MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW !== "1") {
        return reply(res, 503, { error: "Recipient withdrawal is gated until the configured mint is verified" });
      }
      const mint = asAddress(process.env.MERCURY_COMPANY_MINT, "MERCURY_COMPANY_MINT");
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
    if (req.method === "POST" && req.url === "/v1/operations/build") {
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
    if (req.method === "GET" && req.url?.startsWith("/v1/transactions/")) {
      const url = new URL(req.url, `http://${host}:${port}`);
      const signature = url.pathname.slice("/v1/transactions/".length);
      if (!/^[1-9A-HJ-NP-Za-km-z]{70,90}$/.test(signature)) throw new Error("Invalid transaction signature");
      const chain = url.searchParams.get("chain");
      if (chain !== "base" && chain !== "ephemeral") throw new Error("chain must be base or ephemeral");
      const endpoint = new URL(chain === "base" ? BASE_RPC : TEE_RPC);
      if (chain === "ephemeral") {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!token) throw new Error("TEE auth token required");
        endpoint.searchParams.set("token", token);
      }
      const connection = new Connection(endpoint.toString(), "confirmed");
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
    return reply(res, 400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}).listen(port, host, () => {
  process.stdout.write(`Mercury backend listening on http://${host}:${port}\n`);
});
