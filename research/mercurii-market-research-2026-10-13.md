# Mercurii market and pitch research

**Research date:** 13 October 2026
**Audience assumption:** Colosseum/accelerator first, investor appendix second
**Product status used in this report:** strong devnet implementation, not production-ready and not ready for real funds

## Executive conclusion

Mercurii should not pitch itself as another stablecoin wallet, a generic crypto payroll tool, or simply “private payments.” All three categories are already crowded.

The strongest category is:

> **The confidential finance operating system for USDC-first teams.**

The clearest one-line explanation is:

> **Mercurii lets a team receive revenue, approve payroll and vendor spend, and give humans or AI scoped access to USDC—without exposing its treasury, salaries, or operating relationships on a public ledger.**

The best first customer is not “every business” and not “all stablecoin holders.” It is:

> **A 2–50 person crypto-native agency, product studio, or onchain startup that receives international revenue in USDC and pays at least five remote contractors or vendors each month.**

This wedge is attractive because the team already accepts stablecoin risk, privacy pain appears immediately, the founder still owns finance, and the product can be adopted before Mercurii builds the full banking, tax, and EOR stack.

The market is real, but the deck must stay disciplined. Stablecoin payment volume reached **$401B–$527B in the first eight months of 2026**; B2B was the largest lane at **$137B–$153B**, with **$56B in service fees, $43B in payroll, and $28B in supplier payments**. These are payment-flow markets, not Mercurii revenue TAM. A credible revenue TAM must be bottom-up: count qualified operating teams and multiply by validated annual contract value.

## 1. What Mercurii is—and is not

### Product category

Mercurii is a private operating account and policy layer for stablecoin-native teams. It combines:

- private company balance and operational state;
- payment requests, approvals, execution, and reconciliation;
- role-scoped access for Founder, Finance, Manager, Requester, Viewer, Agent, and recipient;
- payroll, contractor, and vendor payout workflows;
- bounded agent spending through an isolated float;
- selective record sharing for accountants or auditors;
- self-custodial, wallet-signed treasury actions.

### What it is not

- **Not a mixer or anonymity product.** Public deposits, withdrawals, timing, and some account metadata may remain visible.
- **Not a bank account.** It does not currently provide fiat accounts, cards, FX, deposits insurance, or bank rails.
- **Not full payroll/EOR.** Tax withholding, benefits, employment classification, payslips, and statutory filings are outside the current build.
- **Not autonomous treasury custody.** The AI prepares drafts; treasury payments remain human-signed. x402 spending uses a separate capped wallet/float.
- **Not mainnet-ready.** The repository explicitly describes a devnet implementation in progress.

### The product promise

The promise should be **confidential company finance with explicit access**, not total anonymity:

> The right people can see and act on the right financial data; the public internet cannot inspect the company’s operating ledger.

## 2. The specific customer pain

Consider a 12-person product agency paid in USDC by overseas clients:

1. A client pays the agency wallet.
2. Anyone who knows that wallet can inspect its balance and history.
3. Payroll reveals salary amounts, team size, pay dates, and recipient wallets.
4. Vendor payments reveal suppliers and operating rhythm.
5. Sharing a wallet or multisig with Finance creates broad visibility and blunt authority.
6. Requests, approvals, invoices, and reconciliation happen across chat, spreadsheets, wallets, and accounting tools.
7. An AI agent cannot safely help because the available choices are usually no access or excessive access.

This is not merely a payments-speed problem. Stablecoins already settle quickly. It is a **confidentiality, coordination, and authority problem** created when a company uses a public ledger as an operating account.

## 3. Why now

Four shifts make the timing credible:

### Stablecoins are moving from trading into company operations

Allium measured **$401B–$527B** in stablecoin payments from January through August 2026, up **42%–63% YoY**. Businesses received **58%–64%** of payment volume, and B2B was the largest payment lane. [Allium, September 2026](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026)

