# Mercury backend and smart contract

Mercury is private USDC operations for onchain teams: a company treasury, payment approvals, and bounded agent spending. This repo is a **devnet implementation in progress**. It is not ready for real funds.

## Current contract

The Anchor program in `programs/mercury/src/lib.rs` has five PER state account types:

| Account | Readers | Function |
| --- | --- | --- |
| CompanyPolicy | Founder, Finance, and explicitly delegated Manager readers | USDC mint, period budget, reserved/spent amount, treasury authority |
| TeamGrant | Founder, member, grantor, and permitted child readers | Private Finance/Manager role, approved recipients, per-payment and period caps, parent link, revocation |
| PaymentRequest | Requester, Founder, Finance, and an optionally assigned Manager | Private recipient/amount; submit, approve, execute, reject |
| AgentPolicy | Agent, Founder, Finance until Agent revocation | Separate token float authority, one approved recipient, per-payment and period caps; Finance read cleanup after a separate TeamGrant revocation remains open |
| TreasurySnapshot | Founder, Finance | Manually synchronized private view of the canonical company token account balance and observation slot |

Each account starts as a non-confidential shell on Solana base, is delegated to the same TEE PER, receives an ER-local permission, and is made private **before confidential fields are written**. PER permissions control reads. The Mercury program separately checks signer and business policy. Founder/Finance/requester/agent pubkeys and account creation remain public in this prototype.

Founder can approve and execute directly. Finance needs an active Founder-issued TeamGrant with recipient allowlist and amount/period caps. Finance may issue a narrower Manager grant only when permitted; Manager can approve a privately shared request but cannot execute from the treasury. Approval reserves the company budget. `execute_payment` checks approved period, request status, recipient owner, mint, source authority, available reserve, and the executing Finance grant when applicable. It then makes a PDA-signed SPL Token CPI and updates request/budget state in the same PER transaction. A failed CPI must revert the state update. The agent's `agent_pay` path still requires its own key and separate capped float. Agent float funding/reclaim is Founder-only in the current permission revision; an earlier devnet proof used Finance before that restriction.

The token path has been exercised end to end on the private devnet ER with **both a locally minted six-decimal test token and Circle devnet USDC**. The company PDA received through MagicBlock's hosted payment builder, Finance executed an approved payout through Mercury's PDA-signed SPL CPI, and a recipient withdrew with their own wallet. The separate AgentPolicy-owned float was funded and spent with Circle devnet USDC. Revocation and reclaim were exercised with the custom test mint; those two actions have not been repeated with Circle USDC. Do not use real funds.

For employee, contractor, and vendor payouts, the current Mercury program sends to a recipient token account already on the same PER. The recipient can read their own balance through the TEE and build a wallet-signed withdrawal through MagicBlock's Private Payments API. Both recipient operations were verified on devnet with the custom test mint and Circle devnet USDC; an outsider was denied the private balance. A frontend wallet-login flow remains unimplemented. Direct company-PDA-to-base payouts through the API remain unimplemented.

This is **not yet a full payroll payout workflow**. It proves one employee payment rail, but has no private employee roster, approved multi-recipient payroll run, per-item retry/status, or payroll reconciliation. A human-approved private payroll run is in the Mercury MVP plan; HR, tax, payslips, and fiat payroll are outside this build.

## Current backend

`backend/` is a local, noncustodial HTTP service. It has:

