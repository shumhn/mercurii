import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { BASE_RPC, TEE_RPC } from "../src/operations.ts";

const company = process.env.MERCURY_INVOICE_PROOF_COMPANY;
const founderPath = process.env.MERCURY_INVOICE_PROOF_FOUNDER_KEYPAIR;
const recipient = process.env.MERCURY_INVOICE_PROOF_RECIPIENT;
if (!company || !founderPath || !recipient) throw new Error("Set invoice proof company, Founder keypair, and recipient");
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(founderPath, "utf8"))));
const founderAddress = founder.publicKey.toBase58();
const token = (await getAuthToken(TEE_RPC, founder.publicKey,
  async (message: Uint8Array) => nacl.sign.detached(message, founder.secretKey))).token;
const directory = mkdtempSync(join(tmpdir(), "mercury-guided-recovery-"));
const port = await new Promise<number>((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    if (!address || typeof address === "string") return reject(new Error("No local port"));
    socket.close(() => resolve(address.port));
  });
});
const server = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
    MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: founderAddress,
    MERCURY_COMPANY_MINT: DEVNET_USDC,
    MERCURY_PAYMENT_FLOW_JOURNAL: join(directory, "flows.json"),
    MERCURY_ONBOARDING_JOURNAL: join(directory, "receipts.json") },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1000); });
const base = `http://127.0.0.1:${port}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function next(id: string): Promise<Record<string, any>> {
  const response = await fetch(`${base}/v1/payment-flows/${id}/next`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ requester: founderAddress, recipient, amountMicro: 10000,
      includeFinance: false, actor: founderAddress }), signal: AbortSignal.timeout(60_000),
  });
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`Guided flow: HTTP ${response.status}: ${String(value.error).slice(0, 300)}`);
  return value;
}
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* Starting. */ }
    await pause(250);
  }
  if (!ready) throw new Error(`Backend failed to start: ${stderr.slice(0, 300)}`);
  const id = randomUUID();
  const first = await next(id);
  const startedAt = Date.now();
  assert.equal(first.step.operation, "createRequestShell");
  assert.ok(first.receiptId && first.transaction?.transactionBase64);
  const repeat = await next(id);
  assert.equal(repeat.step.status, "wait");
  assert.equal(repeat.receiptId, first.receiptId);
  // The stored shell uses its own blockhash; read it from the unsigned transaction.
  const oldBlockhash = Transaction.from(Buffer.from(first.transaction.transactionBase64, "base64")).recentBlockhash;
  assert.ok(oldBlockhash);
  const rpc = new Connection(BASE_RPC, "confirmed");
  let replacement: Record<string, any> | null = null;
  for (let i = 0; i < 45; i++) {
    await pause(5_000);
    const valid = await rpc.isBlockhashValid(oldBlockhash, { commitment: "finalized" });
    if (!valid.value && Date.now() - startedAt >= 90_000) {
      replacement = await next(id);
      if (replacement.transaction?.transactionBase64) break;
    }
  }
  assert.ok(replacement?.transaction?.transactionBase64, "Expired unsigned shell was not rebuilt");
  assert.notEqual(replacement.receiptId, first.receiptId);
  assert.equal(replacement.step.operation, "createRequestShell");
  console.log(JSON.stringify({ result: "PASS", company, paymentId: id,
    expiredReceipt: first.receiptId, replacementReceipt: replacement.receiptId,
    noTransactionBroadcast: true }));
} finally {
  server.kill("SIGTERM");
  rmSync(directory, { recursive: true, force: true });
}
