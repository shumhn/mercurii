import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { DEVNET_USDC } from "../src/magicblock.ts";

test("invoice HTTP suggestion links one guided flow and rejects changed terms", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mercury-invoice-http-"));
  const company = Keypair.generate().publicKey.toBase58();
  const founder = Keypair.generate().publicKey.toBase58();
  const agent = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  let amount = "12.50";
  const model = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      vendorName: "Acme Cloud LLC", invoiceNumber: "AC-102", currency: "USD",
      amount, dueDate: null, summary: "API credits",
    }) } }] }));
  });
  model.listen(0, "127.0.0.1");
  await once(model, "listening");
  const modelPort = (model.address() as { port: number }).port;
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const backendPort = (probe.address() as { port: number }).port;
  probe.close();
  await once(probe, "close");
  const backend = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(backendPort),
      MERCURY_COMPANY_ADDRESS: company, MERCURY_FOUNDER_ADDRESS: founder,
      MERCURY_COMPANY_MINT: DEVNET_USDC, MERCURY_ENABLE_INVOICE_AGENT: "1",
      MERCURY_AGENT_API_KEY: "invoice-test-secret-123", MERCURY_SUGGEST_AGENT_ADDRESS: agent,
      MERCURY_LLM_URL: `http://127.0.0.1:${modelPort}/v1/chat/completions`,
      MERCURY_LLM_MODEL: "mock", MERCURY_VENDOR_REGISTRY_JSON: JSON.stringify({
        acme: { name: "Acme Cloud LLC", recipient, maxInvoiceMicro: "50000000" },
      }),
      MERCURY_INVOICE_JOURNAL: join(directory, "invoices.json"),
      MERCURY_PAYMENT_FLOW_JOURNAL: join(directory, "flows.json"),
    },
    stdio: "ignore",
  });
  try {
    const base = `http://127.0.0.1:${backendPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(`${base}/health`)).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "backend did not start");
    const suggest = async () => fetch(`${base}/v1/agent/invoice-suggestions`, {
      method: "POST", headers: { authorization: "Bearer invoice-test-secret-123", "content-type": "application/json" },
      body: JSON.stringify({ vendorId: "acme", invoiceText: "Acme Cloud invoice AC-102 for API credits totaling $12.50." }),
    });
    const firstResponse = await suggest();
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as Record<string, unknown>;
    assert.equal(first.repeated, false);
    assert.equal(first.guidedFlow, `/v1/payment-flows/${first.paymentId}/next`);
    assert.equal((first.flowTerms as Record<string, unknown>).amountMicro, 12_500_000);
    assert.equal(first.requestPlan, undefined);
    const secondResponse = await suggest();
    const second = await secondResponse.json() as Record<string, unknown>;
    assert.equal(secondResponse.status, 200);
    assert.equal(second.paymentId, first.paymentId);
    assert.equal(second.requestAddress, first.requestAddress);
    assert.equal(second.repeated, true);
    amount = "13.00";
    const changed = await suggest();
    assert.equal(changed.status, 400);
    assert.match(JSON.stringify(await changed.json()), /different payment terms/);
    assert.equal(readFileSync(join(directory, "invoices.json"), "utf8").includes("AC-102"), false);
  } finally {
    backend.kill();
    model.close();
    await once(model, "close");
    rmSync(directory, { recursive: true, force: true });
  }
});
