# Mercurii full-stack functionality matrix

**Audit date:** 12 October 2026
**Scope:** landing page → workspace UI → Mercury HTTP service → encrypted Supabase operations → Mercury Anchor program → MagicBlock PER/private-payment boundary.

## How to read this

- ✅ **Verified:** the applicable code path exists and was verified in this audit by build, automated test, browser observation, database coverage, or a direct health check.
- 🟡 **Wired, proof pending:** the layers are connected in code, but the wallet-signed browser/devnet flow was not replayed in this audit.
- ⛔ **Unavailable:** the feature is disabled in the current runtime or the product surface does not exist.
- — **Not applicable:** the action correctly belongs to another layer. For example, a navigation click should not write to the database or call the contract.

“Contract” includes Mercury program instructions and MagicBlock PER/eSPL operations. “Database” means the encrypted application workflow record; it is never the authority for spending or permissions.

## Evidence captured in this audit

| Evidence | Result |
| --- | --- |
| Landing and app HTTP | ✅ `/` and `/app` returned 200 after a clean local restart. |
| Backend health through Next proxy | ✅ Online; company and program IDs returned; multi-company mode returned. |
| Signed-out browser navigation | ✅ All 12 workspace entries opened the correct page title and a wallet unlock gate. |
| Frontend production build | ✅ Next.js production build and TypeScript completed. |
| Frontend automated tests | ✅ 2/2 passed. They currently cover USDC parsing/formatting only. |
| Backend automated tests | ✅ 114/114 passed. |
| Mercury program tests | ✅ 2/2 passed; build emitted two Anchor/Solana `unexpected cfg` warnings. |
| Supabase connectivity | ✅ Private-record health check passed. |
| Supabase encrypted coverage | ✅ 40 payments, 42 flows, 44 payees, 35 payee links, 14 payroll runs, 4 schedules, 306 onboarding receipts, and 14 agent sessions; missing records: 0. |
| Runtime money/agent capabilities | ⛔ `privateReceive`, `paymentExecution`, `financeAgent`, `x402`, and `recipientWithdraw` all returned `false`. |
| Wallet-signed browser roles | 🟡 Founder, Finance, Manager, Requester, Viewer, Agent, and recipient sessions were not replayed in this audit. |

## 1. Entry, navigation, wallet, and private session

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | Landing “Open app / Launch on devnet” | Links to `/app` | — | — | — | Landing and app return 200 | ✅ |
| 1.2 | Workspace sidebar discovery | 12 sections visible before login | — | — | — | Every entry clicked in browser | ✅ |
| 1.3 | Locked page preview before login | Each section shows its own title and unlock message | — | — | — | Browser-observed for all 12 sections | ✅ |
| 1.4 | Backend status and default company | Health loader displays status and fills the company PDA | `GET /health` | Returns configured program ID | — | Direct health request passed | ✅ |
| 1.5 | Same-origin API gateway | Browser calls `/api/mercurii/*` | Next route proxies only `health` and `/v1/*` to port 8787 locally | — | — | Health passed through proxy | ✅ |
| 1.6 | Wallet discovery | Phantom, Solflare, or injected Solana wallet | — | — | — | Code traced; wallet browser not replayed | 🟡 |
| 1.7 | Wallet challenge | Signs TEE login message | `POST /v1/auth/tee-login/challenge` | MagicBlock validator challenge | — | Backend unit tests passed | 🟡 |
| 1.8 | Private login | Submits wallet, challenge, signature; token remains in memory | `POST /v1/auth/tee-login` | TEE token is wallet-bound | Agent session can be encrypted after agent use | Auth tests passed; browser signature pending | 🟡 |
| 1.9 | Role discovery | Resolves Founder or best active grant | Reads policy, team members, and company context | Private CompanyPolicy and TeamGrant reads | Membership cache is operational only | Unit paths pass; role browser sessions pending | 🟡 |
| 1.10 | Session expiry/account change/disconnect | Clears private resources and drafts | Rejects expired/mismatched bearer token | Private reads remain ACL-controlled | No bearer token stored in browser DB/storage | Code traced; browser lifecycle pending | 🟡 |
| 1.11 | Role-filtered sidebar after login | Filters actions by Founder/Finance/Manager/etc. | Server rechecks the role for every protected action | Program remains final authority | — | Code traced; each role pending browser replay | 🟡 |

