import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Connection } from "@solana/web3.js";
import {
  DEVNET_USDC, asAddress, delegationStatus, preparePrivateReceive,
  prepareRecipientOnboarding, prepareRecipientWithdrawal, readRecipientBalance,
} from "./magicblock.ts";
import {
  BASE_RPC, PROGRAM_ID, TEE_RPC, TEE_VALIDATOR, buildOperation,
  paymentExecutionAccounts, paymentStatusFromRequest,
  readAgentPolicy, readCompanyPolicy, readPaymentRequest, readTreasurySnapshot,
} from "./operations.ts";

const companyAddress = asAddress(process.env.MERCURY_COMPANY_ADDRESS, "MERCURY_COMPANY_ADDRESS");
const founderAddress = asAddress(process.env.MERCURY_FOUNDER_ADDRESS, "MERCURY_FOUNDER_ADDRESS");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8787");

function reply(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > 16_384) throw new Error("Request too large");
    chunks.push(buf);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, 200, { ok: true, companyAddress, programId: PROGRAM_ID.toBase58() });
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
      const [policy, request, snapshot] = await Promise.all([
        readCompanyPolicy(companyAddress, token), readPaymentRequest(companyAddress, requestAddress, token),
        readTreasurySnapshot(companyAddress, token).catch(() => null),
      ]);
      const accounts = paymentExecutionAccounts(companyAddress, actor, policy, request);
      const transaction = await buildOperation({
        operation: "executePayment", actor, request: requestAddress,
        treasuryToken: accounts.treasuryToken, recipientToken: accounts.recipientToken,
      }, { company: companyAddress, founder: founderAddress, teeToken: token });
      const treasuryObservation = snapshot === null ? null : {
        balanceMicro: snapshot.balanceMicro,
        updatedSlot: snapshot.updatedSlot,
        coversPaymentAtLastSync: BigInt(snapshot.balanceMicro) >= BigInt(accounts.amountMicro),
      };
      return reply(res, 200, {
        requestAddress, recipient: accounts.recipient, amountMicro: accounts.amountMicro,
        treasuryObservation,
        warning: treasuryObservation?.coversPaymentAtLastSync === false
          ? "Last treasury snapshot is below this payment; fund and resync before signing"
          : null,
        transaction,
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/agent-policies/")) {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new Error("TEE auth token required");
      const agentPolicy = decodeURIComponent(req.url.slice("/v1/agent-policies/".length));
      return reply(res, 200, await readAgentPolicy(companyAddress, agentPolicy, token));
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
