# Mercury devnet MVP checklist

This is the implementation checklist for the current backend and contract. A green item has passing backend coverage and a recorded live Circle devnet proof unless stated otherwise. It does not claim mainnet readiness.

## Private company money

- [x] **Receive:** build a wallet-signed MagicBlock Private Payments `base -> ephemeral` deposit to the company PDA; reject a wrong validator or missing payer signature.
- [x] **Hold:** maintain a Founder/Finance-readable private treasury snapshot on PER. Snapshot refresh deliberately requires an authorized wallet signature and can be stale until refreshed.
- [x] **Private payout:** execute a policy-checked PDA-signed eSPL transfer from company PER treasury to an already-onboarded employee, contractor, or vendor PER account. Circle devnet USDC proof exists.
- [x] **Recipient control:** recipient reads their own private balance through TEE authentication and signs their own withdrawal builder. Outsider reads are denied.
- [ ] **Direct company-to-base payout:** not part of this MVP. The current safe route pays a recipient's private PER balance; their own wallet signs a public base-layer withdrawal if desired.

## Financial operations

- [x] **Payees:** register employee, contractor, and vendor metadata without making them treasury members or storing their raw wallet in the local registry.
- [x] **Guided payment:** one opaque payment ID drives shell, delegation, privacy activation, private request, approval, payout, and receipt tracking.
- [x] **Approval and controls:** Founder can complete any payment; Finance has recipient allowlists plus per-payment and period caps; Manager has bounded branch approval and cannot execute.
- [x] **Settlement tracking:** private request status becomes `executed` atomically with its token transfer; duplicate execution is blocked.
- [x] **Recovery:** signed receipts stay bound to their exact message; unsigned builds are recreated only after a proved blockhash expiry; uncertain or missing signatures never trigger a second payment.
- [x] **Reconciliation:** HTTP sweep and local watcher report safe human actions only. They never hold a Founder key to sign, retry, or sync a transfer automatically.
- [ ] **Automatic snapshot refresh:** intentionally not automatic in a noncustodial MVP, because it needs an authorized Founder/Finance wallet signature.

## Team access

- [x] **Founder:** full administration, payment, policy, and role authority.
- [x] **Finance:** private capped/allowlisted approval and execution grant.
- [x] **Manager:** delegated branch-scoped approval grant only.
- [x] **Requester and Viewer:** nonspending private grants with request-level data scope.
- [x] **Revocation:** revoke the grant and guide Founder-signed historical reader cleanup; live denied-read proof is recorded for all current roles.
- [ ] **Self-service member UI / role rotation:** frontend work, deferred.

## Payroll

- [x] **Private payroll run:** private employee payment requests, approval chunks of up to eight items, item-level payout status and safe failed-item recovery.
- [x] **Payroll readiness:** validate recipient private-payment onboarding, policy headroom, and advisory treasury snapshot before a run.
- [x] **Schedules:** weekly, biweekly, monthly, and per-employee cadence with a caller-encrypted roster and revision-bound launch.
- [x] **Live proof:** two-item scheduled payroll and a nine-recipient Circle devnet run were settled; failed-item recovery was also proven.
- [ ] **Automatic release on pay date:** excluded deliberately. A calendar never releases company money without a human wallet signature.
- [ ] **Tax withholding, fiat, payslips, and employment compliance:** outside the stablecoin operations MVP.

## AI agents

- [x] **Finance Agent:** a wallet-authenticated, grant-scoped Kimi thinking agent can inspect verified private company data, payment state, payroll readiness, and a selected invoice.
- [x] **Safe payment drafting:** deterministic backend code verifies the selected payee, exact amount, active role, caps, and budget before returning an unsigned draft.
- [x] **Invoice agent:** registered vendor/cap validation binds an invoice number to one guided payment ID; duplicate invoice reuse and changed terms are blocked.
- [x] **Agent requester proof:** a delegated Agent created/submitted a private request; Founder activated privacy, approved, paid, synced, and reconciled it on Circle devnet USDC using real Kimi extraction.
- [x] **Bounded Execute primitive:** the contract has a separate Agent float, allowed recipient, mint, per-payment cap, and period cap. It is never the company treasury authority.
- [x] **Optional x402:** a separate small wallet is capped and cryptographically bound to one approved service/task. It does not use the company treasury or Agent float.
- [ ] **Encrypted invoice file intake:** current agent receives invoice text for review; encrypted PDF/document storage and vendor upload are not built.
- [ ] **Autonomous company payment agent:** intentionally excluded. The MVP requires human approval for company treasury payments.

## Selective audit disclosure

- [x] **Encrypted, expiring, revocable bundle:** Founder can create a frozen disclosure for selected payroll runs; the durable journal holds token hash and ciphertext, not salary or recipient plaintext.
- [x] **Access boundaries:** auditor capability cannot read live treasury/team/PER accounts or execute a payment; unit coverage verifies invalid and revoked tokens are rejected.
- [x] **Live proof:** a settled Circle devnet payroll run completed create -> open -> revoke -> denied access. The harness also verified the durable metadata contains no plaintext recipient, salary amount, or auditor bearer token.
- [ ] **Auditor portal / legal compliance workflow:** frontend and product work, deferred.

## Required for a usable product, but deliberately outside the backend-only pass

- [ ] Wallet connect, TEE login, signing, and Founder/Finance/employee screens.
- [ ] Durable Supabase/Postgres storage with company ownership, foreign keys, row-level policy, encrypted secrets, and migrations.
- [ ] Multi-company hosted server. Current backend process is intentionally configured for one company.
- [ ] Mainnet custody/recovery/security review.

## Current next action

The backend/contract devnet MVP is complete for the locked scope. The next engineering phase is frontend plus durable multi-company storage, not another payment-policy feature.