## 2. Company creation and private setup

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Prepare a public company shell | Founder enters Finance wallet and reviews transaction | `POST /v1/companies/bootstrap/prepare` | `initialize_company` on base layer | — | Unit tests pass; browser signature pending | 🟡 |
| 2.2 | Sign and submit shell | Wallet signs exact prepared bytes | `POST /v1/companies/bootstrap/submit` verifies message and Founder | Base transaction submission | Bootstrap is chain state | Unit tests pass; live replay pending | 🟡 |
| 2.3 | Check shell status | UI checks signature/account before preparing another | `GET /v1/companies/bootstrap/status` | Base RPC account/signature read | — | Code traced | 🟡 |
| 2.4 | Register existing shell | Founder-derived PDA is verified | `POST /v1/companies/register` | Owner, mint, Founder, and PDA derivation checked | Company registry | Company-registry tests pass | 🟡 |
| 2.5 | Delegate CompanyPolicy | Guided setup displays the next exact step | `POST /v1/onboarding/next` | `delegate_policy` on base | Onboarding receipt persisted | Backend tests and historical proof exist | 🟡 |
| 2.6 | Create and activate PER permission | Same guided signed/reconcile flow | Receipt prepare/submit/reconcile | `init_permission`, `activate_privacy` on ER | Encrypted receipt persisted | Code/tests pass; browser replay pending | 🟡 |
| 2.7 | Configure private limits | Founder reviews monthly/agent limits | Guided onboarding route | `configure_limits` on ER | Onchain policy is authority | Privacy-order test passes | 🟡 |
| 2.8 | Create private treasury snapshot | Setup panel continues snapshot sequence | Guided onboarding route | `create_snapshot_shell`, `delegate_snapshot`, `init_snapshot_permission`, `activate_snapshot_privacy` | Receipt persisted | Backend tests/historical devnet proof | 🟡 |
| 2.9 | Company Overview | Metrics, balance, budget, team, recent payments | Policy/snapshot/payments/team endpoints | Private policy and snapshot reads | Encrypted operational lists | UI exists; signed Founder view pending | 🟡 |

## 3. Receive, hold, recipient balance, and withdraw

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1 | Read private treasury balance | Overview and Receive show snapshot | `GET /v1/treasury-snapshot` | ACL-protected TreasurySnapshot on PER | — | Backend tests and prior devnet proof | 🟡 |
| 3.2 | Prepare private company deposit | Receive form accepts exact USDC and privacy split/delay | `POST /v1/onboarding/company-funding/next` | MagicBlock Private Payments base→ephemeral builder | Encrypted receipt | Runtime flag is off | ⛔ |
| 3.3 | Sign/reconcile/retry deposit | Original signed bytes are retained for safe retry | Receipt submit/reconcile routes | Wallet-signed deposit; destination credit must be observed | Receipt state persisted | Tests pass; runtime flag is off | ⛔ |
| 3.4 | Read recipient’s own balance | “My private balance” view | `GET /v1/recipient-balance/:owner` | Private eSPL balance on selected PER | — | Tests/prior proof exist; browser role pending | 🟡 |
| 3.5 | Recipient withdrawal | Amount, prepare, sign, reconcile, retry | `/v1/onboarding/recipient-withdraw/next` | Recipient-signed private→base withdrawal | Encrypted receipt | Runtime flag is off | ⛔ |

## 4. Payees and recipient onboarding

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.1 | List payees | Payees table | `GET /v1/payees` | — | Encrypted payee repository | DB coverage: 44/44 | ✅ |
| 4.2 | Register employee/contractor/vendor | Kind, label/team, recipient form | `POST /v1/payees` | Does not grant treasury authority | Encrypted payee record | Tests and DB coverage pass | ✅ |
| 4.3 | Deactivate payee | UI action | `POST /v1/payees/:id/deactivate` | — | Encrypted state transition | Backend tests pass; browser action pending | 🟡 |
| 4.4 | Link payee to payment | Displayed on payment ledger | Backend links validated payee to payment ID | — | Encrypted payee-link record | DB coverage: 35/35 | ✅ |
| 4.5 | Prepare recipient for private payout | Payees embeds recipient onboarding | `POST /v1/onboarding/recipient/next` | Private Payments recipient deposit/onboarding | Encrypted receipt | Runtime receive flag is off | ⛔ |

