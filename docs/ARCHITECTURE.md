# Mercury architecture decision — v1

**Date:** 7 October 2026  
**Target:** Solana Blitz v9 devnet MVP  
**Status:** Core PER custody, private balance snapshot, payment, and recipient withdrawal proven on devnet with a custom six-decimal test mint and Circle devnet USDC. Founder direct payment, scoped Finance payment, Manager approval, and grant revocation were also proven with Circle devnet USDC. Branch-bound Manager approvals and Requester/Viewer grants are implemented in the current devnet program; live member lifecycle proof is recorded separately in the README. Reconciliation and production controls remain open.

**Product:** A private company USDC treasury for small onchain teams. Teams receive, hold, and pay USDC through private routes; people and AI agents act under narrow rules without sharing private keys.

**MVP permission decision (8 October 2026):** A company starts with one Founder/Owner who has full company administration and payment authority. The Founder grants Finance a recipient list and spending caps. Finance may grant a narrower Manager approval scope only when its grant permits delegation. The Founder directly issues nonspending Requester and Viewer grants, optionally limited to one branch. A grant cannot exceed its grantor's authority or create another Owner. Employee, contractor, and vendor describe payment relationships, not automatic treasury authority. This is the MVP default for founder-led teams, not a universal rule for every company; configurable multi-owner or multi-person approval can follow later.

## Decision

Use a **Mercury Solana program** as the company's smart-account policy and token authority. Delegate its sensitive state to a **MagicBlock Private Ephemeral Rollup (PER)**. Hold operating USDC in a **program-controlled Ephemeral SPL Token (eSPL) account** on the same PER. Receive from a normal wallet through MagicBlock's encrypted-destination `base → ephemeral` private transfer route, and receive from another PER balance by private internal transfer. Execute approved outgoing payments from the company eSPL account to a recipient eSPL account inside the PER. The **Private Payments API** can construct a sender-signed incoming transaction; it is not the authorization layer for company spending.

This is the selected architecture for the devnet MVP. The combined Mercury path was exercised with a custom test mint on the TEE validator: private receive to the off-curve company PDA, a Finance-approved payout, separate Agent float funding and payment, revocation, float reclaim, and an ACL-protected treasury balance snapshot. A duplicate payout simulation returned `WrongStatus`. Private receive, Finance-approved payout, recipient withdrawal, and bounded Agent funding/payment were also exercised with Circle devnet USDC. Agent revocation and reclaim remain custom-mint proofs. The implementation evidence and remaining gates are in [README.md](../README.md).

## What each layer does

| Layer | Responsibility | Cannot be relied on for |
| --- | --- | --- |
| Mercury program | Founder/Finance signer checks, per-request approval, budgets, one-time payment execution, agent allowlist and caps | Privacy by itself; human payment thresholds and allowlists are still planned |
| MagicBlock PER | Private execution and authorized access to delegated company/payment state | Mercury's business approval rules |
| MagicBlock eSPL | USDC balance backed by the global vault; token movement on the PER | Team roles or invoice decisions |
| Private Payments API | Builds unsigned wallet transactions for inbound `base → ephemeral` receipts and recipient-signed withdrawals; a queued company-to-base payout needs separate program integration | Signing for the company PDA or enforcing Mercury policy |
| Web app/backend | Wallet login, private UI, request orchestration, encrypted document storage, indexing, payment status | Custody of treasury keys or authoritative spend decisions |
| AI worker | Extracts an invoice into a reviewed draft; a separate Agent signer may later spend only from a small isolated float | Changing policies or moving unrestricted treasury funds |

The hosted API uses private eSPL/PER infrastructure for payments. Mercury uses a *direct PER application account* because company budgets, approval state, and authorized views must also be confidential. Inbound API use is a required devnet proof because the company destination owner is an off-curve Mercury PDA.

## Actors and rights