- `POST /v1/onboarding/next`: with a Founder TEE bearer token and `{ "actor": "<Founder wallet>", "finance": "<Finance wallet>", "monthlyLimitMicro": 100000000, "agentCapMicro": 10000000 }`, reads base, router, and PER state for the configured Circle devnet USDC company. It returns one next unsigned setup transaction, `wait` while delegation propagates, or `ready` when the policy and snapshot are private. The client signs/submits, waits for confirmation, and calls again. It verifies the existing Founder/Finance/mint before continuing and never sets confidential limits before PER privacy. This endpoint does not onboard a recipient, fund USDC, or persist transaction receipts. The server remains configured for one company at a time.
- `POST /v1/onboarding/finance-grant/next`: with a Founder TEE bearer token and `{ "actor": "<Founder wallet>", "finance": "<Finance wallet>", "grantId": "1", "perPaymentCapMicro": 1000000, "periodCapMicro": 10000000, "recipients": ["<approved wallet>"], "mayDelegate": false }`, returns one next unsigned root Finance grant transaction, `wait`, or `ready`. The client keeps the same `grantId` while calling again after each confirmed step. The backend checks the private company policy, matching grant PDA/identity, selected PER, recipient list, and caps; it rejects changed terms on an already active grant. A revoked grant requires a new ID. The existing Circle devnet grant was read-only verified as `ready`; a fresh grant was dry-run through its first unsigned builder step.
- `POST /v1/private-receive/build`: asks MagicBlock's Private Payments API for a **payer-signed, unsigned** `base → ephemeral` USDC transaction to the configured company address. It fixes visibility to `private` and rejects a builder response that omits the payer from required signers.
- `POST /v1/recipient-onboard/build`: builds the same kind of private USDC deposit to an on-curve employee, contractor, or vendor wallet on Mercury's selected PER. The caller supplies `payer`, `recipient`, and a positive `amountMicro`; the payer signs and funds the initial deposit. A submitted base transaction is not proof that the recipient's private balance is ready: read `GET /v1/recipient-balance/:wallet` with the recipient's TEE login token before paying them.
- `POST /v1/recipient-withdraw/build`: builds an **unsigned**, recipient wallet-signed withdrawal from the configured PER validator to that wallet's base token account. It rejects PDA owners, signer mismatches, and wrong-validator responses. It does not withdraw company PDA funds.
- `GET /v1/recipient-balance/:wallet`: reads that wallet's canonical token account on the TEE with the caller's TEE bearer token; the PER denies outsiders. It does not accept a company PDA as recipient.
- The receive builder also rejects a response routed to a PER validator other than the configured company validator.
- `POST /v1/operations/build`: builds unsigned Mercury company initialization, privacy setup, TeamGrant lifecycle, request, approval, budget, and agent transactions for the configured company. The caller signs and submits to the returned base or TEE endpoint. Private operations require a TEE bearer token. The backend holds no Founder, Finance, Manager, or Agent key. `initializeCompany` requires the configured Founder, Finance wallet, mint, and correctly derived company PDA. `setRequestReaders` and `setSnapshotReaders` let Founder clean up individual private account ACLs after revocation; automatic fan-out is not yet implemented.
- `GET /v1/transactions/:signature?chain=base|ephemeral`: reports chain confirmation or failure. `paymentSettled: null` means chain confirmation alone does not prove the full private transfer settled.
- `GET /v1/payments/:requestAddress/status`: reads the ACL-protected Mercury request with the caller's TEE token. `paymentSettled: true` only when the request is `executed`: the program marks it executed in the same PER transaction as its SPL token transfer. This reports the request state, not an independently matched transaction signature or a fresh recipient balance.
- `POST /v1/payments/:requestAddress/build-execution`: with a Founder or Finance TEE bearer token and `{ "actor": "<wallet>", "grant": "<Finance TeamGrant address when Finance acts>" }`, reads the approved request and company policy, derives the canonical company and recipient USDC token accounts, and builds the unsigned `executePayment` PER transaction. The actor signs; the contract rechecks approval, grant, budget, mint, recipient ownership, and token transfer. The last synchronized treasury snapshot is advisory because it can be stale.
- `GET /v1/delegation/:address`: asks the MagicBlock router for delegation status and ER routing information.
- `GET /v1/treasury-snapshot`: reads the PER-private balance snapshot with a Founder/Finance TEE bearer token. Its `updatedSlot` is the last manual sync slot; the value can be stale after a transfer.
- `GET /v1/company-policy`, `GET /v1/team-grants/:address`, `GET /v1/payment-requests/:address`, `GET /v1/agent-policies/:address`: decode private PER accounts using the caller's TEE bearer token. MagicBlock ACL controls access; the backend checks that each account belongs to the configured company.
- `POST /v1/agent/invoice-suggestions`: with a separate Agent API key, accepts `{ "invoiceText": "...", "vendorId": "..." }` and calls a configured OpenAI-compatible model to extract invoice fields. It checks the model's vendor and amount against a server-side vendor registry, selects the registered recipient itself, and returns a five-step private request plan. This is **Suggest only**: the endpoint does not sign, submit, approve, or pay. A Founder currently has to activate each new request's privacy before the agent can submit it.
- `POST /v1/agents/:agentPolicyAddress/build-payment`: with the Agent's TEE token and `{ "actor": "<Agent wallet>", "amountMicro": 1000 }`, checks the private AgentPolicy's signer, revocation state, USDC mint, recipient, and cap, then derives the float/recipient token accounts and builds an unsigned `agentPay` transaction. The Agent signs it; the contract checks the policy again. The Circle USDC Agent funding and spend path has been exercised on devnet.
- `GET /health`.