## 5. Private payment lifecycle

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5.1 | Create payment ID and terms | Recipient, amount, payee and branch form | `POST /v1/payment-flows/:id/next` | — until shell build | Encrypted payment-flow record | Tests and DB coverage pass | ✅ |
| 5.2 | Create request shell | Guided step with signer/chain shown | Same guided route | `create_request_shell` on base | Receipt + flow state | Code/tests pass; wallet replay pending | 🟡 |
| 5.3 | Delegate request | Guided next step | Same guided route | `delegate_request` on base | Receipt persisted | Code/tests pass | 🟡 |
| 5.4 | Activate request privacy/readers | Guided Founder step | Same guided route | `init_request_permission`, `activate_request_privacy`, `set_request_readers_v2` | Receipt persisted | Reader tests pass | 🟡 |
| 5.5 | Submit private request | Requester signs exact recipient/amount | Same guided route | `submit_payment` on ER | Private terms remain encrypted/onchain | Grant/branch tests pass | 🟡 |
| 5.6 | Load existing request | Payment ID lookup | `GET /v1/payment-flows/:id` and `/v1/payment-requests/:id` | ACL-protected request read | Encrypted flow state | Backend tests pass; browser role pending | 🟡 |
| 5.7 | Approval queue | Approvals list and opens request | Payment jobs list/status | Reads pending PaymentRequest | Encrypted payment state | UI/API wired; signed role pending | 🟡 |
| 5.8 | Approve request | Founder/Finance/Manager signs when permitted | Guided payment route | `approve_payment`; grant and branch constraints | Receipt/flow transition | Program and backend tests pass | 🟡 |
| 5.9 | Reject request | Prepare, sign, reconcile, retry | `POST /v1/payment-flows/:id/reject` | `reject_payment` | Encrypted receipt/flow | Code traced; browser replay pending | 🟡 |
| 5.10 | Prepare treasury execution | UI shows exact execution and signer | `POST /v1/payment-jobs/:id/prepare` | Builds `execute_payment` with derived eSPL accounts | Encrypted payment state | Runtime execution flag is off | ⛔ |
| 5.11 | Sign and submit payment | Wallet signs, then settlement is inspected | `POST /v1/payment-jobs/:id/submit` | `execute_payment` transfers eSPL and updates request atomically | Signature/state persisted | Runtime execution flag is off | ⛔ |
| 5.12 | Inspect chain and settlement | Ledger/records status | `GET /v1/payment-jobs/:id`, transaction status | Request state + chain signature | Encrypted payment record | Reconciliation tests pass; live replay pending | 🟡 |
| 5.13 | Retry uncertain original | Reuses same signed bytes | Submit/reconcile routes | Prevents a second economic action | Exact signed hash/state persisted | Recovery tests pass | ✅ |
| 5.14 | Rebuild expired unsigned execution | UI verifies expiry first | `POST /v1/payment-jobs/:id/rebuild` | New transaction only after safe expiry | Versioned payment state | Recovery tests pass | ✅ |
| 5.15 | Sync treasury snapshot | Founder/Finance signs stale snapshot correction | `POST /v1/payment-jobs/:id/snapshot-sync` | `sync_treasury_snapshot` | Receipt persisted | Code/tests pass; wallet replay pending | 🟡 |

## 6. Payroll and schedules

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6.1 | Parse CSV roster | Preview errors, duplicates, exact micro-USDC | `POST /v1/payroll-runs/preview` | — | Roster not persisted during preview | Parser tests pass | ✅ |
| 6.2 | Check payout readiness | Shows per-recipient readiness | `POST /v1/payroll-runs/readiness` | Checks recipient onboarding/policy context | — | Readiness tests pass | ✅ |
| 6.3 | Create payroll run | Create button after preview/readiness | `POST /v1/payroll-runs` | Creates individual guided payment IDs | Encrypted payroll run and flows | DB coverage: 14/14 | ✅ |
| 6.4 | View run and item states | Run detail with individual payments | `GET /v1/payroll-runs/:id` | Reads related private requests/status | Encrypted run state | Backend tests pass; signed UI pending | 🟡 |
| 6.5 | Approve in chunks | Wallet reviews groups of up to eight | `POST /v1/payroll-runs/:id/approve` | Multiple `approve_payment` instructions | Encrypted receipt/run transition | Approval planning tests pass | 🟡 |
| 6.6 | Execute each payout | Run opens selected item in Payments | Payment execution endpoints | `execute_payment` per recipient | Payment state + run state | Runtime execution flag is off | ⛔ |
| 6.7 | Recover failed payout | Inspect, rebuild, sign, submit, reconcile | `POST /v1/payroll-runs/:id/recover` + payment submit | Rebuild only after proved safe state | Encrypted payment/run updates | Recovery tests/prior proof exist | 🟡 |
| 6.8 | Create recurring schedule | Validate roster, encrypt locally, sign schedule | `POST /v1/payroll-schedules` | Calendar itself never signs money | Encrypted schedule and caller-encrypted roster | DB coverage: 4/4 | ✅ |
| 6.9 | Pause/resume schedule | Founder action | `PATCH /v1/payroll-schedules/:id` | — | Signed encrypted state change | Auth tests pass; browser action pending | 🟡 |
| 6.10 | Launch due cycle | Date/readiness check then creates run | `POST /v1/payroll-schedules/:id/launch` | Payouts still require wallet approvals/execution | Schedule cycle + payroll run | Schedule tests/prior proof exist | 🟡 |

