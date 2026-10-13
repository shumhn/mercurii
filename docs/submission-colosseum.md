# Colosseum submission — Mercurii answers

## Q1: What are you building, and who is it for? (998 chars)

Mercurii is a private operating account for companies that run on stablecoins: receive revenue, hold a treasury, approve payroll and vendor invoices, and give humans or AI agents scoped spending access - without publishing balances, salaries, and counterparties on a public ledger.

Built for teams living this pain: crypto agencies, product studios, and onchain startups that receive stablecoins and pay remote contractors and vendors. Today finance runs on a founder's hot wallet and a block explorer - anyone who finds the address sees every salary and supplier.

Under the hood: an Anchor program on Solana holds funds, MagicBlock's Private Ephemeral Rollup (TEE) keeps company state confidential, and every action is a wallet-signed transaction with an on-chain receipt. Roles - Founder, Finance, Manager, Requester, Viewer, Agent - are enforced by the program, not app code. AI agents get hard on-chain caps and recipient allowlists; an invoice assistant drafts payments but never signs them.

## Q2: Why did you decide to build this, and why build it now? (992 chars)

Stablecoins quietly became how internet businesses actually move money: cross-border payroll, contractor payouts, treasury. But the default stack is a shared wallet on a public ledger - one address leak exposes who you pay, how much, and when. And as AI agents start spending on behalf of companies, handing an agent the master key is reckless.

I kept winning hackathons building private payments on MagicBlock (4 wins, plus 2nd place in the Frontier privacy side track), and the same gap kept showing up: privacy demos end at transfers, while real companies need roles, approvals, limits, and audit. Nobody shipped the operating layer.

Now is the moment because the pieces just became real: Solana offers cheap stablecoin settlement, MagicBlock's TEE makes confidential state production-grade, and onchain teams are hiring globally in stablecoins today. Mercurii combines them: a company account that is private by default, signed by design, and safe to delegate - to people and to agents.