| Actor | Can see | Can do |
| --- | --- | --- |
| Founder / Owner | Company balance, policy, payment records, team access, and agent policies | Assign/revoke roles; set limits and approved recipients; create, approve, and execute any company payment; configure/revoke Agents |
| Finance / Operator | Company balance, budgets, and payment records needed for assigned work | Prepare payments and batches; approve/execute within Founder-set amount, period, and recipient rules; reconcile; grant a narrower Manager approval scope only when Founder explicitly permits it |
| Manager / Branch manager | Requests explicitly shared with them and their delegated grant | Prepare or approve shared requests within a delegated approval budget and recipient list; cannot execute treasury payments or change company-wide policy |
| Employee / Requester | Their own requests and received payments | Create requests; receive private payments; sign their own withdrawal; cannot release treasury funds |
| Viewer / Accountant | Only the company records explicitly shared with them | Read/export assigned records; no payment, approval, or policy changes |
| Agent | Its assigned private policy and the invoice/payment data needed for its task | Suggest payment requests by default; bounded Execute uses a separate float and approved destination; cannot change policy or approve its own request |
| External payee | Their own received balance/payment | Receive private payments and sign their own withdrawal; no company membership is required |

The Founder assigns **capabilities and data scope**, not just titles: who can manage members; prepare, approve, or execute a payment; view company balance versus only assigned records; and operate an Agent. A grant specifies actions, team/branch scope, payment limits, allowed recipients, optional ability to grant narrower access, and revocation. Delegated authority is checked on every protected action, including after a parent grant is revoked. A person may be an employee and a payee, but receiving a salary grants no company treasury access. Contractors and vendors may be external payees or invited requesters. One payment rail supports employee payouts, contractor payments, vendor invoices, reimbursements, and other approved transfers; each payment carries its type and status in the app-level record. A payroll run groups employee payment items with one approval and item-level retry/status.

For the MVP default, the Founder can complete a payment without Finance. Finance can approve/execute only with an active Founder-issued private TeamGrant: up to sixteen allowed recipients, a per-payment cap, and a period spend cap. If that grant allows delegation, Finance may issue a narrower Manager grant whose recipients and caps must be subsets of Finance's; Manager may approve requests explicitly shared through PER permissions, but cannot execute. Manager approval and rejection now require the grant's branch PDA to match the upper 24 bits of the request ID. New guided Manager requests include a nonzero `branchId`; older unscoped requests cannot be approved by a Manager after this upgrade. Manager's period cap currently counts approved amounts and is not refunded when a request is later rejected. Founder-issued Requester and Viewer grants carry no spending authority. Requester activation and submission recheck its active grant; Viewers can read only explicitly shared request accounts. **Remaining gaps:** no general member registry or role rotation, no automatic background ACL cleanup, and Finance revocation still reports AgentPolicy readers for separate handling. The revocation planners scan private request accounts and reset affected ACLs to Founder only, including historical requests without journal metadata. This is deliberately conservative: other legitimate readers must be shared again. The hosted PER does not expose a reliable permission listing, so an operator should verify revoked-wallet read denial after each cleanup.

PER account membership controls reads. The Mercury program separately checks signer, active grant/parent, Finance or Manager role, payment recipient, caps, current period, available token balance through the token CPI, remaining company budget, and request status. Finance spending caps and recipient rules are implemented for its current grant; Manager approval is bounded by its own grant. A PER `AUTHORITY` flag is permission-administration authority, **not** a Finance role.

The recipient balance and withdrawal rights above describe the intended wallet flow. Mercury proves receipt into a pre-onboarded recipient account, TEE-authenticated recipient balance reads with outsider denial, and an unsigned recipient withdrawal builder with custom-mint and Circle devnet USDC proofs. The frontend wallet-login flow remains open.

## Accounts and placement

