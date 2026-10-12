# Mercurii app frontend

## Source of truth

The app reads the existing Mercury HTTP service and private Solana accounts. It does not invent balances, approvals, or settlement states. MagicBlock Private Ephemeral Rollups gate private company, grant, request, agent, and snapshot reads; the Mercury program separately enforces who may submit, approve, execute, or spend. MagicBlock Private Payments handles deposits and recipient withdrawals. A confirmed base deposit is not a ready private balance, and a submitted payment is not a settled payment.

## Role and screen map

| Role | Home | Permitted work | Data boundary |
| --- | --- | --- | --- |
| Founder | Treasury, budget, pending work | Company onboarding, grants, payees, payroll runs, approvals, execution, agents, audits | Full private company policy and explicitly shared records |
| Finance | Treasury, assigned payment work | Approve and execute within active root grant, prepare payment work, payroll approval | Active grant caps and recipient allowlist apply |
| Manager | Branch requests | Approve requests in the matching branch when a parent Finance grant permits it | Branch scope only; no treasury execution |
| Requester | Own requests | Create and submit a private payment request with an active grant | No general treasury or payroll view |
| Viewer | Shared records | Read only records explicitly shared by Founder | No approval or spending |
| Agent | Authorized records and isolated float | Prepare requests; separately bounded x402 payments | No company treasury key or unrestricted balance |

The UI is a guide and must never be treated as the authorization layer. The PER and Mercury program remain authoritative. Hide private values until a wallet-signed TEE session succeeds; do not persist bearer tokens, salary rows, payment terms, or signed transactions in browser storage or URLs.

## Workflow boundaries

1. Select the company PDA, connect a compatible Solana wallet, sign the MagicBlock TEE challenge, and use the returned token only in memory.
2. Load only endpoints the wallet can read. A denied private read is an access state, not a blank value or zero balance.
3. Keep a payment's UUID and exact recipient, amount, requester, branch, and reader terms in memory throughout its guided flow. Reuse the same terms on each `/next` call. For a private request already initialized, an authorized reader can reload these terms through the private request endpoint; the journal itself retains only a hash.
4. Show the proposed operation, required signer, chain, and terms before wallet signing. Submit the exact signed bytes to the receipt-bound backend route, then reconcile that signature on uncertain status. Never build a second transfer just because a lookup timed out.
5. Execution uses the payment job's separate prepare/submit/reconcile path. Call it only after the private request is approved. "Executed" and linked signature are distinct evidence from a stale treasury snapshot.
6. Payroll preview and readiness are transient. Manual runs send roster rows only when launched. Recurring schedules encrypt the roster in the browser with a user-held passphrase and bind create, pause, resume, and launch actions to a Founder wallet signature. The passphrase is never persisted or sent to the backend. Every payout still needs its own authorized signature.
7. Agent chat uses a fresh signed challenge per request. An x402 purchase requires the backend allowlist and a challenge binding the selected service/task/price; the agent uses a separate float.

## Implemented app surface

The `/app` workspace now has a same-origin backend gateway, wallet-signed TEE login, role-aware navigation, registered-Founder company setup, real treasury and budget data, personal recipient balance and gated withdrawal, guided company funding, payment request/approval/execution/settlement, payee registry, payroll preview/readiness/manual run and encrypted recurring schedules, Founder/Finance/Manager grant issuance, grant revocation with reader cleanup, agent chat/payment drafts/invoice review/x402 selection, scoped Viewer record lookup, and Founder payroll audit shares. Signed onboarding and funding steps use receipt-bound submission and reconciliation. Founder payroll run detail lists each payout and prepares signed approval chunks. Records includes a Founder settlement check and signed snapshot sync when the payment and treasury snapshot diverge.

The codebase cross-check also added flows the initial screen map missed: Founder-signed recipient onboarding deposits from Payees, failed payroll payout recovery with a separate replacement signature, approver-signed payment rejection, Founder agent policy setup/revocation, permissioned agent policy discovery, agent float funding/reclaim and capped agent payments, signed agent activity lookup, Viewer sharing that checks the grant and preserves active request readers, and Finance reader restoration after a replacement grant. Each new onchain action uses the exact signed receipt for retry/reconciliation. Agent token transfers and recipient deposits stay behind the backend's verified feature gates. Payroll readiness now shows the backend's actual per-recipient `ready` / `needs_onboarding` / `unavailable` statuses.

Wallet disconnects, account changes, and TEE token expiry clear private resources and payment drafts from memory. In-flight refresh results are discarded after the session changes. Visited workspace sections remain mounted for the current wallet session so switching sections preserves a signed receipt and its retry bytes. A full page reload still clears those bytes. An uncertain broadcast can be retried with the original signature or reconciled before a rebuild. A signed step is not offered for a second signature while its receipt is unresolved. Funding, withdrawal, setup, payment, payroll approval, and snapshot sync screens block a new preparation while the original signature still needs reconciliation.

The local backend exposes feature gates in `/health`. Private receive, payment token CPI execution, recipient withdrawal, finance agent, and x402 are disabled in the current `.env.local`; the app shows their unavailable state rather than a fake success. Recurring schedules support company-wide weekly, biweekly, monthly, and individual employee cycles. The individual roster requires cadence and first-pay-date columns, and the selected cycle is checked before launch. The backend does not yet expose an employee-scoped payment history index, so a recipient sees their private balance rather than a salary ledger. These are backend/product gates, not empty frontend mock data.

Code-level compilation and lint are useful while wiring the screens, but wallet signing, PER visibility, USDC account creation, role transitions, payment settlement, and Browser UI flows still require end-to-end testing. That testing was deferred at the user's request while completing the codebase feature pass. The app should not be presented as production ready or as having live payments until the backend gates are verified and enabled.

Company setup starts from a public on-chain shell or an operator-configured default company. A new Founder can enter the Finance wallet, prepare a public `initializeCompany` transaction, sign it, submit the exact signed bytes, and check whether the shell appeared on Solana devnet. The submit route rebuilds the expected public instruction and verifies its accounts, data, fee payer, and Founder signature before broadcast. An uncertain send retries only the original signed transaction. Once the shell is visible, the Founder registers it from the sign-in screen; the backend verifies its founder, mint, and owner on chain before private login. Private limits and treasury data are written only in the subsequent MagicBlock onboarding steps. Registration requires the configured Supabase private store.

The design references inspected locally were `~/Desktop/nori` (focused task navigation and payment phase states) and `~/Desktop/expensee-magicblock` (role-scoped employer navigation and payout statuses). The implementation keeps Mercurii's existing light visual language and uses these as UX references; it does not copy their code or imply the same backend capabilities.

Current development network is Solana devnet. The public Vercel frontend requires an independently reachable Mercury backend URL before the authenticated app can work there.
