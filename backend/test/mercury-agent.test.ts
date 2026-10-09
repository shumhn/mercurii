import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { runMercuryAgent } from "../src/mercury-agent.ts";

const address = () => Keypair.generate().publicKey.toBase58();
const company = address();
const founder = address();
const recipient = address();
const grantAddress = address();

function modelReplies(...messages: Record<string, unknown>[]): typeof fetch {
  let index = 0;
  return (async (_url: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { tools: Array<{ function: { name: string } }> };
    assert.ok(body.tools.length > 0);
    const message = messages[index++];
    assert.ok(message, "unexpected model call");
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as typeof fetch;
}

const call = (name: string, args: Record<string, unknown>) => ({ id: "tool-1", type: "function",
  function: { name, arguments: JSON.stringify(args) } });
const base = { company, founder, actor: founder, teeToken: "tee", message: "Prepare a 1 USDC vendor payment",
  modelUrl: "http://127.0.0.1:8080/v1/chat/completions", modelName: "test-model",
  resolveAccess: (async () => ({ actor: founder, role: "founder" as const, scope: null })) as typeof import("../src/finance-assistant.ts").resolveAssistantAccess };

test("agent prepares one unsigned registered-payee draft and never claims settlement", async () => {
  let created = 0;
  const result = await runMercuryAgent({ ...base, selectedPayeeId: "vendor-1",
    selectedRecipient: recipient, selectedAmountMicro: 1000000, paymentId: "payment-1",
    fetchImpl: modelReplies({ content: null, tool_calls: [call("prepare_payment_draft",
      { amountMicro: "1000000", purpose: "Invoice" })] },
    { content: "The payment was sent." }),
    matchRegisteredPayee: (() => ({ active: true })) as unknown as typeof import("../src/payee-journal.ts").matchPayee,
    readPolicy: (async () => ({ address: company, founder })) as typeof import("../src/operations.ts").readCompanyPolicy,
    createFlow: (() => { created++; return { flow: { paymentId: "payment-1", request: address() } }; }) as unknown as typeof import("../src/payment-flow.ts").getOrCreatePaymentFlow,
    linkPayee: (() => ({})) as unknown as typeof import("../src/payee-journal.ts").linkPaymentPayee,
  });
  assert.equal(created, 1);
  assert.equal(result.paymentSent, false);
  assert.match(String(result.answer), /unsigned draft/);
  assert.equal((result.actions as Array<{ result: { amountMicro: string } }>)[0]?.result.amountMicro, "1000000");
});

test("agent cannot draft without selected payee or remote-model opt-in", async () => {
  await assert.rejects(runMercuryAgent({ ...base, fetchImpl: modelReplies({ content: null,
    tool_calls: [call("prepare_payment_draft", { amountMicro: "1000000", purpose: "Invoice" })] }) }),
  /Tool not allowed/);
  await assert.rejects(runMercuryAgent({ ...base, modelUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    fetchImpl: modelReplies({ content: "hello" }) }), /privacy opt-in/);
});

test("agent rejects a model amount that differs from the user-selected amount", async () => {
  await assert.rejects(runMercuryAgent({ ...base, selectedPayeeId: "vendor-1",
    selectedRecipient: recipient, selectedAmountMicro: 1000000, paymentId: "payment-3",
    fetchImpl: modelReplies({ content: null, tool_calls: [call("prepare_payment_draft",
      { amountMicro: "10000000", purpose: "Invoice" })] }),
  }), /differs from the user-selected amount/);
});

test("agent never presents an unverified model answer as a company fact", async () => {
  const ungrounded = await runMercuryAgent({ ...base,
    fetchImpl: modelReplies({ content: "Your company has 9 million USDC." }) });
  assert.doesNotMatch(String(ungrounded.answer), /9 million/);
  assert.deepEqual(ungrounded.actions, []);

  const grounded = await runMercuryAgent({ ...base,
    message: "What is our current treasury snapshot?",
    fetchImpl: modelReplies({ content: null, tool_calls: [call("get_treasury_snapshot", {})] },
      { content: "Your company has 9 million USDC." }),
    answerQuestion: (async () => ({ answer: "Last synced treasury balance is 1.25 USDC; this is not live.",
      facts: { balanceMicro: "1250000", updatedSlot: 42 } })) as typeof import("../src/finance-assistant.ts").answerAssistantQuestion,
  });
  assert.match(String(grounded.answer), /1\.25 USDC/);
  assert.doesNotMatch(String(grounded.answer), /9 million/);
  assert.equal(grounded.agent, "Mercury Finance Agent");
});

test("Fireworks agent uses low thinking while keeping enough output for a tool call", async () => {
  const result = await runMercuryAgent({ ...base, allowRemoteModel: true,
    modelUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    fetchImpl: (async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.max_tokens, 2048);
      return new Response(JSON.stringify({ choices: [{ message: { content: "The balance is 9 million." } }] }),
        { status: 200 });
    }) as typeof fetch,
  });
  assert.doesNotMatch(String(result.answer), /9 million/);
});

test("agent enforces finance recipient and payment cap before creating draft", async () => {
  let created = false;
  await assert.rejects(runMercuryAgent({ ...base, actor: address(), grant: grantAddress,
    selectedPayeeId: "vendor-1", selectedRecipient: recipient, selectedAmountMicro: 2000000,
    paymentId: "payment-2",
    resolveAccess: (async () => ({ actor: "finance", role: "finance" as const, scope: null })) as typeof import("../src/finance-assistant.ts").resolveAssistantAccess,
    fetchImpl: modelReplies({ content: null, tool_calls: [call("prepare_payment_draft",
      { amountMicro: "2000000", purpose: "Invoice" })] }),
    matchRegisteredPayee: (() => ({ active: true })) as unknown as typeof import("../src/payee-journal.ts").matchPayee,
    readPolicy: (async () => ({ address: company, founder })) as typeof import("../src/operations.ts").readCompanyPolicy,
    readGrant: (async () => ({ active: true, revoked: false, member: "finance", recipients: [recipient],
      perPaymentCapMicro: "1000000" })) as typeof import("../src/operations.ts").readTeamGrant,
    createFlow: (() => { created = true; throw new Error("should not create"); }) as typeof import("../src/payment-flow.ts").getOrCreatePaymentFlow,
  }), /does not allow/);
  assert.equal(created, false);
});
