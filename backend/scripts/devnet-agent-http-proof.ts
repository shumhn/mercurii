import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Keypair } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { TEE_RPC } from "../src/operations.ts";

const company = process.env.MERCURY_AGENT_PROOF_COMPANY;
const keypairPath = process.env.MERCURY_AGENT_PROOF_FOUNDER_KEYPAIR;
const request = process.env.MERCURY_AGENT_PROOF_REQUEST;
if (!company || !keypairPath || !request || !process.env.MERCURY_FIREWORKS_API_KEY) {
  throw new Error("Set MERCURY_AGENT_PROOF_COMPANY, MERCURY_AGENT_PROOF_FOUNDER_KEYPAIR, MERCURY_AGENT_PROOF_REQUEST, and MERCURY_FIREWORKS_API_KEY");
}
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const auth = await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey));

const port = await new Promise<number>((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    if (!address || typeof address === "string") return reject(new Error("No proof port"));
    const selected = address.port;
    socket.close(() => resolve(selected));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1",
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: founder.publicKey.toBase58(),
    MERCURY_ENABLE_FINANCE_ASSISTANT: "1", MERCURY_ALLOW_REMOTE_LLM: "1",
    MERCURY_ENABLE_X402_AGENT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1_000); });

async function api(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, { method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${String(value.error).slice(0, 300)}`);
  return value;
}

async function signedBody(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = founder.publicKey.toBase58();
  const challenge = await api("/v1/assistant/challenge", { actor });
  return { actor, challengeId: challenge.challengeId,
    signature: bs58.encode(nacl.sign.detached(Buffer.from(String(challenge.message)), founder.secretKey)),
    ...extra };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) { ready = true; break; }
    } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Agent HTTP server did not start: ${stderr.slice(0, 300)}`);

  const first = await api("/v1/agent/chat", await signedBody({
    message: "Check the selected private payment request's current status using the payment status tool.",
    requestAddress: request,
  }));
  assert.ok(first.actions?.some((action: { tool: string }) => action.tool === "get_payment_status"),
    "The real model must call the private payment tool");
  assert.match(String(first.answer), /executed|approved|submitted|rejected/i);
  assert.match(String(first.sessionId), /^[0-9a-f-]{36}$/i);

  const second = await api("/v1/agent/chat", await signedBody({
    message: "Check that same payment again from its private record. Has its status changed?",
    sessionId: first.sessionId,
  }));
  assert.equal(second.sessionId, first.sessionId);
  assert.ok(second.actions?.some((action: { tool: string }) => action.tool === "get_payment_status"),
    "The follow-up must reuse the selected request and refresh the private status");

  const audit = await api("/v1/agent/audit", await signedBody({ limit: 10 }));
  assert.ok(audit.events?.filter((event: { event: string; tool?: string }) =>
    event.event === "tool" && event.tool === "get_payment_status").length >= 2);
  assert.ok(audit.events?.filter((event: { event: string }) => event.event === "completed").length >= 2);
  console.log(JSON.stringify({ status: "passed", company, actor: founder.publicKey.toBase58(),
    request, firstTools: first.actions.map((action: { tool: string }) => action.tool),
    secondTools: second.actions.map((action: { tool: string }) => action.tool),
    sessionReused: first.sessionId === second.sessionId, auditEvents: audit.events.length,
    firstAnswer: first.answer, secondAnswer: second.answer }));
} finally {
  server.kill("SIGTERM");
}
