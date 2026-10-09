# Mercury agents: devnet build plan

Mercury has one user-facing Finance Agent. Invoice review and payroll readiness can become its tools, rather than separate chatbots. A later x402 spending capability needs a separate, tightly funded signing boundary.

## 1. Finance Assistant (human-facing)

The agent answers questions from private company state and prepares work for the authenticated user. It resolves the wallet's active grant before each private tool call. The model chooses among role-filtered tools; Mercury code validates every call, executes it, and returns a narrow result. A revoked grant or parent grant stops the next tool call.

Current tools: last private treasury snapshot for Founder or active root Finance; status of an explicitly selected payment request for a member with active, appropriate scope and PER read access; unsigned payment draft for Founder or Finance using a user-selected active registered payee and stable payment ID. A wallet signs a one-use, five-minute challenge before each run. The caller supplies their own TEE access token. The agent endpoint is off by default and requires `MERCURY_ENABLE_FINANCE_ASSISTANT=1`.

Next actions, in order:

1. Add invoice document intake, review evidence, duplicate and changed-payee flags, and a persistent case state from draft through settlement. Keep the invoice file encrypted outside chain state.
2. Add payroll readiness and failed-item explanations. The agent must never choose a salary, approve its own request, or release payroll.
3. Add a durable conversation and sourced answers from scoped tool results. Do not put the entire company journal into model context.

The assistant's model can classify and summarize. Mercury code and the onchain program decide grant validity, recipient, limits, payment ID, signing requirements, and settlement. `Send this` prepares a transaction; it is not a signature.

## 2. Tool Spender (background worker)

This is a separate signing boundary for purchases made to finish an assigned task, such as an approved paid API. Founder funds a small isolated balance and can revoke it. Each purchase needs an asset/network check, a per-purchase cap, a period cap, an approved service and recipient, expiry, a task reference, and a final receipt. The worker never has the company treasury key.

Mercury currently proves a capped float and one fixed recipient in the contract. It does **not** have an x402 client. A standard Solana x402 V2 client signs an accepted payment option and retries the HTTP request; its facilitator verifies and settles the payment. The existing PDA-owned PER float cannot be assumed compatible with that signing and transaction format. First prove one real devnet x402 V2 `exact` purchase through a dedicated, tiny funded signer or a verified policy-aware adapter. Do not claim arbitrary merchant support or private x402 settlement before that proof. A direct signer wallet's funded balance is its onchain maximum exposure; offchain per-purchase checks alone are not contract-enforced.

## Model and credentials

One model is enough for the first agent and invoice extraction. The chat agent defaults to Fireworks' OpenAI-compatible endpoint with `accounts/fireworks/models/deepseek-v4p1-flash`. The account's accessible Kimi K3 model also passed a function-calling smoke test; set `MERCURY_AGENT_MODEL=accounts/fireworks/models/kimi-k3` to try it. Configure `MERCURY_FIREWORKS_API_KEY` only in the local environment. No provider key is committed to Git. A local compatible endpoint can be set with `MERCURY_AGENT_MODEL_URL` and `MERCURY_AGENT_MODEL`. Hosted inference requires `MERCURY_ALLOW_REMOTE_LLM=1`. Unlike the old read-only classifier, the agent sends narrow tool results such as amounts and status to the model for follow-up reasoning, so the hosted provider receives that information. A model API key pays for inference; it is not an agent payment key. The x402 spender requires a separate signer and facilitator-compatible client later.

Before a public launch, compare invoice extraction accuracy on real examples, Nepali/English answers, latency, cost, and provider data handling. A live Fireworks tool-call smoke test passed; the backend tests use a mock and do not require a paid API key.

## Current assistant HTTP surface

`POST /v1/assistant/challenge` takes `{ "actor": "<wallet>" }` and returns a message to sign. `POST /v1/agent/chat` takes `{ "actor", "challengeId", "signature", "message", "grant?", "requestAddress?", "selectedPayeeId?", "selectedRecipient?", "paymentId?" }` with `Authorization: Bearer <caller TEE token>`. A non-Founder supplies `grant`. The three payee/payment fields must all be present to make the draft tool available. The backend verifies the one-use signature and grant, offers only allowed tools to the model, rechecks access for every call, and records a registered-payee draft. The response includes the unsigned terms and `/v1/payment-flows/:paymentId/next`. The older `POST /v1/assistant/query` remains as a read-only classifier endpoint. Neither endpoint signs or submits a transaction.

The server is still local and configured for one company. This is a working backend tool loop, not yet a complete chat product. Model free text is untrusted; after a tool call, the final answer is constructed from verified backend results. For public deployment, add rate limits, durable replay protection across processes, a wallet-to-TEE-token binding check, and encrypted model/tool audit records.

## References

- [Solana x402 V2](https://solana.com/docs/payments/agentic-payments/x402)
- [x402 facilitator verification and settlement](https://solana.com/docs/tools/x402-facilitator)
- [DeepSeek OpenAI-compatible API](https://api-docs.deepseek.com/en/)
- [MagicBlock private SPL transfer API](https://docs.magicblock.gg/pages/ephemeral-spl-token/api-reference/transfer)
- [Fireworks chat completions and tools](https://docs.fireworks.ai/api-reference/post-chatcompletions)
