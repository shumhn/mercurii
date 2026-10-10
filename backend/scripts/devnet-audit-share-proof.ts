import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { Keypair } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { TEE_RPC, readPaymentRequest } from "../src/operations.ts";
import { getPayrollRun } from "../src/payroll-run.ts";

const company = process.env.MERCURY_AUDIT_PROOF_COMPANY;
const founderKeypairPath = process.env.MERCURY_AUDIT_PROOF_FOUNDER_KEYPAIR;
const runId = process.env.MERCURY_AUDIT_PROOF_PAYROLL_RUN;
if (!company || !founderKeypairPath || !runId) {
  throw new Error("Set MERCURY_AUDIT_PROOF_COMPANY, MERCURY_AUDIT_PROOF_FOUNDER_KEYPAIR, and MERCURY_AUDIT_PROOF_PAYROLL_RUN");
}

const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(founderKeypairPath, "utf8"))));
const actor = founder.publicKey.toBase58();
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));
const auditJournal = new URL(`../.state/devnet-audit-proof-${company}.json`, import.meta.url).pathname;
if (existsSync(auditJournal)) rmSync(auditJournal, { force: true });

const port = await new Promise<number>((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    if (!address || typeof address === "string") return reject(new Error("No proof port"));
    socket.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: actor,
    MERCURY_COMPLIANCE_AUDIT_JOURNAL: auditJournal },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1_000); });

async function request(path: string, method: string, token: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, { method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${String(value.error).slice(0, 300)}`);
  return value;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Audit proof server did not start: ${stderr.slice(0, 300)}`);
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

try {
  await waitForServer();
  const run = getPayrollRun(runId, company);
  assert.ok(run.items.length > 0, "Payroll run must contain at least one private payment");
  const firstRequest = await readPaymentRequest(company, run.items[0]!.request, auth.token);
  const recipient = String(firstRequest.recipient);
  const amountMicro = String(firstRequest.amountMicro);

  const created = await request("/v1/compliance/audits", "POST", auth.token, {
    actor, label: "Devnet private payroll evidence", expiresInDays: 1, runIds: [runId],
  });
  const audit = created.audit;
  const auditor = created.auditorAccess;
  assert.equal(audit.accessCount, 0);
  assert.match(String(auditor.token), /^[A-Za-z0-9_-]{43}$/);

  const durable = JSON.parse(readFileSync(auditJournal, "utf8")) as { audits: Array<Record<string, unknown>>; events: unknown[] };
  // Ciphertext is intentionally opaque random/base64 data and can coincidentally
  // contain a short numeric salary sequence. Inspect only durable metadata outside
  // the encrypted envelope for a plaintext disclosure.
  const visibleMetadata = {
    audits: durable.audits.map(({ envelope: _envelope, ...share }) => share), events: durable.events,
  };
  const metadataLeaves = stringLeaves(visibleMetadata);
  assert.equal(metadataLeaves.includes(recipient), false, "Auditor journal metadata retained a payroll recipient in plaintext");
  assert.equal(metadataLeaves.includes(amountMicro), false, "Auditor journal metadata retained a salary amount in plaintext");
  assert.equal(metadataLeaves.includes(String(auditor.token)), false, "Auditor journal metadata retained its bearer token");

  const opened = await request(String(auditor.endpoint), "GET", String(auditor.token));
  assert.equal(opened.bundle.company, company);
  assert.equal(opened.bundle.payrollRuns.length, 1);
  assert.equal(opened.bundle.payrollRuns[0].runId, runId);
  assert.equal(opened.bundle.payrollRuns[0].items[0].recipient, recipient);
  assert.equal(opened.bundle.payrollRuns[0].items[0].amountMicro, amountMicro);

  const wrong = await fetch(`${base}${auditor.endpoint}`, { headers: { authorization: `Bearer ${randomBytes(32).toString("base64url")}` }, signal: AbortSignal.timeout(30_000) });
  assert.equal(wrong.ok, false, "Invalid auditor token was accepted");
  await request(`${auditor.endpoint}/revoke`, "POST", auth.token, { actor });
  const revoked = await fetch(`${base}${auditor.endpoint}`, { headers: { authorization: `Bearer ${auditor.token}` }, signal: AbortSignal.timeout(30_000) });
  assert.equal(revoked.ok, false, "Revoked auditor token was accepted");

  const events = await request(`/v1/compliance/audit-events?auditId=${audit.auditId}`, "GET", auth.token);
  assert.deepEqual(events.events.map((event: { action: string }) => event.action), ["revoked", "opened", "created"]);
  console.log(JSON.stringify({ result: "PASS", company, runId, auditId: audit.auditId,
    frozenRunCount: opened.bundle.payrollRuns.length, openedOnce: opened.share.accessCount === 1,
    encryptedJournalNoRecipientOrAmount: true, invalidTokenRejected: true, revokedTokenRejected: true }));
} finally {
  server.kill("SIGTERM");
}