Visa reports that nearly **17%** of stablecoin-linked card volume in FY2026 YTD was commercial/business and that volume across its 160+ stablecoin-linked card programs grew almost **200% YoY**. [Visa, October 2026](https://investor.visa.com/news/news-details/2026/Visa-Data-Shows-Stablecoins-Gaining-Traction-in-Business-Payments/default.aspx)

### The privacy problem is now recognized as infrastructure, not a niche preference

Solana now explicitly distinguishes confidential balances, programmable privacy, and private channels, including auditor visibility and institution-controlled data access. Its documentation identifies payroll and business payments as privacy use cases. [Solana privacy documentation](https://solana.com/docs/finance/privacy)

### Solana has meaningful stablecoin and agent-payment distribution

In September 2026 Solana reported **$17.3B** of stablecoin supply, **888K** daily stablecoin active addresses, **420M monthly USDC transactions**, and **76% of x402 transactions** during the measured period. [Solana payments roundup](https://solana.com/news/payments-on-solana-september-2026-in-five-stories)

### AI spending is becoming a finance-control problem

Ramp now gives agents an identity, budget, approver, merchant restrictions, and x402 wallet. This validates the need for policy-bounded agent finance—but also means “we have an agent wallet” is not a sufficient moat. [Ramp for Agents](https://agents.ramp.com/)

## 4. Market sizing that will survive investor scrutiny

### Layer A: category movement

Use these numbers to show that stablecoin payments are becoming operational:

| 2026 payment lane | Measured volume through August |
|---|---:|
| Stablecoin payments | $401B–$527B |
| B2B settlement | $137B–$153B |
| Service fees | $56B |
| Payroll | $43B |
| Supplier payments | $28B |

Source: [Allium](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026).

Do **not** call the $85T raw transfer figure TAM. Allium found only $4T of real economic activity after removing exchange-internal, DeFi, and infrastructure transfers.

### Layer B: buyer market

The first buyer universe is teams meeting all of these conditions:

- 2–50 people;
- stablecoin revenue or treasury already exists;
- at least five contractor/vendor payments per month;
- cross-border counterparties;
- founder, finance lead, or ops lead still manages payments;
- privacy or delegated access is an active concern.

The deck should not invent the number of such teams. Build it from a qualified account list:

1. Solana/onchain startup directories and accelerator cohorts;
2. crypto-native agencies and product studios;
3. Request Finance, Rise, Squads, and similar customer archetypes;
4. remote-team communities and stablecoin payroll providers;
5. actual interview and waitlist data.

### Layer C: revenue market

Competitor pricing provides a willingness-to-pay range:

- Request Finance: **$50 / $300 / $600 per month** for Starter, Growth, and Pro. [Pricing](https://www.requestfinance.com/pricing)
- Rise: **$49 per contractor/month** for global contractor management. [Pricing](https://www.riseworks.io/pricing)
- Toku: contractor management from **$19 per contractor/month** and higher-priced compliance products. [Toku company facts](https://www.toku.com/about)

Mercurii’s bottom-up model should therefore be:

`qualified teams × validated monthly subscription + net private-operation revenue`

Until interviews validate willingness to pay, show a scenario range—not a claimed TAM. A reasonable interview hypothesis is **$99–$599/month**, depending on seats, workflows, entities, and agent/API controls.

## 5. Exact target market and expansion path

### Beachhead

**Crypto-native agencies and product studios** with remote teams.

Why start here:

- they receive service revenue across borders;
- they often pay contractors in stablecoins;
- salaries, client identity, vendor relationships, and runway are commercially sensitive;
- the founder usually controls the wallet and feels the pain directly;
- sales cycles are shorter than enterprise payroll or banking;
- they need operations tooling but not necessarily full EOR on day one.

### Second segment

**Onchain startups with 5–30 contributors** that use a multisig or founder wallet for operating spend.

### Third segment

**Web3 staffing firms, creator networks, and distributed service businesses** running repeated payouts.

### Expansion

1. Private operating account for one entity.
2. Contractor, vendor, and payroll batches.
3. Accounting/auditor shares and integrations.
4. Multiple entities and treasury policies.
5. Agent-native finance and paid APIs.
6. Regulated fiat rails through partners—not by becoming a bank too early.

## 6. Competitive landscape

### Direct and adjacent competitors

| Company/product | What it proves | What it does better today | Mercurii’s possible wedge |
|---|---|---|---|
| [Request Finance](https://www.requestfinance.com/) | Stablecoin finance operations have real demand: 1,500+ finance teams, $1B+ processed | Fiat rails, KYB, invoicing, AP, approvals, accounting, 190+ countries | Private operating state, self-custodial program policy, Solana-native agent permissions |
| [Request Private Payments](https://help.request.finance/en/articles/12958312-private-payments-overview) | Businesses will pay for transaction privacy | Production finance suite; private routing without recipient onboarding | Mercurii can protect balances, requests, roles, and records—not only break an outgoing payment link |
| [Umbra Payroll](https://payroll.umbraprivacy.com/) | Private, non-custodial Solana payroll is already a category | Encrypted salary balances, simple employee login, bank cash-out | Broader operating account: revenue, vendor/AP, approvals, agent policies, role-scoped records |
| [Toku + Aleo](https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad) | Enterprises demand private and auditable stablecoin payroll | $1B+ payroll volume, 100+ jurisdictions, tax/EOR/integrations | Smaller self-serve teams, Solana-native operations beyond payroll |
| [Squads](https://docs.squads.so/main/getting-started/treasury-management-overview) | Smart-account treasury policy is valuable | Audited, formally verified, $10B+ secured, ecosystem trust | Confidentiality and finance workflow on top of authority controls |
| [Utila](https://utila.io/) | Enterprises pay for granular wallet policy | MPC infrastructure, integrations, 400+ companies, $30B+ monthly volume claimed | Simpler application layer for small teams; private records rather than wallet infra alone |
| [Rise](https://www.riseworks.io/) | Global teams want crypto/fiat payroll | Compliance, tax, HR, 190+ countries, $1.5B+ payroll claimed | Treasury/AP privacy and self-custodial operating workflows |
| [Ramp for Agents](https://agents.ramp.com/) | Finance teams need identity, budgets, approval, and audit for AI spend | Full corporate-finance distribution; cards, ACH, banking, x402 | Private onchain treasury state and Solana-native programmable authority |
| Wallet/multisig + spreadsheet | This is the current default | Cheap, flexible, already installed | Mercurii unifies privacy, granular roles, approvals, recipient views, and records |

### The strongest direct threat

Request Finance is the benchmark, not a footnote. It already has finance operations, bank rails, approvals, payroll, reconciliation, private payments, a low entry price, and recognizable customers. Mercurii must not claim “no one solves this.”

The answer to “Why not Request?” is:

> Request’s announced private-payment flow primarily obscures the onchain link between funding and recipient through custodial routing. Mercurii is designed to make the company’s operating state itself confidential—balances, requests, roles, approvals, payroll records, and bounded agent authority—while treasury actions remain wallet-signed and policy-enforced.

This distinction must be demonstrated, not merely asserted.

### Failed and pivoted precedents

[Utopia Labs wound down its crypto payment/bookkeeping product in November 2023](https://utopia.beehiiv.com/p/winding-down), despite serving a real DAO-operations need. Coinshift’s current homepage now leads with institutional credit yield rather than its earlier treasury product. These examples warn that:

- workflow features are not a moat by themselves;
- crypto-only buyer pools can contract quickly;
- distribution and recurring willingness to pay matter more than payment volume;
- a product must own a painful operating system of record, not be a nicer front end for a multisig.

## 7. Mercurii’s real moat thesis

Mercurii does not yet have a proven durable moat. It has a **technical and product thesis** that can become one:

### Layer 1: confidential operating graph

Balances, requests, payees, approvals, branch scopes, payroll items, audit shares, and agent policies form a permissioned finance graph. Competitors focused only on transfer privacy do not automatically have this context.

### Layer 2: program-enforced authority

Caps, recipient allowlists, period budgets, delegation, revocation, and one-time execution are checked by the Mercury program—not just by UI permissions.

### Layer 3: private-by-default workflows

The sensitive state is private before confidential fields are written. Access is explicit by role and record.

### Layer 4: human and agent actors in the same policy model

The long-term opportunity is a finance system where a human employee, manager, accountant, and AI agent each receive different authority and visibility without sharing treasury keys.

### Layer 5: accumulated integrations and trust

The eventual moat must come from audited security, accounting/payroll integrations, partner distribution, and operational data—not from cryptography alone. MagicBlock, Solana confidential tooling, or another finance product can reproduce primitives.

## 8. Current product proof and evidence discipline

Repository documentation records these devnet proofs:

- private receive using a custom token and Circle devnet USDC;
- Founder and scoped Finance approval/execution;
- private recipient balance and recipient-signed withdrawal;
- bounded agent float funding/payment;
- role grants, revocation, reader cleanup, and denied reads;
- a nine-person payroll run with two approval transactions and nine payouts.

However, the 12 October 2026 functionality audit states that current runtime capability flags for private receive, payment execution, finance agent, x402, and recipient withdrawal are disabled, and the complete signed browser role matrix has not been replayed.

Therefore:

- say **“proven on devnet”** only for recorded historical proofs;
- do not say **“live”** until the exact current environment is re-enabled and replayed;
- do not call test transactions “traction”;
- use them as **technical execution evidence**;
- commercial traction requires users, repeated payment volume, retention, revenue, LOIs, or design partners.

## 9. Recommended business model

### Initial model

**Subscription + usage**, no token.

- Team tier: private treasury, requests, roles, and basic payouts.
- Operations tier: approval policies, payroll/vendor batches, accounting exports, audit shares.
- Platform tier: API, multiple entities, advanced agent policies, custom limits/support.
- Optional usage: private execution/settlement cost passed through with a margin or bundled allowance.

### Pricing hypothesis for interviews

- $99/month: founder-led small team;
- $299/month: recurring finance operations;
- $599/month: API, agents, multi-entity, or advanced compliance sharing.

These are research hypotheses anchored to Request Finance’s $50/$300/$600 plans, not final pricing.

## 10. Go-to-market

### Acquisition wedge

Sell the leak, not the cryptography:

> “Paste your company wallet. See what a competitor, employee, or client can infer about your runway, payroll, vendors, and payment calendar.”

This can become a public wallet-exposure diagnostic and lead magnet.

### First 90-day GTM

1. Recruit 10 design partners from Solana/MagicBlock teams, crypto agencies, and remote product studios.
2. Run 20 structured finance interviews; quantify payments per month, approval workflow, leaked data, tools, and willingness to pay.
3. Enable one current end-to-end browser flow and instrument completion/retention.
4. Convert 3–5 teams into a paid pilot with a narrow workflow: receive USDC and run one private contractor/vendor batch.
5. Publish one case study with time saved, privacy exposure removed, repeat usage, and payment volume.

### Distribution channels

- MagicBlock and Solana privacy ecosystem co-marketing;
- accelerator and hackathon cohorts;
- crypto CFO/accounting partners;
- agencies that pay their own distributed contractors;
- recipients invited through Mercurii payouts;
- an open-source/private-finance SDK only after the application wedge works.

## 11. Risks investors will ask about

### “Why can’t Request, Ramp, Squads, or Umbra add this?”

They can add parts. Mercurii must move faster around the integrated confidential operating graph, prove customer love, and build trust/integrations.

### Privacy boundary

PER and private-payment systems have explicit metadata and trust boundaries. The deck must say exactly what is hidden, visible, and selectively disclosed.

### Infrastructure dependency

Mercurii depends materially on MagicBlock’s PER/eSPL/private-payment infrastructure. It needs availability, migration, and failure-mode plans.

### Security

The program needs property/fuzz testing and an external audit before real funds. Security must be a roadmap milestone, not a footnote.

### Compliance

Non-custodial software is not a universal exemption. FinCEN guidance distinguishes merely developing software from operating a business that accepts and transmits value. Jurisdiction, custody, control, fiat rails, and privacy design require legal review. [FinCEN 2019 guidance](https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)

### Product breadth

Trying to ship banking, payroll, AP, accounting, agents, and compliance simultaneously will dilute the wedge. The first product must be one repeatable operating loop.

## 12. The deck Mercurii should use

### Colosseum / accelerator version: 9 slides

#### 1. Proof-led hook

**Headline:** `Company finance should not be public.`

**Subhead:** `Mercurii is the confidential finance operating system for USDC-first teams.`

Show one verified product screenshot and one proof line, for example: `Private receive → scoped approval → private payout proven with Circle devnet USDC.` Do not imply the current runtime is live until replayed.

#### 2. The shift

**Headline:** `Stablecoins are becoming business infrastructure.`

Use only three numbers: `$137–153B B2B`, `$43B payroll`, `$28B supplier payments` through August 2026.

#### 3. The enemy

**Headline:** `A public wallet turns operations into competitive intelligence.`

Visualize one agency wallet leaking runway, salaries, team graph, clients, vendors, and timing. Add the coordination problem: wallet + spreadsheet + chat + accounting.

#### 4. Why now

**Headline:** `Business adoption, programmable privacy, and AI spend converged in 2026.`

Three catalysts: business stablecoin usage; Solana privacy tooling; agents becoming financial actors.

#### 5. The product

**Headline:** `One private operating loop.`

`Receive USDC → request → policy check → human approval → private payout → recipient withdrawal → reconciliation`

Show the UI, not architecture.

#### 6. The hard technical proof

**Headline:** `Privacy and authority are enforced below the interface.`

Three layers only: Mercury program policy; MagicBlock private execution/eSPL; wallet-signed users and isolated agent float. Include exact privacy boundary.

#### 7. Beachhead market

**Headline:** `Start with USDC-first agencies and onchain teams.`

Show ICP, pain triggers, competitor pricing benchmarks, and the bottom-up formula. If interviews are complete, replace hypotheses with verified account count and willingness to pay.

#### 8. Proof and next unlock

If commercial traction exists, lead with it. If not, clearly separate:

- technical proofs already completed;
- current runtime/demo readiness;
- design partners, interviews, LOIs, or pilots;
- next 90-day milestone.

Never present pipeline as customers or historical proof as current availability.

#### 9. Vision and ask

**Vision:** `Every company and AI agent gets exactly the financial authority—and visibility—it needs.`

**Ask:** specific program/grant/raise, exact use, and next measurable milestone.

### Investor appendix

Add:

1. competitive matrix;
2. business model and unit economics after PER/RPC/storage costs;
3. security and privacy threat model;
4. compliance strategy;
5. detailed GTM and pipeline definitions;
6. team and founder-market fit;
7. roadmap and use of funds;
8. source page with dated links.

## 13. What to borrow from the reference decks

### CargoBill

Borrow the clear pain → before/after → traction structure. Do not copy its unsupported large-industry leap or treat qualified pipeline as customers.

### LocalPay

Borrow the visual product flow and customer quotes. Do not use stablecoin-holder count as Mercurii’s serviceable market or claim arbitrary market share.

### “Jackpot age / signal intelligence” deck

Borrow the cultural “what changed” slide and wedge visualization. Mercurii’s equivalent is the overlap of **stablecoin operations + programmable privacy + policy-controlled AI finance**.

### Colosseum advice

Use the same logic, adapted to Mercurii:

1. strongest verified proof;
2. industry shift;
3. urgent change;
4. defensible market;
5. unique insight/moat;
6. brief product;
7. user/usage proof;
8. distribution unlock;
9. big vision.

## 14. Claims to avoid

- “The first private stablecoin payroll.” Toku and Umbra already occupy that claim.
- “No competitors.” Demonstrably false.
- “All company activity is invisible.” Public boundary conditions exist.
- “Non-custodial means unregulated.” Too broad and legally unsafe.
- “AI pays autonomously from treasury.” Not the current safety model.
- “$85T TAM.” Raw onchain volume is not payment revenue or buyer spend.
- “Production ready.” The repo explicitly says otherwise.
- “Private forever.” Access, metadata, operational security, and infrastructure assumptions must be explained.

## 15. Research-backed slide sources

- [Allium — State of Stablecoins and Payments, September 2026](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026)
- [Visa — stablecoins in business payments, October 2026](https://investor.visa.com/news/news-details/2026/Visa-Data-Shows-Stablecoins-Gaining-Traction-in-Business-Payments/default.aspx)
- [Solana — Payments on Solana, September 2026](https://solana.com/news/payments-on-solana-september-2026-in-five-stories)
- [Solana — Privacy for financial applications](https://solana.com/docs/finance/privacy)
- [Circle — current USDC circulation and distribution](https://www.circle.com/usdc)
- [Request Finance — product and adoption](https://www.requestfinance.com/)
- [Request Finance — pricing](https://www.requestfinance.com/pricing)
- [Request Finance — private payments model](https://help.request.finance/en/articles/12958312-private-payments-overview)
- [Umbra — private Solana payroll](https://payroll.umbraprivacy.com/)
- [Toku — private payroll architecture and evidence](https://www.toku.com/resources/how-toku-runs-fully-private-stablecoin-payroll-on-aleo-and-usad)
- [Squads — treasury management and security](https://docs.squads.so/main/basics/security)
- [Utila — enterprise wallet policy](https://utila.io/)
- [Rise — payroll pricing](https://www.riseworks.io/pricing)
- [Ramp — finance for agents](https://agents.ramp.com/)
- [MagicBlock — private SPL transfer API](https://docs.magicblock.gg/api-reference/per-api/transferAmount)
- [Utopia Labs — product wind-down](https://utopia.beehiiv.com/p/winding-down)

## 16. Inputs still needed before final deck copy

The research can define the category, but three founder inputs determine the final deck:

1. **Audience and exact ask:** Colosseum submission, accelerator, grant, or investor raise?
2. **Commercial proof:** real users, interviews, LOIs, waitlist, repeated payment volume, revenue, and retention—if any.
3. **First wedge choice:** agencies/product studios, onchain startups, or staffing/payroll firms.

Without these, the deck should remain honest and proof-led rather than manufacturing traction or TAM.
