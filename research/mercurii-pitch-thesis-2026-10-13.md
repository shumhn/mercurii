# Mercurii pitch thesis — research reset

**Prepared:** 13 October 2026
**Intended first audience:** Colosseum judges / accelerator reviewers
**Status:** Research and narrative brief. This is not a claim that a final deck or live demo is ready.

## The central story

**Mercurii — Private Financial Operations for Onchain Stablecoin Businesses.**

The memorable explanation is: **stablecoins let a company move money globally, but a linked public wallet exposes the company's operating finances. Mercurii gives the company a private, permissioned way to receive USDC, approve spending, pay people and vendors, and keep records.**

The first customer is a crypto-native agency, product studio, or small onchain team already receiving USDC and repeatedly paying remote contractors or vendors. This customer already understands stablecoins, feels the wallet-exposure problem, and has a founder or finance lead making payments manually. This is a proposed beachhead, not a measured customer count.

The key product insight is that **payment privacy alone does not protect the operating company**. The company also needs confidential balances, requests, approvals, payees, payroll records, scoped employee access, and bounded agent access. The product should be pitched as a finance operating account with a privacy and policy layer, rather than as a generic wallet, mixer, payroll app, or AI agent.

## What the 19 screenshot references teach us

The user provided **17 CargoBill/LocalPay screenshots and 2 additional market/positioning screenshots**. They are storytelling references, not evidence of Mercurii usage. The separate Katha HTML file is a **nine-slide, two-minute** pitch.

| Reference | Worth adopting | Important correction for Mercurii |
| --- | --- | --- |
| CargoBill | Specific industry pain, before/after comparison, buyer definition, and simple growth/volume presentation | The screenshots assert figures such as a $10T logistics industry, $200B fees, 78% MoM growth, $276K TPV, and $1B pipeline without sufficient visible definitions or source context. We must not copy that style of claim. |
| LocalPay | A concrete three-step product flow, real interface, real-world use case, team, and user feedback | “160M holders” is not an addressable buyer count; “0.1% share = $20M ARR” requires a disclosed spend/take-rate model; 40% weekly growth needs dates and absolute users. |
| Dark market/positioning slides | A bold, memorable market insight and a narrow wedge at an intersection | The “jackpot age” thesis and conceptual curves need buyer evidence. A clever graphic cannot substitute for demand or a defined market. |
| Katha HTML | One assertion per slide, very large type, source labels, timed speaker notes, a wide-to-narrow arc, and a strong closing image | Its $60B art figure is category context, not a Thangka revenue TAM. Devnet proof is asserted without a direct receipt on the slide, commercial traction is absent, and its ask appears only in presenter notes. An earlier broad “9/10” rating should not be treated as an evidence score. |
| User-supplied Vibhu/Colosseum advice | Lead with strongest credibility, then industry shift, urgency, market, insight, brief product, proof, distribution, vision | These are **nine narrative beats**, not a rule requiring nine or nineteen slides. Official Colosseum guidance emphasizes a pitch under three minutes, user validation, team, market, working demo, and a separate technical walkthrough. |

## Evidence that can survive a skeptical judge