The backend never holds a company or agent spending key. It does not approve payments or report an unsigned/queued transfer as settled. The hosted builder response must be inspected by the payer wallet before signing. The backend binds to `127.0.0.1` by default and is not a public production API. Private operation arguments pass through this local backend in plaintext; a production client should construct those transactions locally and send them directly to the TEE.

```sh
cd backend
npm ci
MERCURY_COMPANY_ADDRESS=<company-policy-PDA> \
MERCURY_FOUNDER_ADDRESS=<founder-wallet> npm start
npm run typecheck
npm test
```

`MAGICBLOCK_CLUSTER` defaults to `devnet-private`, which the live hosted builder accepted. `MERCURY_COMPANY_ADDRESS` must be the actual Mercury policy PDA. Private receive and recipient onboarding require `MERCURY_ENABLE_EXPERIMENTAL_RECEIVE=1`; recipient withdrawal requires `MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW=1`; token-moving Mercury builders require `MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS=1`. They remain off by default until the exact deployment mint and custody accounts are checked. Withdrawal uses `MERCURY_COMPANY_MINT` and pins the company TEE validator; verify this mint against the deployed policy before enabling. Both deposit routes additionally require that mint to equal Circle's devnet USDC mint. The current custom-mint proof company must not be used with the USDC deposit routes. These switches are for local devnet use.

The invoice Suggest route additionally needs `MERCURY_ENABLE_INVOICE_AGENT=1`, `MERCURY_AGENT_API_KEY`, `MERCURY_SUGGEST_AGENT_ADDRESS`, `MERCURY_LLM_URL`, `MERCURY_LLM_MODEL`, and `MERCURY_VENDOR_REGISTRY_JSON`. The registry maps a vendor ID to `{ "name": "Acme Cloud LLC", "recipient": "<wallet>", "maxInvoiceMicro": "50000000" }`. By default, the model URL must be loopback (`localhost`, `127.0.0.1`, or `::1`); setting `MERCURY_ALLOW_REMOTE_LLM=1` explicitly permits sending invoice text to another host, with optional `MERCURY_LLM_API_KEY`. The backend neither persists invoice text nor stores an Agent signing key. It does not yet detect duplicate invoices or schedule autonomous work. A model can misread an invoice, so Finance must review the draft; the onchain approval and payment checks remain authoritative.

## Build and devnet status

```sh
cargo check -p mercury
cargo fmt --all -- --check
cargo-build-sbf --skip-tools-install --tools-version v1.52
```

Host compilation and deployable SBF compilation pass. The devnet program is at `34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L` ([Solana Explorer](https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet)). The latest upgrade added the private treasury snapshot; the prior upgrade tightened the policy limit invariant. Both were verified after deployment. The deployable binary is `deploy/mercury.so`; the generated IDL is `backend/idl/mercury.json`. Devnet keypairs are kept outside this directory. Build caches and `node_modules` are omitted; `npm ci` and `cargo-build-sbf` recreate them.

### Live private devnet proof

The test mint is `BHTANWG8igML3nxnHLcokhhzYt999W5LWjrtECFpNiv` and has no real value. The company policy is `EpyTeGaoxTJ6Anm1SxHFfyTkYaPdNDPHdgUvvGYXJzDB` on MagicBlock's TEE validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.