| Account | Owner / authority | Creation and execution | Privacy / lifecycle |
| --- | --- | --- | --- |
| Company configuration | Mercury program; Founder/Finance governance | Created on Solana base | Public non-sensitive setup and recovery data only |
| Treasury policy PDA | Mercury program | Created empty and prefunded on base, delegated to the TEE PER, populated there | Private to Founder/Finance; never commit plaintext confidential fields to public base state |
| TeamGrant PDA | Mercury program | Public zero-authority shell is delegated; role, caps, and recipient list are configured only after PER privacy is active | Founder/Finance/Manager reads according to the grant; revocation blocks future authority, while historical request readers require separate cleanup |
| Payment request PDA | Mercury program | Created with non-sensitive placeholder on base, delegated and filled in PER | Separate account per request so requester sees only their request |
| Company USDC eATA and ER token account | eSPL backing plus Mercury policy PDA as token owner | Funded via Solana/global vault; materialized on the same TEE PER | Private token balance; a PDA cannot use the hosted balance API's wallet login |
| Treasury snapshot PDA | Mercury program | Founder creates and delegates; Founder or an actively granted Finance signer syncs from the canonical company token account | PER-private Founder/Finance view of balance and observation slot; manual sync can be stale |
| Agent float eATA | eSPL program; separate Mercury agent PDA | Funded with a small hard limit from company account | Isolated from the main treasury; agent policy is private |
| Recipient eATA | eSPL program; employee/contractor/vendor wallet | Initialized/delegated to the same TEE PER before the current Mercury payout | Recipient's TEE token reads their balance; Mercury builds a wallet-signed withdrawal, proven with the custom test mint and Circle devnet USDC; a frontend UI remains open |
| Payroll run and item state (planned) | Mercury program | One private run approval reserves its total; each employee item executes once from the company treasury | Founder/Finance see the run; an employee sees only their own payment status and balance |
| Invoice document | Encrypted offchain storage | Uploaded after wallet authentication | Only assigned Finance/agent can decrypt; do not put invoice plaintext on Solana |

All writable accounts used in one payment transaction must be available on the same PER validator. The client discovers the endpoint from delegation status and does not assume a regional endpoint.

## Private receive, end to end

1. Mercury publishes a company payment address or payment link whose destination is its vault PDA. It does not require a company private key to receive.
2. A payer with ordinary Solana tokens requests a `visibility: private`, `fromBalance: base`, `toBalance: ephemeral` transfer to that destination and signs the returned transaction. The hosted builder accepted this with both a custom mint and Circle devnet USDC, and later company payouts proved the off-curve PDA could spend the credited funds. The base instruction still includes the sender and may expose amount/timing.
3. The payment lands in the company's private eSPL-backed token balance on PER. Both devnet mint proofs verified credit through successful PDA-signed payouts and copied the canonical token balance into a Founder/Finance-only PER snapshot. The snapshot requires a Founder signature or an actively granted Finance signature and may be stale. An app-level receipt record and automatic reconciliation remain to be built. A source transaction or queue acceptance alone is not sufficient proof of credit.

For a payer already holding a private eSPL balance on the same PER, an internal PER transfer is the simpler inbound path. The amount and sender of a **base-layer** incoming transaction may remain observable; the product promise is to reduce the public link to the company and keep its operating balance private, not hide every byte of the payer's transaction.

## Outgoing payment, end to end

1. Founder/Finance sets up the company, token account, and delegated state. They create PER permissions and make each sensitive account private **before writing confidential values**, then fund with the chosen devnet mint. The live proof used both a custom six-decimal test mint and Circle devnet USDC. A direct self-funding deposit on Solana is public.
2. A requester creates a unique request shell. Founder activates its PER privacy and selects any Manager reader, and the requester signs the private amount and recipient. Non-Founder requesters need an active Finance or Requester grant at activation and submission. A scoped Requester grant must match the request's encoded branch.
3. Founder can approve any payment. Finance can approve within its active grant; Manager can approve a privately shared request within its narrower recipient list and approval cap. Mercury reserves the approved amount against the company period budget. All three approval paths were exercised on devnet with tiny Circle USDC requests.
4. Founder, or Finance within its active grant, signs execution. Manager cannot execute. The backend derives both canonical USDC token accounts; its last treasury snapshot is advisory and may be stale. In **one PER transaction**, Mercury checks the approved request again, makes a PDA-signed eSPL transfer to the recipient's PER token account, decrements the budget, and marks the request executed. A failed token CPI must revert the state change. Founder and Finance execution, plus a rejected Manager execution, were exercised on devnet.
5. The employee, contractor, or vendor receives the payment in their own private PER token account. Their wallet authenticates to the TEE for a private balance read. If they want standard Solana USDC, the Private Payments API/SDK builds a withdrawal that **the recipient signs**; the base-layer exit can be visible. Mercury's TEE balance read, unsigned withdrawal builder, and wallet-signed transaction were verified with the custom test mint and Circle devnet USDC; the frontend wallet flow remains open.