## 7. Team roles, access, and private sharing

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7.1 | List members and grants | Team access view | `GET /v1/team-members` | Reads private TeamGrant accounts | Operational membership cache | Backend tests; role browser pending | 🟡 |
| 7.2 | Issue Finance grant | Founder form and guided signing | `/v1/onboarding/finance-grant/next` | Grant shell, delegate, permission, configure grant | Encrypted receipts/cache | Finance grant tests pass | 🟡 |
| 7.3 | Issue Manager grant | Finance-scoped form | `/v1/onboarding/manager-grant/next` | Child grant with branch/cap constraints | Encrypted receipts/cache | Manager scope tests pass | 🟡 |
| 7.4 | Issue Requester/Viewer/Agent/member grant | Founder form | `/v1/onboarding/member-grant/next` | Private member grant lifecycle | Encrypted receipts/cache | Team permission tests pass | 🟡 |
| 7.5 | Revoke grant | Founder action with exact receipt retry | `/v1/team-grants/:grant/revoke/next` | `revoke_grant` | Receipt/cache updates | Revocation tests/prior proof exist | 🟡 |
| 7.6 | Clean revoked historical readers | Guided cleanup plan/actions | Finance/Manager/member cleanup routes | Rewrites request/policy/agent PER permissions | Receipts and flow metadata | Cleanup tests pass | 🟡 |
| 7.7 | Share one request with Viewer | Request + viewer grant form | `/v1/access/request-viewer/next` | `set_request_readers_v2` | Receipt and reader metadata | Reader tests pass | 🟡 |
| 7.8 | Restore Finance policy reader | Recovery form | `/v1/access/policy-readers/restore/next` | `restore_policy_readers` | Receipt | Code/tests pass | 🟡 |

## 8. AI agents and bounded automation

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8.1 | Signed Finance Agent chat | Tool/intent UI | Challenge + `POST /v1/agent/chat` | Reads only role-permitted private records | Encrypted session/audit | Runtime finance-agent flag is off | ⛔ |
| 8.2 | Treasury/payment/payroll tools | Explicit selectors and verified result cards | Deterministic tools around private endpoints | Private reads remain PER-authorized | Encrypted audit facts | 20+ agent tests pass; runtime flag off | ⛔ |
| 8.3 | Invoice review to draft | Text review and draft handoff to Payments | Invoice agent/tool validates registered vendor and cap | Does not sign or execute money | Encrypted invoice idempotency record | Tests pass; invoice file intake absent | 🟡 |
| 8.4 | Agent audit history | Audit panel | Challenge + `POST /v1/agent/audit` | Rechecks live grant | Encrypted agent audit records | DB coverage: 14 sessions; browser pending | 🟡 |
| 8.5 | Create private AgentPolicy | Founder setup wizard | `/v1/onboarding/agent/next` | Agent shell/delegate/permission/configure lifecycle | Encrypted receipts | Tests/prior proof exist | 🟡 |
| 8.6 | Discover/load AgentPolicy | Agent/Founder actions | `GET /v1/agent-policies` and `/:id` | ACL-protected private AgentPolicy | — | Code traced; signed role pending | 🟡 |
| 8.7 | Fund isolated agent float | Founder action | `/v1/agent-policies/:id/fund/next` | `fund_agent_float` | Encrypted receipt | Runtime token-CPI flag is off | ⛔ |
| 8.8 | Agent capped payment | Agent signs allowed payment | `/v1/agent-policies/:id/pay/next` | `agent_pay` enforces recipient, mint, per-payment/period caps | Encrypted receipt/audit | Runtime token-CPI flag is off | ⛔ |
| 8.9 | Reclaim/revoke agent | Founder action | reclaim/revoke next routes | `reclaim_agent_float`, `revoke_agent` | Encrypted receipt | Revoke wired; token reclaim flag off | ⛔ |
| 8.10 | x402 purchase | Service/task selection in Agent UI | Signed challenge + isolated signer | Separate wallet, never treasury authority | Local journal + encrypted mirror | Runtime x402 flag is off | ⛔ |

