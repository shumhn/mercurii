<p align="center"><img src="frontend/public/mercurii-symbol-blue.png" alt="Mercurii symbol" width="56" /></p>

<h1 align="center">Mercurii</h1>

<p align="center"><strong>Private financial operations for onchain stablecoin businesses.</strong></p>

<p align="center">
  <a href="https://www.trymercurii.xyz/">Website</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#magicblock-integration">MagicBlock</a> ·
  <a href="#market-opportunity">Market</a> ·
  <a href="#competitive-landscape">Competitors</a> ·
  <a href="#business-model">Business model</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#devnet-proof">Devnet proof</a> ·
  <a href="#getting-started">Getting started</a>
</p>

---

## Overview

Mercurii is a private USDC operating account for startups, agencies, and onchain teams. A Founder creates a company, activates private operations, receives USDC, and then invites people into scoped finance workflows. The workspace covers treasury visibility, invoices and payment requests, payroll, vendor payouts, approvals, settlement tracking, and bounded AI-agent activity.

| Capability | What the user can do |
| --- | --- |
| **Private treasury** | Receive into a company-controlled private balance and refresh a permissioned treasury snapshot. |
| **Company payments** | Create requests, approve them under policy, execute once, and reconcile signed receipts. |
| **Payroll and payees** | Group employee payouts into runs, track each item, and onboard recipients for private balances. |
| **Team access** | Give Founder, Finance, Manager, Requester, Viewer, and Agent wallets distinct scopes; revoke grants and clean up historical readers. |
| **AI assistance** | Inspect authorized records and prepare drafts; separately funded agents have bounded payment rules when enabled. |

**Current status:** This is a Solana devnet MVP with a Next.js workspace, separate noncustodial API, Anchor program, MagicBlock Private Ephemeral Rollup (PER), and encrypted operational storage. It is not audited or ready for real company funds. The running backend's capability flags determine which money-moving and agent features are available; the UI does not replace unavailable state with sample financial data.

## MagicBlock integration

MagicBlock is Mercurii's private payment and execution layer. The **Private Payments API** constructs unsigned USDC deposits and recipient withdrawals for wallet review. The **PER** holds delegated company policy, grants, payment requests, agent policy, and treasury snapshots in a TEE-backed environment. The Mercury program enforces spending and approval rules there.

### End-to-end company payment

1. A Founder signs creation of a minimal company policy account on Solana devnet.
2. Mercurii delegates the account to the MagicBlock PER, initializes its permission account, and activates private readers **before** writing sensitive limits.
3. A payer signs an unsigned Private Payments deposit. An authorized wallet then signs a treasury snapshot sync; the UI shows the confirmed private balance rather than assuming a submitted deposit has settled.
4. A requester creates and delegates a payment-request shell. PER permission initialization and privacy activation precede writing the recipient and amount.
5. The requester submits the private terms. Founder, or an authorized Finance or scoped Manager wallet, approves within its grant. Founder or authorized Finance signs execution; Manager cannot release treasury funds.
6. Mercury checks the request status, recipient, role, limits, budget, and token balance, then moves private USDC and marks the request executed in one PER transaction. The application reconciles the signed receipt and refreshes the treasury snapshot.

```mermaid
flowchart LR
    Founder[Founder wallet] -->|signs company setup| Base[Solana devnet shell]
    Base -->|delegate| PER[MagicBlock TEE / PER]
    Payer[Payer wallet] -->|signed private deposit| Payments[Private Payments API]
    Payments --> PER
    PER -->|permissions before terms| Request[Private payment request]
    Request -->|approval and execution| Program[Mercury program checks]
    Program --> Recipient[Recipient private USDC balance]
    Program --> Snapshot[Private treasury snapshot]
```

Mercurii verifies the required signer, transfer route, destination RPC, and expected validator before submitting a Private Payments builder result. PER permissions govern **who can read** an account; the Mercury program separately checks **who may act or spend**. Neither mechanism replaces the other. For implementation detail, see [architecture](docs/ARCHITECTURE.md), [PER transaction catalog](docs/magicblock-per-proof-catalog.md), and the [generated IDL](backend/idl/mercury.json).

## The problem

