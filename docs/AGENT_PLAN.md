# Mercury agents: devnet build plan

Mercury has two agent capabilities, each with a different money boundary. Invoice review and payroll readiness are tools of the Finance Assistant, not separate wallets or separate models.

## 1. Finance Assistant (human-facing)

The assistant answers questions from private company state and prepares work for the authenticated user. It must resolve the wallet's active grant before each private tool call. The model sees only the user's question for intent classification; it does not receive raw treasury, payroll, or payment records by default. The backend chooses and executes allowlisted tools and returns sourced facts. A revoked grant or parent grant stops the next request.

Current read tools: last private treasury snapshot for Founder or active root Finance; status of an explicitly selected payment request for a member with active, appropriate scope and PER read access. A wallet signs a one-use, five-minute challenge before each query. The caller supplies their own TEE access token. The assistant endpoint is off by default and requires `MERCURY_ENABLE_FINANCE_ASSISTANT=1`.

Next actions, in order:

1. Add authenticated payment drafting from a registered payee, exact amount, purpose, and stable payment ID. Show all terms before the user signs. Reuse the guided payment flow and its existing approval, execution, and reconciliation gates.
2. Add invoice document intake, review evidence, duplicate and changed-payee flags, and a persistent case state from draft through settlement. Keep the invoice file encrypted outside chain state.
3. Add payroll readiness and failed-item explanations. The assistant must never choose a salary, approve its own request, or release payroll.
4. Add short, source-linked answers from scoped tool results. Do not put the entire company journal into model context.

The assistant's model can classify and summarize. Mercury code and the onchain program decide grant validity, recipient, limits, payment ID, signing requirements, and settlement. `Send this` prepares a transaction; it is not a signature.

## 2. Tool Spender (background worker)

This is a separate signing boundary for purchases made to finish an assigned task, such as an approved paid API. Founder funds a small isolated balance and can revoke it. Each purchase needs an asset/network check, a per-purchase cap, a period cap, an approved service and recipient, expiry, a task reference, and a final receipt. The worker never has the company treasury key.

Mercury currently proves a capped float and one fixed recipient in the contract. It does **not** have an x402 client. A standard Solana x402 V2 client signs an accepted payment option and retries the HTTP request; its facilitator verifies and settles the payment. The existing PDA-owned PER float cannot be assumed compatible with that signing and transaction format. First prove one real devnet x402 V2 `exact` purchase through a dedicated, tiny funded signer or a verified policy-aware adapter. Do not claim arbitrary merchant support or private x402 settlement before that proof. A direct signer wallet's funded balance is its onchain maximum exposure; offchain per-purchase checks alone are not contract-enforced.

## Model and credentials

One model is enough for the first assistant and invoice extraction. The current backend uses an OpenAI-compatible `/chat/completions` endpoint, so a local model or compatible hosted provider can be configured with `MERCURY_LLM_URL`, `MERCURY_LLM_MODEL`, and `MERCURY_LLM_API_KEY`. No provider key is committed to Git. Local is the default; sending a question or invoice to a hosted model requires `MERCURY_ALLOW_REMOTE_LLM=1` and a deliberate data-sharing choice. A model API key pays for inference; it is not an agent payment key. The x402 spender requires a separate signer and facilitator-compatible client later.

Before choosing a provider, compare extraction accuracy on actual invoice examples, tool intent accuracy, Nepali/English answers, latency, cost, and the provider's data handling. Do not choose solely from a model benchmark. The current read endpoint works with a mock or local model without a paid API key.

## Current assistant HTTP surface

`POST /v1/assistant/challenge` takes `{ "actor": "<wallet>" }` and returns a message to sign. `POST /v1/assistant/query` takes `{ "actor", "challengeId", "signature", "question", "grant?", "requestAddress?" }` with `Authorization: Bearer <caller TEE token>`. `grant` is required for non-Founder wallets. `requestAddress` is required for a payment-status question. The backend verifies the one-use signature and active grant, calls the configured model to classify the question, then reads only the permitted private account. Neither endpoint signs or submits a transaction.

The server is still local and configured for one company. The read endpoint is an initial backend capability, not a completed chat product. A remote model only sees the question, but the question itself may be sensitive. For public deployment, add rate limits, durable replay protection across processes, a wallet-to-TEE-token binding check, and encrypted model/tool audit records.

## References

- [Solana x402 V2](https://solana.com/docs/payments/agentic-payments/x402)
- [x402 facilitator verification and settlement](https://solana.com/docs/tools/x402-facilitator)
- [DeepSeek OpenAI-compatible API](https://api-docs.deepseek.com/en/)
- [MagicBlock private SPL transfer API](https://docs.magicblock.gg/pages/ephemeral-spl-token/api-reference/transfer)