For the Blitz demo, onboard one recipient to the same PER before the payment. The backend now builds a payer-signed, base-to-PER seed deposit for an on-curve recipient wallet; after it is submitted, the recipient must verify their private balance through TEE auth. This costs a small initial USDC transfer and the base funding leg may expose payer, amount, and timing. The backend also reports payment settlement from the Mercury request's private `executed` state, which the program writes atomically with its token transfer. A direct company-treasury-to-base payout is a separate queued path: the hosted API cannot replace Mercury's PDA signature and policy checks. It needs a Mercury program integration, settlement tracking, and privacy validation; none of those are implemented yet.

## Controlled private payroll payouts

Payroll payouts are a core **company treasury workflow**, not a separate HR or tax product. The current contract proves one approved private payment to a recipient; a payroll run with multiple employees is **not implemented yet**.

The MVP payroll flow is: Founder or Finance prepares an encrypted employee roster and amounts, Mercury creates a private run with a total and one item per employee, the Founder or an in-scope Finance operator approves and reserves the run total, then each item transfers from the company eSPL balance to that employee's private PER balance. Every item has a unique status, so a failed item can be retried without paying completed items again. The run reports paid, pending, and failed amounts; recipients can view their own payment and withdraw with their wallet. Agent automation may prepare a draft or flag errors, but cannot approve or release the payroll run on its own.

For the first functional devnet payroll demo, prove two recipients, one human-approved run, exact balances, and a safe retry of a failed item. Tax withholding, fiat rails, employment compliance, payslips, and autonomous scheduled release are separate later work.

## Agent boundary

**Locked agent model:** Every agent has a dedicated signing key under a revocable Mercury policy. Its key is never the company vault authority. The current contract implements Execute mode with one approved recipient, a fixed token mint, per-payment maximum, period cap, and separate float **onchain**. Mode selection, program allowlists, expiry, Suggest, and Co-sign remain product work. Founder configures/revokes the policy and, pending explicit Agent-funding delegation, is the only signer allowed to fund/reclaim the float. PER access to private state is granted separately and minimally.

| Mode | Agent action | Human/payment rule |
| --- | --- | --- |
| Suggest | Prepare and sign a payment request | Founder, or Finance within delegated scope, approves and releases company treasury funds |
| Co-sign | Co-sign a specified payment request | Required human approval remains mandatory; agent signature alone releases nothing |
| Execute | Sign an allowed payment from the separate agent float | No per-payment human signature within the preapproved destination and hard caps; treasury-to-float funding requires human approval |

The first MVP agent is an **invoice/request agent** in Suggest mode. A configurable model now extracts invoice fields from text. Mercury maps the named vendor to a registered wallet and checks an invoice cap in deterministic backend code; model output never selects a payment address. The result is a draft and the exact request setup operations. No transaction is signed or submitted by the AI endpoint. In the current contract, a Founder must activate the privacy permission for each new request before the Agent can sign `submitPayment`; Finance then approves and executes. The backend does not yet ingest invoice files, detect duplicate invoices, retain encrypted drafts, or run an Agent signing service. Invoice text remains in memory during a request and goes to a local model by default; remote model use requires explicit configuration.

The contract proves Execute mode with a **small isolated float**: an earlier devnet version used Finance to allocate it, then the agent paid only its preapproved destination within its per-payment and period caps. The current permission revision limits float funding/reclaim to Founder until Agent delegation is designed. The backend reads a private AgentPolicy and builds an unsigned `agentPay` transaction with derived USDC token accounts; the Agent signs. Circle devnet USDC Agent funding and payment were verified with a private AgentPolicy, 5,000 micro USDC earlier Finance-funded float, and a 1,000 micro USDC Agent payout to the allowed recipient. Revocation and float reclaim were proven with the custom test mint and remain to be repeated with Circle USDC. Co-sign mode is part of the planned permission model. Revocation blocks the next spend, and a lost agent key cannot authorize a transfer from the main treasury.