| Claim | Evidence and scope | How to use it |
| --- | --- | --- |
| Companies are using stablecoins for operations | [Allium's September 2026 report](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026) estimates $401B–$527B in stablecoin payments during Jan–Aug 2026; B2B was $137B–$153B; service fees $56B, payroll $43B, suppliers $28B. | Show the business-payment shift. These are payment flows across chains, **not Mercurii TAM or revenue**. |
| The B2B lane was already meaningful before 2026 | [Artemis's 2025 primary survey](https://reports.artemisanalytics.com/stablecoins/artemis-stablecoin-payments-from-the-ground-up-2025.pdf) identified B2B as the largest sampled payment lane, annualizing at $76B in August 2025. | Independent directional corroboration. Its sample and methodology differ from Allium's, so do not combine the two into one growth rate. |
| Stablecoin business tools have paying buyers | [Request Finance](https://www.requestfinance.com/) says 1,500+ finance teams and $1B+ processed, and offers accounts, AP, approvals, payroll and accounting. | Category validation and strongest commercial benchmark. Its figures are company-reported. |
| Privacy is a recognized business requirement | [Solana's finance privacy documentation](https://solana.com/docs/finance/privacy) distinguishes confidential balances, private execution and selective audit/access. | Why this is a real infrastructure category; also a reminder to state exactly what stays public. |
| Private payroll exists already | [Umbra Payroll](https://payroll.umbraprivacy.com/) offers private salaries, company balance, recipient access, and cash-out. | Honest competitor; Mercurii must prove a wider operating workflow, not say it invented private payroll. |
| Current devnet technical work exists | [Mercurii proof catalog](../docs/magicblock-per-proof-catalog.md) and [devnet MVP checklist](../docs/DEVNET_MVP_CHECKLIST.md). On 13 October 2026, Solana devnet RPC returned a successful receive transaction at slot 509616993 and MagicBlock PER RPC returned a successful approval transaction at slot 489973132. | Technical execution proof. Show exact receipt links and a short walkthrough; never relabel test transactions as customer traction. |
| Current end-to-end demo is still a gate | [Full-stack audit](../docs/FULL_STACK_FUNCTIONALITY_MATRIX.md) dated 12 October 2026 says five money/agent runtime capability flags were false, and signed browser roles were not replayed. | Before submission, enable and record a current signer-driven demo. Historical receipts and today's live product status are separate claims. |

The live landing page at [trymercurii.xyz](https://www.trymercurii.xyz/) matches the chosen positioning and visual identity. Its invoice amount, masked balance, and global payment map are **illustrative UI**, not customer volume, signed payouts, or traction. The footer itself says devnet, test funds, and not audited.

## The defensible wedge and its limits

Mercurii's proposed wedge is **private operating state plus program-enforced company authority**, covering revenue, requests, approvals, payroll/vendor payouts, record access, and humans/agents under one policy. [MagicBlock's PER payment example](https://github.com/magicblock-labs/starter-kits/blob/main/private-payments-demo/README.md) supports private account access and transfers, but its primitives are available to other builders. The durable business advantage would have to come from a trusted, usable workflow, security proof, integrations, and distribution.

[Request Private Payments](https://help.request.finance/en/articles/12958312-private-payments-overview) uses partner custodial wallets, unrelated sending addresses, and release timing to obscure payment links. It is a serious, already distributed alternative. Umbra overlaps on private payroll. Squads/Utila overlap on treasury policy. [Ramp for Agents](https://agents.ramp.com/) already provides agent identity, budget, approvers, restrictions, and x402 payments. Therefore, “private payments,” “roles,” or “agent wallet” alone cannot be claimed as unique.

The truthful privacy boundary is **confidential operations for authorized company participants**. Public deposits/withdrawals, account shells, and timing or other network metadata may remain visible. Do not claim total anonymity or “zero information leakage.”

## Market opportunity: what is missing

The external volume above proves that operational stablecoin payments are growing. It does not establish how many buyers fit Mercurii's first use case or what they will pay. A defensible bottom-up market slide needs:

1. A count of qualified agencies/onchain teams that already receive USDC and make recurring payouts, with named list-building sources.
2. Interviews confirming wallet visibility, approval pain, budget owner, and buying urgency.
3. Pricing tests or paid pilot commitments to estimate annual contract value.
4. A clear conversion assumption from reachable accounts to paying customers.

Until then, label the TAM calculation as **under validation**. Competitor pricing can inform a hypothesis, but no $99/$299/$599 Mercurii price should be shown as a fact or commitment.

## Colosseum narrative: nine beats, roughly nine slides

1. **Opening credibility:** the chosen one-liner and an exact, linked historical devnet proof. Current demo status must be explicit.
2. **Industry shift:** business stablecoin payment activity, led by the Allium B2B figure.
3. **Urgent problem:** a linked company wallet exposes balances, payroll patterns, payees and operating rhythm; internal access is blunt.
4. **Market and beachhead:** name the first buyer, the repeated workflow, and the measurable payment category; avoid claiming the entire volume as TAM.
5. **Unique insight:** the company's financial operating state needs privacy and role-specific authority, not merely an obfuscated transfer.
6. **Brief product:** one real founder-to-finance-to-recipient flow with an actual app screen and privacy boundary.
7. **Proof and validation:** current signer-driven demo, receipts, customer interviews/pilots if real; clearly distinguish each evidence type.
8. **Distribution:** a specific first-channel and design-partner pipeline with actual counts only when verified.
9. **Vision and ask:** the private operating account for onchain businesses; a specific Colosseum or partner outcome rather than a vague closing line.

For Colosseum, the pitch video should stay under three minutes, with a **separate technical demo** that explains Solana/MagicBlock implementation. This follows [Colosseum's submission workshop](https://blog.colosseum.com/perfecting-your-hackathon-submission/) and [Colosseum's builder guide](https://blog.colosseum.com/how-to-win-a-colosseum-hackathon/). A longer investor appendix can hold competitors, architecture, market methodology, pricing tests and security assumptions. The 19 screenshots are the reference set; they are not a slide-count requirement.

## Highest-priority research gaps before final deck claims

- Current repeatable browser demo with Founder, Finance and recipient wallets, plus matching proof links.
- Commercial signal: customer interviews, pilot names/LOIs, actual users, retention, paid volume or revenue.
- Founder's direct reason for building this and team credentials, as stated by the founders.
- Bottom-up qualified-buyer count and willingness-to-pay evidence.
- Exact submission audience and final ask; Colosseum pitch, accelerator application and investor raise should not share an unmodified ask.