A client can pay an agency in stablecoins from anywhere, and the agency can pay a remote team without waiting for bank hours. But once the company's public wallet is associated with its name, observers may infer revenue, balances, payroll timing, vendor relationships, and cash flow. A shared wallet also gives a growing team no clear answer to who may prepare, approve, or execute a payment.

Mercurii gives that business a company account with private operating state and explicit authority for each person or agent. The Founder can see the full company picture; a Finance operator works within a grant; a Manager can approve a scoped request; a recipient can see their own private balance.

## Who it is for

| User | Workspace scope |
| --- | --- |
| **Founder** | Creates the company, sets limits, manages grants, sees the full private treasury, and can approve and execute payments. |
| **Finance** | Prepares, approves, executes, and reconciles within a Founder-issued grant and its recipient and spending limits. |
| **Manager** | Handles requests explicitly shared with their branch and approval scope; cannot execute a treasury payout. |
| **Requester or employee** | Prepares their own requests and sees only records shared with them; receiving a salary does not grant treasury authority. |
| **Viewer or auditor** | Reads only assigned private records or a frozen, expiring audit bundle. |
| **Agent** | Reads permitted records or spends from a separate capped float; cannot acquire unrestricted treasury authority. |

## Market opportunity

Stablecoins are already a business payment rail. [Allium's September 2026 research](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026) estimates the following payment flows from January through August 2026:

| Payment lane | Estimated volume | Why it matters to Mercurii |
| --- | ---: | --- |
| All stablecoin payments | **$401B–$527B** | Establishes that the payment rail is being used. |
| B2B settlement | **$137B–$153B** | Companies are already counterparties. |
| Service fees | **$56B** | Relevant to agencies and studios receiving client revenue. |
| Payroll | **$43B** | Relevant to recurring team payouts. |
| Supplier payments | **$28B** | Relevant to vendor and contractor workflows. |

These are estimated market-wide payment flows, **not Mercurii's addressable revenue or transaction volume**. Allium also reports that businesses received 58%–64% of stablecoin payments during this period. The opportunity for Mercurii is the software layer companies need around those payments: confidentiality, permissions, approvals, and reconciliation.

Mercurii's initial target buyer is narrower: a **2–50 person crypto-native agency, product studio, or onchain startup** that already receives USDC and regularly pays remote contractors or vendors. Its founder or finance lead feels the privacy and approval problem today, without first needing a new fiat account or a full HR system.

| Segment | Starting need | Product expansion |
| --- | --- | --- |
| Crypto agencies and studios | Confidential client revenue, vendor and contractor payouts. | Recurring payroll batches and finance-team access. |
| Onchain startups | Founder-controlled treasury with explicit approval and spending limits. | Branch/team scopes and accountant sharing. |
| Distributed service networks | Repeated payouts across many recipients. | API workflows and bounded agent operations. |

The revenue opportunity still needs a bottom-up measure: **qualified reachable teams × validated annual contract value**, plus any net revenue from private operations. We have not established that buyer count, willingness to pay, or a revenue TAM. The [market research](research/mercurii-market-research-2026-10-13.md) records the assumptions and interview plan.

## Competitive landscape

The alternatives already solve meaningful parts of company finance. Mercurii's proposed difference is one private operating state spanning treasury, requests, approvals, role-scoped records, and bounded agents; that differentiation must be proven through repeat use and security work.

| Alternative | What it offers today | Where Mercurii aims to differ |
| --- | --- | --- |
| [Request Finance](https://www.requestfinance.com/) | Business accounts, invoices, approvals, payroll, accounting, and stablecoin/fiat payments. Its [private payments](https://help.request.finance/en/articles/12958312-private-payments-overview) use partner custodial wallets to obscure payment linkage. | Self-custodial Solana policy plus permissioned company operating records, rather than private routing alone. |
| [Umbra Payroll](https://payroll.umbraprivacy.com/) | Private, noncustodial Solana payroll, employee balances, and withdrawals. | A broader company account for incoming revenue, vendors, approvals, records, and agent permissions. |
| [Squads](https://docs.squads.so/main/getting-started/treasury-management-overview) | Self-custodial treasury, multisig policy, spending limits, and payments. | Confidential operating details and scoped financial reads alongside program-enforced authority. |
| [Ramp for Agents](https://agents.ramp.com/) | Agent identity, owner, budget, human approver, merchant restrictions, and audit trail. | Bounded agent activity linked to a private Solana company treasury workflow. |
| Wallet or multisig plus spreadsheet | Familiar tools for signing and tracking payments. | One workflow for private balances, requests, approvals, recipients, and reconciliation. |

Mercurii has a differentiated design, **not yet a proven moat**. Request Finance has a much wider finance suite; Umbra focuses sharply on payroll; Squads has mature treasury infrastructure. Mercurii must earn trust through a repeatable signed browser flow, independent security review, integrations, and design-partner retention. See the fuller [competitive research](research/mercurii-market-research-2026-10-13.md#6-competitive-landscape).

## Go-to-market strategy

| Stage | Action | What to learn |
| --- | --- | --- |
| **Find the first teams** | Recruit USDC-first agencies and studios with monthly contractor or vendor payouts. | Who owns finance, how often they pay, and where the current workflow breaks. |
| **Demonstrate the problem** | Show what an observer can infer from a known public company wallet, with Mercurii's own metadata boundary stated plainly. | Whether privacy and delegated approval are urgent enough to change tools. |
| **Run a repeated workflow** | Complete receive → request → approval → payout → reconciliation with real signatures over more than one payment cycle. | Completion, repeat usage, failures, and support cost. |
| **Expand the account** | Add payroll batches, accountant sharing, integrations, and agent controls for teams that return. | Which workflow earns a paid subscription and which needs usage pricing. |

Potential distribution includes Solana and MagicBlock teams, crypto agencies, accelerator cohorts, and finance/accounting partners. Design partners, conversion, retention, and willingness to pay are **validation goals**, not claimed current traction. The local [pitch deck](docs/pitch/mercurii-devnet-deck-2026-10-13.html) shows the same product story and labels its technical proof separately from commercial evidence.

## Business model

The proposed model is **software subscription plus measured private-operation usage**, with no token required. Billing is not implemented in the devnet app, and the figures below are pricing hypotheses for interviews rather than active plans.

| Proposed tier | Buyer and value | Pricing hypothesis |
| --- | --- | --- |
| **Team** | Founder-led private treasury, requests, basic roles, and payouts. | Around **$99/month**. |
| **Operations** | Regular payroll/vendor batches, approval policy, reconciliation, and scoped reporting. | Around **$299/month**. |
| **Platform** | API access, advanced agent limits, multiple entities, and integrations when built. | Around **$599/month**. |

These hypotheses should be tested against competitors' published [subscription pricing](https://www.requestfinance.com/pricing) and actual interviews. A possible usage unit is a completed private payment or payroll item, with a bundled monthly allowance to keep bills predictable. The unit contribution would be **collected usage fee − MagicBlock/PER, RPC, storage, and support costs**. Those costs and willingness to pay have not yet been measured, so Mercurii has **no claimed customers, payment revenue, ARR, or validated unit economics** in this repository.

## Roadmap

| Stage | Milestone |
| --- | --- |
| **Built on devnet** | Mercury program, PER account delegation and permissions, recorded private receive/approval/payment proofs, Next.js workspace, API, and encrypted records. |
| **Next demo gate** | Replay one complete Founder-to-recipient flow in the current browser/backend environment; confirm every runtime capability and recovery step with real wallet signatures. |
| **Design-partner gate** | Interview target teams, observe repeated payment runs, test subscription willingness to pay, and measure retained use. |
| **Production gate** | Independent program/security review, operational recovery, durable multi-company services, compliance review, and a limited-funds pilot. |

## What the application covers

| Workflow | Mercurii behavior |
| --- | --- |
| **Receive and hold** | Build a payer-signed private USDC deposit, then synchronize a permissioned treasury balance snapshot. |
| **Pay contractors and vendors** | Prepare a private request, collect the required approval, execute a policy-checked payout, and reconcile its signed receipt. |
| **Payroll** | Preview and check a roster, approve items in chunks, and track each payout separately. Recurring schedules still require human signatures to release funds. |
| **Team permissions** | Founder, Finance, Manager, Requester, Viewer, and Agent grants have distinct scopes. Revocation includes guided cleanup of historical private readers. |
| **AI assistance** | Authorized tools can inspect permitted records, check invoices and budgets, and prepare payment drafts. A separately funded AgentPolicy can cap an agent's onchain spending; x402 uses a separate bounded wallet when enabled. |
| **Records and audit** | Compare private request state, signed receipts, treasury snapshots, and selected frozen audit disclosures. |

The interface uses real backend and chain state. A disabled feature or denied private read is shown as unavailable; it is not replaced with a sample balance or payment.

## How it works

1. **Create a company.** The Founder connects a Solana devnet wallet and signs creation of the company account. Its address is a program-derived account, not a wallet that holds USDC. The Founder is the initial administrator; teammates are added later.
2. **Activate private operations.** A guided flow delegates the company's account to MagicBlock, creates its PER permission, activates privacy, writes spending limits, and sets up a private treasury snapshot.
3. **Fund the treasury.** A payer signs a MagicBlock Private Payments deposit. The Founder signs a snapshot sync; a submitted deposit alone does not make the displayed balance current.
4. **Set access.** The Founder grants Finance, Requester, or Viewer access. An authorized Finance operator may grant a narrower Manager scope. Private reads follow PER permissions; spending follows program checks.
5. **Run payments.** The application guides request creation, delegation, permission activation, private submission, approval, execution, and receipt reconciliation. A completed request cannot be executed twice.
6. **Pay the team.** Payroll groups private payment requests, approves up to eight items per transaction, and tracks each payout independently. A recipient can read their private balance and sign a withdrawal when that route is enabled.

Every company payment is completed by an authorized wallet signature. Mercurii's API constructs and validates transactions but does not hold the Founder's private key.

### Founder demo walkthrough

1. Open `/app` and connect the wallet that will be the Founder. **Create company** makes that wallet the initial administrator; a Finance wallet is not required first.
2. Sign each **Company setup** step. Wait for its receipt and confirmed chain status before advancing through delegation, private permission, privacy activation, spending limits, and balance tracker.
3. Open **Receive**, sign a devnet deposit when the receive route is enabled, and refresh the private treasury snapshot. The displayed balance is not a live read of a public wallet.
4. In **Payees** and **Team access**, add a recipient and grant only the access needed for the demo.
5. In **Payments**, create a request, sign its private setup and submission, approve it with an authorized wallet, execute, and check its receipt in **Records**. **Payroll** groups the same kind of requests into a run.

This is a wallet-signed devnet walkthrough. Actual prompts, enabled buttons, and balances depend on the current company, funding, permissions, and backend `/health` capabilities.

## Architecture

The browser collects wallet signatures. The API verifies session and transaction details, prepares unsigned actions, recovers receipts, and stores encrypted workflow records. Company spending authority remains with wallet signers and Mercury's onchain checks; Supabase is not a treasury key store.

| Component | Role |
| --- | --- |
| **Next.js workspace** | Guided Founder setup and role-scoped finance screens; wallet signs every treasury action. |
| **Mercurii API** | Authenticates wallet sessions, validates transaction builders, coordinates signed steps, and reconciles receipts. |
| **Mercury Anchor program** | Enforces company roles, recipients, budgets, approvals, revocation, and one-time payment execution. |
| **MagicBlock PER and eSPL** | Executes delegated confidential state and keeps operating token balances available to authorized readers. |
| **Private Payments API** | Prepares wallet-signed deposits and recipient withdrawals; it does not approve company spend. |
| **Supabase and encrypted records** | Persists private workflow metadata and recovery state without holding company signing keys. |

```mermaid
flowchart LR
    W[Founder / team wallet] -->|reviews and signs| UI[Next.js workspace]
    UI --> API[Mercurii API]
    API --> MB[MagicBlock Private Payments API]
    API --> DB[(Encrypted operational records)]
    API -->|submits signed base transactions| S[Solana devnet]
    S -->|delegate account shells| PER[MagicBlock TEE / PER]
    API -->|submits signed private transactions| PER
    API -->|authenticated private reads| PER
    PER --> P[Mercury program rules]
    P --> T[Private USDC balances]
```

### Where data lives

| Layer | Responsibility |
| --- | --- |
| **Solana devnet** | Program deployment, public account shells, delegation transactions, and observable funding/withdrawal legs. |
| **MagicBlock PER** | Permissioned company rules, team grants, payment requests, agent limits, treasury snapshots, and private execution. |
| **Private USDC balances** | Company, recipient, and isolated agent float balances on the selected PER. |
| **Mercurii API and Supabase** | Wallet challenge verification, unsigned transaction preparation, receipt recovery, and encrypted workflow records. The database is not spending authority. |

### Privacy boundary

Mercurii does **not** claim complete anonymity. Program and account addresses, public shell creation, delegation, and some base-layer funding or withdrawal activity remain observable. A base-layer payer, amount, and timing may be visible or inferable. The PER protects sensitive operating state and limits its readers; a treasury snapshot may be stale until an authorized wallet signs a refresh. Permission changes and revocations must be confirmed, and historical reader cleanup must complete before treating access as removed.

## Devnet proof

The [deployed Mercury program](https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet) and its generated [IDL](backend/idl/mercury.json) are listed below.

These transactions show one recorded MagicBlock payment-request sequence. The first two steps use Solana devnet to create and delegate a public shell. The remaining links use the MagicBlock TEE devnet endpoint. They demonstrate the request through private approval and snapshot sync; execution is evidenced separately below.

| Step | Network | Proof |
| --- | --- | --- |
| Create request shell | Solana devnet | [Transaction](https://explorer.solana.com/tx/2qD47V692yWJfwPi3vJZsr6vBmoite55m4zkbjDHSEjsum6npZCtCyqDivZtPFVKrotoSe2xgipk5PA7ir5DDFYr?cluster=devnet) |
| Delegate request | Solana devnet | [Transaction](https://explorer.solana.com/tx/TnnrvjxM9CgLZCjTUSGriGEsL97EAKSe96UnqZpdhzGS8hYZ2A82FF4JCGYiX4xW4YJFGZQ3PC1JzihcYKAAoPN?cluster=devnet) |
| Create PER request permission | MagicBlock PER | [Transaction](https://explorer.solana.com/tx/bDkZEJgxbQgx7PRb5mgcBteZPKY6r8ZgCBFsEM5B9DrvVhS9Eh2wKWj4iPcwgBnJRXXwVNFs3D7pkVgkw5z8w6Z?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| Activate private readers | MagicBlock PER | [Transaction](https://explorer.solana.com/tx/62Sv7iqZDYNENwHLEJr51CYPHrqBne1i7xw35go77ryY2BsAByaKRynU7MQsFAbKrGAgaSZZnsSrwqZ8WVj5TmbG?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| Submit private request | MagicBlock PER | [Transaction](https://explorer.solana.com/tx/ZtuE8o9wuwZzZFU1U5vpetoa9GhZkSfcuxTy5wu7tEmL7mw25HC3ejHcj8VLXGZVmRtf4ECyKf4noFNNnpGQn9y?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| Approve private request | MagicBlock PER | [Transaction](https://explorer.solana.com/tx/5FG99DybKnmRMrXGqW7Mbwz4mVBQFkwEPWMbd7YTpiP5TXJf5UvNcCnMAMLgMsKtjk84XyuPQbw3cinSMGSxFLwV?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| Sync private snapshot | MagicBlock PER | [Transaction](https://explorer.solana.com/tx/c5U2Dk9CkNcjk7ehxKxf1TbWA96jeBuQNCSmEpxycPUaNtc9ZViprpSXp4YGqmFqGjdJA1Gmty7RhAJ9tABESeX?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |

A separate guided Circle devnet USDC payment reached [private execution](https://explorer.solana.com/tx/37VYbGscUSXFs7wqjf1i5rBwJrCz5CM6LejpXdfhHJti5NZNgwmzDPw6NX1HN8X4TkswhYGoRSSQ9BQ1B7CmuvwN?cluster=devnet) and then [treasury snapshot refresh](https://explorer.solana.com/tx/2hpoGyWdyPvZfP8AwaK2G3BNbnPwVMj7B5fquniZcnfGsWRw7y7zyMdXUJ9YTJzmKn89ovvhrBcbJS9Y6V3vX8i5?cluster=devnet). See the [PER proof catalog](docs/magicblock-per-proof-catalog.md) for source receipts and the [historical implementation log](docs/DEVNET_IMPLEMENTATION_LOG.md) for additional payroll, team, recipient, and agent evidence.

## On-chain program

| Item | Value |
| --- | --- |
| Mercury program | [`34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L`](https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet) |
| Generated program IDL | [`backend/idl/mercury.json`](backend/idl/mercury.json) |
| MagicBlock private devnet endpoint | `https://devnet-tee.magicblock.app` |
| Circle devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

The program models company policy, team grants, payment requests, treasury snapshots, and agent policy as separate accounts. Its instructions include company initialization and delegation, private permission activation, spending-limit configuration, request submission, approval, one-time execution, agent float funding, bounded agent payment, and revocation. The [source](programs/mercury/src/lib.rs) and [IDL](backend/idl/mercury.json) show the exact interface.

## Getting started

**Prerequisites:** Node.js 22 or newer, a Solana devnet wallet with devnet SOL, access to Circle devnet USDC for payment flows, and a Supabase project with the repository's migrations applied. New-company registration requires the Supabase private store.

```bash
git clone https://github.com/shumhn/mercurii.git
cd mercurii
npm ci --prefix backend
npm ci --prefix frontend
cp backend/.env.example backend/.env.local
```

Set `MERCURY_SUPABASE_URL` and `MERCURY_SUPABASE_SECRET_KEY` in the ignored `backend/.env.local`. Apply the SQL files in `supabase/migrations/` in filename order. Keep the record encryption key file private and persistent; [database setup](docs/DATABASE_OPERATIONS.md) explains the operational stores and migration path. Never put the Supabase secret, wallet keypairs, or TEE tokens in a `NEXT_PUBLIC_*` variable or commit them.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page and [http://localhost:3000/app](http://localhost:3000/app) for the workspace. The root command starts **two local processes**: Next.js on port `3000` and the Mercury API on `127.0.0.1:8787`. The browser calls the API through the Next.js same-origin `/api/mercurii/*` gateway. `MERCURII_WEB_PORT` changes the UI port; `MERCURII_BACKEND_URL` points a hosted frontend at its separate backend.

Check the running API and its actual capabilities:

```bash
curl http://127.0.0.1:8787/health
```

The backend gates private receive, token transfer execution, Finance Agent, x402, and recipient withdrawal behind `MERCURY_ENABLE_EXPERIMENTAL_RECEIVE`, `MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS`, `MERCURY_ENABLE_FINANCE_ASSISTANT`, `MERCURY_ENABLE_X402_AGENT`, and `MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW`. A value of `1` enables the corresponding devnet route; absent flags leave it unavailable. Check `/health` and configure the required dependencies before attempting a flow. The website can load while the independently hosted API is unavailable.

The workspace does not generate a funded demo company or fallback financial records. Use an actual devnet company and wallet signatures. The [Founder demo walkthrough](#founder-demo-walkthrough) gives the click order.

## Build and test

```bash
npm run check
npm --prefix backend test
npm --prefix frontend test
cargo test -p mercury
```

`npm run check` typechecks the backend and builds the Next.js app. Live PER transaction tests require a configured devnet environment and wallet funding; passing local tests does not establish that a new company can complete every browser flow.

## Repository structure

| Path | Purpose |
| --- | --- |
| [`frontend/`](frontend/) | Next.js landing page, `/app` workspace, wallet connection, and same-origin API gateway. |
| [`backend/`](backend/) | Company registration, TEE login, workflow endpoints, unsigned transaction builders, receipt recovery, and encrypted record access. |
| [`programs/mercury/`](programs/mercury/) | Anchor program for private company policy, team grants, payment requests, treasury snapshot, and agent policy. |
| [`backend/idl/mercury.json`](backend/idl/mercury.json) | Generated program interface consumed by the backend. |
| [`supabase/migrations/`](supabase/migrations/) | Encrypted operations schema, record versions, and app indexes. |
| [`docs/`](docs/) | Architecture, functionality audit, devnet proof catalog, and implementation history. |

## Current limits

This is a devnet build. Browser flows for every role and every newly registered company still need full end-to-end replay. Payments and private balances require the correct backend flags, funded wallet, TEE access, and recipient setup. Snapshot refresh and payroll payouts require authorized signatures; schedules do not move money automatically. Base-layer funding and withdrawals can expose public metadata. Mainnet use requires operational recovery, broader failure testing, and an independent security review.

For a feature-by-feature code and runtime assessment, see the [full-stack functionality matrix](docs/FULL_STACK_FUNCTIONALITY_MATRIX.md). For the program's privacy and custody design, see [architecture](docs/ARCHITECTURE.md).
