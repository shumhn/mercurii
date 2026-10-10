import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { base58 } from "@scure/base";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { DEVNET_USDC } from "../src/magicblock.ts";
import { filterX402Requirements, purchaseX402, reconcileX402Purchase,
  resolveRejectedX402Purchase,
  type X402Service } from "../src/x402-spender.ts";

const url = "https://x402.payai.network/api/solana-devnet/paid-content";
const service: X402Service = { url, payTo: "8sqyMHQwBh8BCXC99pdgt6BpXwLu9xqfL1hDV5SFYf3R",
  maxMicro: "10000", periodCapMicro: "20000", expiresAt: "2030-01-01T00:00:00.000Z" };
const rpcUrl = process.env.MERCURY_X402_RPC_URL ?? "https://api.devnet.solana.com";
const signerPath = process.env.MERCURY_X402_SIGNER_FILE ??
  new URL("../.state/x402-signer.key", import.meta.url).pathname;
const attempt = process.env.MERCURY_X402_PROOF_ATTEMPT ?? "1";
const company = process.env.MERCURY_X402_COMPANY;
if (!company) throw new Error("Set MERCURY_X402_COMPANY for this company-scoped proof");
if (!["1", "2", "3"].includes(attempt)) throw new Error("x402 proof allows three bounded attempts");
const taskPath = new URL(`../.state/x402-proof-task-id${attempt === "1" ? "" : `-${attempt}`}`,
  import.meta.url).pathname;

const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
if (response.status !== 402) throw new Error(`Expected an x402 challenge, got ${response.status}`);
const header = response.headers.get("PAYMENT-REQUIRED");
if (!header) throw new Error("Merchant did not return a V2 payment requirement");
const required = decodePaymentRequiredHeader(header);
const allowed = required.x402Version === 2 ? filterX402Requirements(required.accepts, service) : [];
if (allowed.length !== 1 || allowed[0]!.amount !== service.maxMicro) {
  throw new Error("Merchant's x402 payment terms changed; review before paying");
}
const signerSecret = readFileSync(signerPath, "utf8").trim();
const signer = Keypair.fromSecretKey(base58.decode(signerSecret));
const rpc = new Connection(rpcUrl, "confirmed");
const accounts = await rpc.getParsedTokenAccountsByOwner(signer.publicKey,
  { mint: new PublicKey(DEVNET_USDC) });
const balanceMicro = accounts.value.reduce((sum, entry) =>
  sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount as string), 0n);
const mode = process.env.MERCURY_X402_PROOF_STEP ?? "probe";
console.log(JSON.stringify({ mode, wallet: signer.publicKey.toBase58(), balanceMicro: balanceMicro.toString(),
  merchant: url, priceMicro: service.maxMicro, payTo: service.payTo }));
if (mode === "probe") process.exit(0);
if (mode === "reconcile") {
  const taskId = readFileSync(taskPath, "utf8").trim();
  const result = await reconcileX402Purchase({ company, taskId, serviceId: "payai_echo",
    registry: { payai_echo: service }, signerSecret, rpcUrl });
  console.log(JSON.stringify({ taskId, result }));
  process.exit(0);
}
if (mode === "resolve-rejected") {
  const taskId = readFileSync(taskPath, "utf8").trim();
  const result = await resolveRejectedX402Purchase({ company, taskId, serviceId: "payai_echo",
    registry: { payai_echo: service }, signerSecret, rpcUrl });
  console.log(JSON.stringify({ taskId, result }));
  process.exit(0);
}
if (mode !== "pay") throw new Error("MERCURY_X402_PROOF_STEP must be probe, pay, reconcile, or resolve-rejected");
if (process.env.MERCURY_CONFIRM_X402_PAYMENT !== "pay-exactly-10000") {
  throw new Error("Set MERCURY_CONFIRM_X402_PAYMENT=pay-exactly-10000 to run the one-shot proof");
}
if (balanceMicro < BigInt(service.maxMicro)) throw new Error("Isolated wallet has insufficient Circle devnet USDC");
let taskId: string;
try { taskId = readFileSync(taskPath, "utf8").trim(); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  taskId = randomUUID();
  writeFileSync(taskPath, `${taskId}\n`, { flag: "wx", mode: 0o600 });
}
const result = await purchaseX402({ company, taskId, serviceId: "payai_echo", registry: { payai_echo: service },
  signerSecret, rpcUrl });
console.log(JSON.stringify({ taskId, result }));