## 9. Records, audit sharing, and reconciliation

| # | Small functionality | Frontend | Backend/API | Contract/PER | Database | Current proof | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9.1 | Payment settlement record | Records view by payment ID | Payment job/flow reads | Private request + chain status | Encrypted payment and flow | Code/tests pass; signed browser pending | 🟡 |
| 9.2 | Founder reconciliation sweep | Paginated reconciliation action | `POST /v1/reconciliation/run` | Read-only chain/request comparison | Encrypted payment records | Reconciliation tests pass | ✅ |
| 9.3 | Create auditor share | Founder selects payroll runs and expiry | `POST /v1/compliance/audits` | No live treasury permission granted | Encrypted frozen bundle; local dedicated journal | Tests/prior live proof exist | 🟡 |
| 9.4 | Open auditor bundle | Token-based read surface | `GET /v1/compliance/audits/:id` | Cannot read live PER accounts | Encrypted ciphertext/token hash | Tests pass; standalone portal absent | 🟡 |
| 9.5 | Revoke auditor share | Founder action | `POST /v1/compliance/audits/:id/revoke` | — | Journal/mirror state | Tests/prior proof exist | 🟡 |
| 9.6 | Workspace settings | Shows company, wallet, program, network, capability flags | Health/config data | — | — | Signed-out page opens; signed details pending | 🟡 |

## 10. Confirmed gaps and next fixes

| Priority | Gap | Evidence | Concrete next fix |
| --- | --- | --- | --- |
| P0 demo | Core money/agent capabilities are disabled | Health returns all five capability flags as `false` | Validate current devnet mint/validator proof, then enable one flag at a time and replay its exact signed browser flow. |
| P0 demo | No current wallet-signed browser matrix | Only signed-out navigation was replayed in this audit | Use Founder, Finance, Manager, Requester/Agent, Viewer, and recipient wallets; record expected visible sections, denied sections, and one permitted action per role. |
| P1 quality | Frontend interaction tests are almost absent | Only two number-formatting tests exist | Add browser/component tests for navigation gates, role filtering, session clearing, payment step state, and retry/reconcile protection. |
| P1 product | Employee recipient has balance, but no employee payment-history ledger | Backend has no recipient-scoped payment-history index | Add a recipient-scoped encrypted index/API and a “My payments” UI without exposing other salaries. |
| P1 product | Auditor workflow lacks a dedicated portal | Bundle API exists; Records screen is Founder-centric | Add a token-entry auditor route that renders only the frozen bundle and expiry/revocation state. |
| P1 durability | Audit-share and x402 dedicated repositories remain local | Docs and server use local journals with encrypted mirrors | Add database-primary repositories with optimistic concurrency before hosted production use. |
| P1 security | Program is not ready for mainnet custody | No external audit/fuzz campaign; runtime gates remain closed | Run Anchor/Solana security audit plus fuzz tests, then limited-fund mainnet pilot. |
| P2 maintenance | An unused mock workspace remains in source | `/app` imports `MercuriiApp`; `mercurii-workspace.tsx` is not referenced | Remove or archive the obsolete preview after confirming no design references depend on it. |
| P2 warning | Logo asset aspect ratio is non-square while one app usage requests 36×36 | Next dev logs an image sizing warning | Render inside a fixed square using `fill`, or provide a correctly cropped square asset. |
| P2 tooling | Contract test emits Anchor/Solana cfg warnings | `cargo test -p mercury` passes with two warnings | Pin/align the macro/toolchain combination or document the accepted devnet warning before CI gating. |

## Honest completion summary

- **Frontend surface:** all planned workspace sections exist and are discoverable. Signed role behavior is still unverified in the browser.
- **Frontend ↔ backend:** routes are wired across setup, payments, payroll, team, agents, and records. Core money and agent routes deliberately fail closed because their runtime flags are off.
- **Backend ↔ database:** the primary encrypted Supabase repositories are enabled and current local operational coverage is complete. Audit-share and x402 dedicated repositories are still local-first.
- **Backend ↔ smart contract:** transaction builders map to the Mercury program instructions and backend/program tests pass. This audit did not replay signed devnet transactions.
- **Production readiness:** no. The codebase is a strong devnet MVP, but the disabled live capabilities, missing role-by-role browser proof, thin frontend tests, and lack of an external program audit are real release gates.