No autonomous payroll release, general invoice auto-pay, x402 production integration, yield, or fiat rails in this MVP. Human-approved private payroll payouts are in scope as a treasury workflow.

## Privacy and settlement promises

- **Private from public observers:** sensitive policy/payment state and PER-to-PER transfer details, subject to correct permissions and validator behavior.
- **Visible by design:** recipient's own payment; authorized Founder/Finance views; base-layer funding, delegation, and withdrawal events. On the encrypted-destination inbound route, source wallet and amount may still be visible even when the company destination is hidden.
- **Trust assumptions:** MagicBlock TEE hardware/operator and any service that receives invoice data. This is confidentiality with reduced linkability, not guaranteed anonymity.
- **Do not publish plaintext state:** confidential PDA bytes must not be committed back to public Solana. Production needs an explicit durable encrypted recovery/checkpoint design before real treasury funds are accepted.
- **Payment status:** a PER token transfer is executed only after its transaction succeeds and the recipient balance is verified. A queued external API transfer has `queued`, `settled`, and `failed/refunded` states; source submission is not recipient payment.

## Devnet integration proof

1. On devnet, create and delegate a Mercury policy PDA to the TEE PER. Authorized Finance can read it; an outsider cannot.
2. Fund a Mercury PDA-owned USDC eATA and delegate it to that same PER. Verify only authorized views can obtain the operating balance.
3. In one Mercury instruction path, enforce one Finance approval and one amount cap, then make a **PDA-signed eSPL transfer** to a recipient eATA on the same PER. Test rejected approval, wrong vendor, exhausted budget, and duplicate execution.
4. Verify the recipient receives the exact amount and can withdraw. Inspect Solana and PER-visible data to identify what payment metadata actually leaks.
5. Test private receive from an ordinary wallet through the API's `base → ephemeral` route **to the Mercury PDA owner**. Verify the company balance changes, the sender signs without a company key, and public observers cannot recover the company destination from the base transaction.
6. Test a stalled delegation/recipient setup and show a safe retry without paying twice.

Steps 1–5 passed across the custom test mint and Circle devnet USDC proofs: private receive, Finance-approved payout, recipient balance and wallet-signed withdrawal, and manually synchronized private treasury balance were verified with both mints. Agent cap, revocation, float reclaim, and duplicate-execution rejection were verified with the custom mint. Step 6 still needs broader failure/retry tests. Reusable backend onboarding and automatic payment reconciliation remain open before this is a functional team app.

## Production gates after the hackathon

An audit of the Mercury custody/policy program; private state durability and recovery; role revocation; token account co-location; recipient onboarding and external queued payouts; fee and outage handling; invoice processing confidentiality; monitoring/reconciliation; and a mainnet pilot with limited funds. The devnet demo is not a production custody system.

## Sources

- [MagicBlock PER access control](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control)
- [MagicBlock private payments and privacy limits](https://docs.magicblock.gg/pages/ephemeral-spl-token/private-payments)
- [MagicBlock program-controlled eSPL transfers](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration)
- [Official SDK encrypted-destination inbound builder](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/f225c058939146a75c7e952fbf2409a551da2594/ts/web3js/src/instructions/ephemeral-spl-token-program/ephemeralAta.ts)
- [Official private-counter example](https://github.com/magicblock-labs/magicblock-engine-examples/tree/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor)
- [Official program-owned eSPL custody example](https://github.com/magicblock-labs/magicblock-engine-examples/tree/e8393c60a82f73259a39abe807c6273a83659d0a/binary-prediction/anchor)
- [eSPL private payout queue behavior](https://github.com/magicblock-labs/ephemeral-spl-token/blob/1d4564a17b2eb31a1ea8384efad684f768af0468/docs/docs.MD)
- [Solana Blitz v9](https://luma.com/832wilvl)
