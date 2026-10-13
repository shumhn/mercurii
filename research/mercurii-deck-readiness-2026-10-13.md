# Mercurii deck readiness — 13 October 2026

## Design brief

- **Direction:** Clean White, adapted to Mercurii's actual off-white canvas and cobalt accent; one ink slide for agent policy, one cobalt vision slide.
- **Density:** Spacious. Ten main slides, two appendix slides, one assertion per slide.
- **Surface:** Flat paper, thin rules and a few restrained evidence cards. No gradients, stock photos, fictitious growth charts or fabricated product screenshots.
- **Type:** Switzer from the Mercurii frontend, large geometric headlines and plain-spoken supporting text.
- **Motion:** Manual slide advance; no autoplay. Presenter notes are toggled with `N`.
- **Do:** Source every market figure, label technical proof precisely, mark proposed buyer/distribution claims as hypotheses, show the privacy boundary.
- **Don't:** Call broad payment volume TAM, imply devnet transactions are customers, suggest total anonymity, claim an agent can spend treasury funds without human approval, or copy a reference deck's claims.

The ten-slide main deck follows the user's Colosseum narrative arc: credibility → industry shift → problem → beachhead/market → insight → product → governed agents → proof → distribution → vision. The two appendix slides cover competition and the open evidence ledger. The CargoBill/LocalPay screenshots informed the pain, specific buyer and concrete flow; Katha informed large type and concise pacing; none of their numbers or assets were reused as Mercurii evidence.

## Claim register

| Deck claim | Class | Evidence / limitation |
| --- | --- | --- |
| $137–153B B2B stablecoin settlement; $56B service fees; $43B payroll; $28B suppliers, Jan–Aug 2026 | Third-party estimate | [Allium September 2026](https://www.allium.so/reports/state-of-stablecoins-and-payments-september-2026). Multi-chain payment flows, not buyer count, TAM or Mercurii volume. |
| Public wallet activity may reveal payees, cadence and operating patterns | Mechanism/problem | [Solana privacy docs](https://solana.com/docs/finance/privacy) set explicit limits of public versus private information. The sample ledger is labeled illustrative. |
| Devnet receive executed | Technical proof | Solana devnet transaction `4buRhdSDesBWr4Y9J8bYoX2Ryzgwd9AWDqPaqHkzELJNaFEFFhHTcC7oFaWV1vDXgXTAMaiipVhQXGx3B5TMvfDo` was rechecked successful via RPC on 13 Oct 2026. |
| MagicBlock PER private approval executed | Technical proof | PER transaction `5FG99DybKnmRMrXGqW7Mbwz4mVBQFkwEPWMbd7YTpiP5TXJf5UvNcCnMAMLgMsKtjk84XyuPQbw3cinSMGSxFLwV` was rechecked successful via RPC on 13 Oct 2026; see [local proof catalog](../docs/magicblock-per-proof-catalog.md). |
| Integrated current browser demo | Not yet proven | [12 Oct full-stack audit](../docs/FULL_STACK_FUNCTIONALITY_MATRIX.md) flags private receive, payment execution, finance agent, x402 and recipient withdraw capabilities off; wallet-signed role replay also needs recheck. |
| First buyer is a USDC-operating agency/studio/onchain team | Hypothesis | No interview count, qualified-account count or willingness-to-pay study yet. |
| Real users, pilots, revenue or paid volume | None claimed | User confirmed none yet. |
| Company/agent policy is a differentiated workflow | Product thesis | Existing [Request Finance](https://www.requestfinance.com/), [Umbra Payroll](https://payroll.umbraprivacy.com/), [Ramp for Agents](https://agents.ramp.com/) and [MagicBlock sample code](https://github.com/magicblock-labs/starter-kits/blob/main/private-payments-demo/README.md) overlap. Differentiation is not yet a proved moat. |

## Colosseum readiness scorecard (draft, not a certification)

| Dimension | Score | Why / next action |
| --- | ---: | --- |
| Innovation | 7/10 | Private operating state plus company/agent authority is an interesting integration; sharpen difference against Request and Umbra through buyer testing. |
| Technical execution | 5/10 | Specific devnet receipts exist, but show a new complete signer-driven demo and resolve disabled capabilities. |
| Completeness | 4/10 | The 12 Oct audit says the full money/agent browser path is not currently demonstrable end to end. |
| Crypto necessity | 7/10 | Noncustodial USDC settlement, program-enforced permissions and private execution make Solana/MagicBlock substantive; show limits and trust model. |
| Presentation | 7/10 | Concise sourced story and brand-specific visual direction; team biography, real product recording and final ask are missing. |

## Hard questions — two-sentence response frames

**“Where are the users or revenue?”** None yet, and the deck says so. We have technical execution receipts; the next proof is a repeatable browser flow and real USDC-operating design partners whose repeat use and willingness to pay we measure separately.

**“Is this just Request Finance with privacy?”** Request is the strongest commercial benchmark and already offers a broad finance suite, so we should not dismiss it. Mercurii is testing whether confidential operating state with role-scoped authority and noncustodial Solana execution matters enough for a narrower USDC-first customer to switch or choose us.

**“Doesn't Umbra already do private payroll?”** It does, and it is directly relevant competition. Our proposed scope is the whole operating cycle—receive, request, approve, pay, reconcile and govern people/agents—not payroll alone; the integrated workflow must be demonstrated rather than asserted.

**“What exactly is private?”** Authorized participants can see private operating state according to their role; public observers should not get the internal balance, request and payout picture from the private execution path. Public deposits/withdrawals, account shells, timing and network metadata can still leak information, so we do not promise anonymity.

**“Can an AI agent move company funds?”** The intended design lets agents read only authorized information and draft unsigned treasury work that a human signs. A separate capped wallet can support bounded x402 spending, and the current agent runtime is not being represented as live production behavior.

**“Why a blockchain instead of a private database?”** USDC settlement and noncustodial authorization are part of the product: a business and its recipients can move value without handing treasury custody to the app. The private execution layer also lets the team keep selected state confidential while using Solana as the settlement rail; the exact trust and audit boundary is part of product diligence.

**“What's the TAM and business model?”** The Allium numbers describe a real payment category, not our addressable revenue. We need a count of qualified USDC-operating teams, a reachable acquisition channel and paid pricing tests before putting a revenue TAM or ARR projection on a slide.

**“Why no token?”** The current user problem is private business finance operations, not token distribution. A token is not necessary to validate this workflow, so the pitch does not invent one.

**“Why will this still matter in a crypto downturn?”** The first customer is selected by recurring company payments, not speculative trading activity. We still need to measure retention and recurring payout volume across market conditions before claiming resilience.

## Mandatory gates before a final public submission

1. Record and verify a fresh Founder → Finance → recipient wallet-signed browser flow with receipt links.
2. Add the real founder/team names, roles and credible domain credentials; do not use filler biographies.
3. Get customer interviews/design partners and test the actual pricing/budget owner; only then make a bottom-up TAM.
4. Finalize the exact Colosseum ask and ensure the deck + separate technical demo fit the event's time limit.
5. Replace any older screenshots/landing illustrations with current product capture only when the flow is demonstrably working.