| Action | Live result |
| --- | --- |
| PER policy/request/agent permissions | Founder, Finance, requester, or Agent read as allowed; outsider denied |
| Private receive to off-curve company PDA | [Base transaction](https://explorer.solana.com/tx/4zDEGkcRmPDqWiW6xeaxHtCfh9GhbGNhgCkgzvgVmE7aCPVn678mv3V8UeYVvVB3X8Lrc15PvWzcbZEaLaZb84xq?cluster=devnet) confirmed; company credit proved by the following successful payout |
| Approved company payout | PER transaction `4VALGMLrgaALCVx58n4ApqkEEZEDQMRyFEWpUkeZaWVPp3VreLdagG3VpF2dnQJYy5zydi8uGYpD3WvFNAnuQqj9`; request became executed, reserved fell to 0, recipient grew from 1,000,000 to 2,000,000 microtokens |
| Agent float funding and bounded spend | PER transactions `5WQkkPopJ1g9MvTFmEKCtwWa9eXkziSpVi5XJtdNEYJjieiaaCr8UYHHcz9bhi1AWb9RqUkAQux5DCyidHF64V3X` and `revdrsojvMXVmEb51H5wLpjzBw99yZcEw6spXuwxvbbttRuedEQsCbkoCyiCcVwXbMVSr4U7wJ8dGSBf5XfUVpZ`; 0.25 token credited to allowed recipient |
| Limits and revocation | 0.500001 token agent attempt rejected; Founder revoked Agent and removed PER read access; Finance reclaimed remaining float |
| Treasury balance view | Finance synchronized private snapshot `8rwNrTaQqDt3aKdv2tEMornjXin4tjoDz9W5uFKF76xh`: 750001 microtokens at PER slot 463732812. Founder/Finance read it; outsider read was denied |
| Replay protection | Simulating `execute_payment` again for the executed request returned `WrongStatus`; recipient balance stayed unchanged |
| Recipient withdrawal | Finance test recipient withdrew 1 custom-mint microtoken through the wallet-signed MagicBlock `/withdraw` builder. [Base transaction](https://explorer.solana.com/tx/2DGBsPvm6Q7pbWFqsdKxiWfNvNsiqYVhWKMB9Snf8VRFoiwQ2mffVvwQLqZ1ns1XWmF4Pyy85zG4zD5qLa6MXQzM?cluster=devnet); private balance 2250000 → 2249999 and base balance 0 → 1 |
| Recipient balance access | Finance test recipient read 2249999 microtokens using its TEE token; outsider token was denied |

### Live Circle devnet USDC proof

The existing USDC policy is `362A56CsCtCWC3zRLS6ho5MYgp53q2REe6zG9fg8QAKW`; the mint is Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. This is a separate company policy from the custom-mint proof. The USDC policy already existed before this run; a new 0.01 USDC request was created under ID 2.

| Action | Live result |
| --- | --- |
| Private receive | A devnet wallet sent 0.05 USDC to the Mercury PDA through the hosted private transfer builder. [Base funding transaction](https://explorer.solana.com/tx/54yTJd6JAwRcEfBnMiWNqhbAyL3eaVUje52f2v95V3iLi7UKkjtKy63TkaCB7NRCKDYRCQNUARUM5tx8EPDqX5b?cluster=devnet); the program-synchronized private treasury snapshot read 50,000 micro USDC |
| Recipient onboarding | A separate 0.001 USDC private receive created the recipient's PER token balance. [Base funding transaction](https://explorer.solana.com/tx/2XY9jm3KqJh5pgAL9312b1A13D2QLTc8WHuejHBitmW7TJbg9cHskzLJQWT9QyuYxgpRivd9MvNnSXnka5QSZXdz?cluster=devnet) |
| Approved company payout | Mercury PER transaction `2HvfU1SMDJt1XPQipFe6crrGcdT3yrfz8PX1oWc43bHBvYLFbWzCxwtAMrsY4YUwc24FZCyCSwFuN3KdZU1NEV9t` executed the 0.01 USDC request. Recipient private balance rose from 1,000 to 11,000 micro USDC; treasury snapshot after sync was 40,000 micro USDC |
| Recipient self-withdraw | The recipient signed a 0.001 USDC withdrawal to their own base wallet. [Base withdrawal transaction](https://explorer.solana.com/tx/2r8fGya6fpM3xkRHkE9dXWk843BUur9vM5CLZQk6ebKUg7q6hufinfb7hJhqBoR9NKHSrHDeZvi4PdVDmZFmLMWo?cluster=devnet); private balance fell from 11,000 to 10,000 and base balance rose from 0 to 1,000 micro USDC |
| Private Agent float | A 1-micro-USDC [base seed deposit](https://explorer.solana.com/tx/4KWt6HQ2rKSz2VCwuh83C9tCfHZbT1MSkqG27UZCmXysFUZ4gvMGPqnid95nZEta5sJriM3LcKyMdyqQAT9omPYi?cluster=devnet) initialized the AgentPolicy-owned token account. Finance then moved 5,000 micro USDC from the company treasury to that float in PER transaction `3kgBrmfWMAFfNChNsgnU31ar3SnQWao5sAXSi5mqJuyCyFqgBSkWAMsmRFg6dS6tQUSodpFvMN2P7eyTQrBfAwjZ` |
| Bounded Agent payout | The Agent signed PER transaction `36iv6JU7B2a2YSxVKpn9Z6bh4B7N7nHWmw7fPV1dBikTcc6MYTgYV21mn71C16bZD3Ebfq9UPhQqW7QjbLdXJvWz` for 1,000 micro USDC to its allowed recipient. The recipient's private balance rose from 10,000 to 11,000; AgentPolicy `spentMicro` rose to 1,000. After Finance resynchronized, the company treasury snapshot was 35,000 micro USDC; outsider read access to AgentPolicy remained denied |

`MERCURY_FINANCE_KEYPAIR=<local-test-keypair> MERCURY_OUTSIDER_KEYPAIR=<local-test-keypair> npm run devnet:usdc-verify` checks the executed request, current private treasury snapshot, recipient private/base balances, and outsider denial without moving funds. The write scripts are `devnet:usdc-receive`, `devnet:usdc-payout`, and `devnet:usdc-withdraw`; the withdrawal proof is one-shot. Finance payout now requires `MERCURY_FINANCE_GRANT_ADDRESS`. `devnet:usdc-agent` supports `MERCURY_AGENT_PROOF_STEP=bootstrap|fund|pay|verify`; the current `fund` step requires `MERCURY_FOUNDER_KEYPAIR`. Write steps require a confirmation flag and an exact expected pre-transaction balance to prevent accidental repeats. The read-only verify step checks company/AgentPolicy spending state, recipient balances, treasury snapshot, and outsider denial. The company and AgentPolicy PDA token accounts are not directly readable through these TEE auth tokens, so the program-mediated treasury snapshot, policy state, successful token CPI, and recipient balance are the proof points. The snapshot is manual and can become stale.

### Devnet team permission proof

The current program upgrade is deployed at slot `508798054`. The proof scripts in `backend/scripts/devnet-team-permissions.ts`, `devnet-manager-grant.ts`, `devnet-manager-revoke.ts`, `devnet-request-reader-cleanup.ts`, `devnet-finance-grant-check.ts`, and `devnet-finance-boundaries.ts` used tiny Circle devnet USDC amounts. They require local test keypair paths in environment variables and must not be rerun blindly because they create new requests/grants.

| Action | Live result |
| --- | --- |
| Founder direct payment | Founder signed approval and [execution](https://explorer.solana.com/tx/rx92k52ryBB5VUhY94u9BptnUWjYrB6Y6viBPNQch7WrStP8re19wP2VuMV9t3Uzt5cXSHqDtVSL1FAt9ioaWbN?cluster=devnet) for a 1-micro-USDC request; request became `executed` |
| Finance scoped payment | Founder configured private TeamGrant `FyyCtcBeexpHvGvyyGMiLUZU8n9335xconQoJ4G1h4PP` for one recipient, 10-micro per payment, and 100-micro per period; Finance approved and executed a 1-micro-USDC request; grant `spentMicro` became 1 |
| Finance limits | An off-list recipient approval failed and left its request submitted; an 11-micro-USDC execution against the 10-micro cap failed, left its request approved, and did not change the recipient balance. Founder rejected both test requests afterward |
| Manager delegation | Finance issued narrower TeamGrant `BTNm45qUUPb83MxXa376wDQkgEro2AZ4W659Scf8CQaD`; Manager approved a shared 1-micro-USDC request. Manager's execution failed, then Finance executed it |
| Revocation and privacy cleanup | Finance revoked that Manager grant. Manager lost access to its grant and the parent reader list. A previously shared request remained readable until Founder called `setRequestReaders`; after the [ACL update](https://explorer.solana.com/tx/59YuHEDahzaCRReE2BjnLCvzXQffUVUUzNCNZAZ9BZy9ehvtCkpWGN5fzcspq8fk3i7e7NzydkZTXCLsNx98PhdX?cluster=devnet), Manager's TEE read was denied |
| Finance grant required for snapshot sync | Finance sync without a grant failed; sync with the active grant succeeded at PER slot `470423563` |

Revoking a grant stops future authority immediately, but removal from **every previously shared private account** still needs an app-level index and an automatic ACL update job. `setRequestReaders` and `setSnapshotReaders` provide the account-level operations. Manager's branch label is not a general onchain request-scope check; the current boundary is explicit request read membership plus grant recipient and amount limits.

`backend/scripts/verify-devnet-proof.ts` independently reads the private TEE state with the Finance test key and checks executed request, budget, revoked Agent, recipient private/base balances, treasury snapshot, and the backend's private account decoders. Run `MERCURY_FINANCE_KEYPAIR=<local-test-keypair> npm run devnet:verify` from `backend/`; `npm run devnet:replay` now uses the custom-mint company's Founder key to simulate a duplicate payout and check the balance. `npm run devnet:recipient-balance` also needs an outsider test keypair. `npm run devnet:recipient-withdraw` is a **one-shot proof** that moves exactly one test microtoken; it refuses to run after the recorded balance change. The policy lifecycle script is `npm run devnet:policy` with test keypair environment variables; see the script for required names. Do not commit those keypairs.

The hosted Private Payments API's private-balance endpoint authenticates the destination wallet itself. A PDA cannot produce that wallet login signature. Mercury uses its own PER-private `TreasurySnapshot`: Founder or actively granted Finance reads the canonical company token account and writes its balance/slot to an ACL-protected account. This is a manual observation, not automatic settlement reconciliation; transfers after its `updatedSlot` are absent until another sync. Base-side funding transactions still reveal their payer and may reveal amount/timing. This prototype does not promise full anonymity.

## Remaining gates before calling this a working app

1. Complete the new stepwise Circle devnet USDC onboarding flow with recipient readiness, treasury funding, a durable transaction journal, and a fresh-company end-to-end run. Policy/snapshot and root Finance grant step planners are implemented and read-only verified against the existing devnet company; frontend wallet login/signing remain. The official [Circle faucet](https://faucet.circle.com/) supplies test funds.
2. Complete team onboarding and access management around the proven Founder → Finance → Manager contract path. Add persistent requester/viewer grants, member discovery and role rotation, general branch-scoped request records, and automatic permission cleanup across every affected request, snapshot, and agent policy after revocation. Then automate company setup and recipient readiness checks; callers currently still sign, submit, and verify the unsigned setup/deposit transactions.
3. Add an app-level payment record and automatic reconciliation for PDA custody. The backend can now derive a payout from an approved request and distinguish an atomic Mercury `executed` payout from mere transaction confirmation, but it does not match transaction signatures to requests or automatically refresh the treasury snapshot after deposits and payouts. In the current TEE RPC, `getTransaction` for the proven payout returned success metadata with empty account keys and instructions, so that response cannot independently bind its signature to the private request.
4. Expand the current Finance/Manager recipient lists beyond sixteen payees per grant, test period rollover and every payout/revocation failure path, and define optional multi-person approval if teams request it. Founder-set recipients and Finance per-payment/period caps are already enforced in the devnet program.
5. Build a human-approved private payroll run: private employee items, one run-level budget reservation and approval, individual one-time payouts, and reliable retry/status. The existing contract only proves individual payments.
6. Complete the Agent product flow. The invoice Suggest worker now extracts and validates a draft through a configured model, but needs a real invoice ingestion/evaluation pipeline, duplicate detection, wallet-signed request orchestration, and Finance review UI. Bounded Execute funding and payment have now been proven with Circle devnet USDC; the backend still needs repeatable Agent setup, revocation/reclaim proof on USDC, and Co-sign mode.
7. Finish role rotation, request/agent account close and rent recovery, durable recovery, Co-sign mode, and external security review before production use. Resolve dependency advisories before public deployment; the current Anchor JavaScript dependency pulls a vulnerable `toml` package without an available upstream fix.

Product scope and the provisional payment design are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
The backend/program work order and acceptance criteria are in [docs/MVP_BACKEND_PLAN.md](docs/MVP_BACKEND_PLAN.md).
