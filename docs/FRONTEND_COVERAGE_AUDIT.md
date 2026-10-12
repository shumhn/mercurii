# Mercurii frontend coverage (code audit, 2026-10-12)

The detailed UI → API → encrypted database → Mercury program → browser/live proof matrix is maintained in [`FULL_STACK_FUNCTIONALITY_MATRIX.md`](FULL_STACK_FUNCTIONALITY_MATRIX.md). This shorter file is retained as the original frontend-focused summary.

## Browser-visible checklist

| Step | Result |
| --- | --- |
| Landing → `/app` | ✅ Opened locally; workspace and backend health loaded. |
| Sidebar before sign-in | ✅ All workspace sections are visible; selecting Payments shows a sign-in gate without private data. |
| Wallet challenge and role discovery | ⏳ Code traced; signed browser flow has not been verified in this pass. |
| Founder/Finance/Manager/employee screens | ⏳ Role filtering is coded; live role sessions and private reads remain unverified. |
| Signed payment and settlement | ⛔ Local backend reports `paymentExecution: false`; no live payout proof. |

The earlier Overview-only sidebar was caused by the signed-out navigation filter. The UI now shows the full section map before sign-in while keeping private data behind wallet authentication and role checks.

`[x]` means the frontend action, backend route, and relevant program instruction were traced in code. It does **not** mean a wallet transaction has been confirmed on devnet.

| Part | Code path | Status |
| --- | --- | --- |
| 1. Wallet and private access | `use-mercurii.ts` signs the TEE challenge; `tee-login.ts` verifies the wallet signature and token actor; private reads use PER. Wallet change and expiry clear in-memory records. | [x] Code traced |
| 2. Company and treasury | Shell bootstrap, guided private policy/snapshot setup, receive and recipient withdrawal call onboarding routes. Snapshot and policy map to the program's private accounts. | [x] Code traced; receive/withdraw gated |
| 3. Payments | Request shell, PER permission, private terms, approval/rejection, execution, receipt reconcile, and snapshot sync call backend workflows built from the program instructions. | [x] Code traced; token execution gated |
| 4. Payroll | CSV preview, recipient readiness, manual run, signed approval chunks, scheduled encrypted roster, launch and recovery link to individual private payment flows. | [x] Code traced; payouts depend on execution gate |
| 5. Team access | Founder/Finance grant flows, revocation, reader cleanup, viewer sharing and policy reader restoration map to private grant/permission instructions. | [x] Code traced |
| 6. Agents | Signed finance chat, payment status, payroll run, invoice/draft tools, onchain policy/float/pay/reclaim, audit and x402 selection are exposed. | [x] Code traced; finance chat, token transfers and x402 gated |
| 7. Records | Private payment status, chain receipt inspection, treasury snapshot sync, reconciliation and audit sharing use backend reads. | [x] Code traced |

## Changes from this pass

- Added retry of the **same signed transaction** to company setup, team grant, and grant revocation flows after uncertain broadcast. No replacement signature is created until the original is reconciled.
- Exposed the backend agent's existing `get_payment_status`, `get_payroll_run`, and `check_payroll_readiness` tools in the frontend with user-selected identifiers or a validated roster.

## Still required before a live pitch

- The local backend's `/health` capabilities are controlled by `MERCURY_ENABLE_EXPERIMENTAL_RECEIVE`, `MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS`, `MERCURY_ENABLE_FINANCE_ASSISTANT`, `MERCURY_ENABLE_X402_AGENT`, and `MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW`. The matching settings are absent from the inspected local environment, so these paths remain disabled. Enable only after the corresponding devnet proof and configured mint are verified.
- Wallet-driven browser testing and role-by-role devnet confirmation are outstanding. The user asked to finish the codebase pass before that testing phase.
- Code checks passed: frontend TypeScript, lint, production build, and 2 frontend tests; backend TypeScript and 37 selected auth/payment/payroll/team/agent tests.
