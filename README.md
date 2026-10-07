# Mercury backend and smart contract

Mercury is private USDC operations for onchain teams: a company treasury, payment approvals, and bounded agent spending. This repo is a **devnet implementation in progress**. It is not ready for real funds.

## Current contract

The Anchor program in `programs/mercury/src/lib.rs` has four PER state accounts:

| Account | Readers | Function |
| --- | --- | --- |
| CompanyPolicy | Founder, Finance | USDC mint, period budget, reserved/spent amount, treasury authority |
| PaymentRequest | Requester, Founder, Finance | Private recipient/amount; submit, approve, execute, reject |
| AgentPolicy | Agent, Founder, Finance until revoked | Separate token float authority, one approved recipient, per-payment and period caps |
| TreasurySnapshot | Founder, Finance | Manually synchronized private view of the canonical company token account balance and observation slot |

Each account starts as a non-confidential shell on Solana base, is delegated to the same TEE PER, receives an ER-local permission, and is made private **before confidential fields are written**. PER permissions control reads. The Mercury program separately checks signer and business policy. Founder/Finance/requester/agent pubkeys and account creation remain public in this prototype.

Finance approval reserves budget. `execute_payment` checks approved period, request status, recipient owner, mint, source authority, and available reserve. It then makes a PDA-signed SPL Token CPI and updates request/budget state in the same PER transaction. A failed CPI must revert the state update. The agent's `agent_pay` path requires its own signing key and spends only from a separate AgentPolicy-owned float with an allowlisted recipient and two caps. Founder can revoke the agent and remove its PER read membership; Finance can reclaim remaining float.

The token path has now been exercised end to end on the private devnet ER **with a locally minted six-decimal test token**. The company PDA received a private deposit through MagicBlock's hosted payment builder, Finance executed an approved payout through Mercury's PDA-signed SPL CPI, and a separate AgentPolicy-owned float was funded, spent, revoked, and reclaimed. This proves the architecture with that test mint and validator. Circle devnet USDC has **not** gone through the same live funding test yet. Do not use real funds.

For employee, contractor, and vendor payouts, the current Mercury program sends to a recipient token account already on the same PER. The recipient can read their own balance through the TEE and build a wallet-signed withdrawal through MagicBlock's Private Payments API. Both recipient operations were verified on devnet with the custom test mint; an outsider was denied the private balance. Circle devnet USDC withdrawal and a frontend wallet-login flow remain untested. Direct company-PDA-to-base payouts through the API remain unimplemented.

## Current backend

`backend/` is a local, noncustodial HTTP service. It has:

- `POST /v1/private-receive/build`: asks MagicBlock's Private Payments API for a **payer-signed, unsigned** `base → ephemeral` USDC transaction to the configured company address. It fixes visibility to `private` and rejects a builder response that omits the payer from required signers.
- `POST /v1/recipient-withdraw/build`: builds an **unsigned**, recipient wallet-signed withdrawal from the configured PER validator to that wallet's base token account. It rejects PDA owners, signer mismatches, and wrong-validator responses. It does not withdraw company PDA funds.
- `GET /v1/recipient-balance/:wallet`: reads that wallet's canonical token account on the TEE with the caller's TEE bearer token; the PER denies outsiders. It does not accept a company PDA as recipient.
- The receive builder also rejects a response routed to a PER validator other than the configured company validator.
- `POST /v1/operations/build`: builds unsigned Mercury company initialization, privacy setup, request, approval, budget, and agent transactions for the configured company. The caller signs and submits to the returned base or TEE endpoint. Private operations require a TEE bearer token. The backend holds no Founder, Finance, or Agent key. `initializeCompany` requires the configured Founder, Finance wallet, mint, and correctly derived company PDA.
- `GET /v1/transactions/:signature?chain=base|ephemeral`: reports chain confirmation or failure. `paymentSettled: null` means chain confirmation alone does not prove the full private transfer settled.
- `GET /v1/delegation/:address`: asks the MagicBlock router for delegation status and ER routing information.
- `GET /v1/treasury-snapshot`: reads the PER-private balance snapshot with a Founder/Finance TEE bearer token. Its `updatedSlot` is the last manual sync slot; the value can be stale after a transfer.
- `GET /v1/company-policy`, `GET /v1/payment-requests/:address`, `GET /v1/agent-policies/:address`: decode private PER accounts using the caller's TEE bearer token. MagicBlock ACL controls access; the backend also checks each request or agent policy belongs to the configured company.
- `GET /health`.

The backend never holds a company or agent spending key. It does not approve payments or report an unsigned/queued transfer as settled. The hosted builder response must be inspected by the payer wallet before signing. The backend binds to `127.0.0.1` by default and is not a public production API. Private operation arguments pass through this local backend in plaintext; a production client should construct those transactions locally and send them directly to the TEE.

```sh
cd backend
npm ci
MERCURY_COMPANY_ADDRESS=<company-policy-PDA> \
MERCURY_FOUNDER_ADDRESS=<founder-wallet> npm start
npm run typecheck
npm test
```

`MAGICBLOCK_CLUSTER` defaults to `devnet-private`, which the live hosted builder accepted. `MERCURY_COMPANY_ADDRESS` must be the actual Mercury policy PDA. Private receive, recipient withdrawal, and token-moving Mercury builders require `MERCURY_ENABLE_EXPERIMENTAL_RECEIVE=1`, `MERCURY_ENABLE_EXPERIMENTAL_WITHDRAW=1`, and `MERCURY_ENABLE_EXPERIMENTAL_TOKEN_CPIS=1` respectively. They remain off by default until the exact deployment mint and custody accounts are checked. Withdrawal uses `MERCURY_COMPANY_MINT` and pins the company TEE validator; verify this mint against the deployed policy before enabling. The receive route additionally requires that mint to equal Circle's devnet USDC mint. The current custom-mint proof company must not be used with the USDC receive route. These switches are for local devnet use.

## Build and devnet status

```sh
cargo check -p mercury
cargo fmt --all -- --check
cargo-build-sbf --skip-tools-install --tools-version v1.52
```

Host compilation and deployable SBF compilation pass. The devnet program is at `34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L` ([Solana Explorer](https://explorer.solana.com/address/34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L?cluster=devnet)). The latest upgrade added the private treasury snapshot; the prior upgrade tightened the policy limit invariant. Both were verified after deployment. The deployable binary is `deploy/mercury.so`; the generated IDL is `backend/idl/mercury.json`. Devnet keypairs are kept outside this directory. Build caches and `node_modules` are omitted; `npm ci` and `cargo-build-sbf` recreate them.

### Live private devnet proof

The test mint is `BHTANWG8igML3nxnHLcokhhzYt999W5LWjrtECFpNiv` and has no real value. The company policy is `EpyTeGaoxTJ6Anm1SxHFfyTkYaPdNDPHdgUvvGYXJzDB` on MagicBlock's TEE validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.

| Action | Live result |
| --- | --- |
| PER policy/request/agent permissions | Founder, Finance, requester, or Agent read as allowed; outsider denied |
| Private receive to off-curve company PDA | [Base transaction](https://explorer.solana.com/tx/4zDEGkcRmPDqWiW6xeaxHtCfh9GhbGNhgCkgzvgVmE7aCPVn678mv3V8UeYVvVB3X8Lrc15PvWzcbZEaLaZb84xq?cluster=devnet) confirmed; company credit proved by the following successful payout |
| Approved company payout | PER transaction `4VALGMLrgaALCVx58n4ApqkEEZEDQMRyFEWpUkeZaWVPp3VreLdagG3VpF2dnQJYy5zydi8uGYpD3WvFNAnuQqj9`; request became executed, reserved fell to 0, recipient grew from 1,000,000 to 2,000,000 microtokens |
| Agent float funding and bounded spend | PER transactions `5WQkkPopJ1g9MvTFmEKCtwWa9eXkziSpVi5XJtdNEYJjieiaaCr8UYHHcz9bhi1AWb9RqUkAQux5DCyidHF64V3X` and `revdrsojvMXVmEb51H5wLpjzBw99yZcEw6spXuwxvbbttRuedEQsCbkoCyiCcVwXbMVSr4U7wJ8dGSBf5XfUVpZ`; 0.25 token credited to allowed recipient |
| Limits and revocation | 0.500001 token agent attempt rejected; Founder revoked Agent and removed PER read access; Finance reclaimed remaining float |
| Treasury balance view | Finance synchronized private snapshot `8rwNrTaQqDt3aKdv2tEMornjXin4tjoDz9W5uFKF76xh`: 750001 microtokens at PER slot 463732812. Founder/Finance read it; outsider read was denied |
| Replay protection | Simulating `execute_payment` again for the executed request returned `WrongStatus`; recipient balance stayed unchanged |
| Recipient withdrawal | Finance test recipient withdrew 1 custom-mint microtoken through the wallet-signed MagicBlock `/withdraw` builder. [Base transaction](https://explorer.solana.com/tx/2DGBsPvm6Q7pbWFqsdKxiWfNvNsiqYVhWKMB9Snf8VRFoiwQ2mffVvwQLqZ1ns1XWmF4Pyy85zG4zD5qLa6MXQzM?cluster=devnet); private balance 2250000 → 2249999 and base balance 0 → 1 |
| Recipient balance access | Finance test recipient read 2249999 microtokens using its TEE token; outsider token was denied |

`backend/scripts/verify-devnet-proof.ts` independently reads the private TEE state with the Finance test key and checks executed request, budget, revoked Agent, recipient private/base balances, treasury snapshot, and the backend's private account decoders. Run `MERCURY_FINANCE_KEYPAIR=<local-test-keypair> npm run devnet:verify` from `backend/`; `npm run devnet:replay` uses the same key to simulate a duplicate payout and check the balance. `npm run devnet:recipient-balance` also needs an outsider test keypair. `npm run devnet:recipient-withdraw` is a **one-shot proof** that moves exactly one test microtoken; it refuses to run after the recorded balance change. The policy lifecycle script is `npm run devnet:policy` with test keypair environment variables; see the script for required names. Do not commit those keypairs.

The hosted Private Payments API's private-balance endpoint authenticates the destination wallet itself. A PDA cannot produce that wallet login signature. Mercury uses its own PER-private `TreasurySnapshot`: Finance reads the canonical company token account and writes its balance/slot to an ACL-protected account. This is a manual observation, not automatic settlement reconciliation; transfers after its `updatedSlot` are absent until another sync. Base-side funding transactions still reveal their payer and may reveal amount/timing. This prototype does not promise full anonymity.

## Remaining gates before calling this a working app

1. Create a fresh USDC company policy: the existing proof company is permanently configured for the custom test mint. The devnet test payer currently has no Circle devnet USDC token account, so fund a test payer with USDC before repeating the flow. Then verify an independently observed deposit, company payout, recipient private-balance read, and withdrawal. Build the frontend wallet-login flow. The official [Circle faucet](https://faucet.circle.com/) can supply test USDC to a test wallet.
2. Automate company and recipient eSPL token-account onboarding on the selected PER. The current proof used setup scripts and a pre-onboarded recipient; the backend now builds `initializeCompany` but does not yet perform the whole account setup sequence.
3. Add an app-level payment record and automatic reconciliation for PDA custody so a submitted transaction is not displayed as a completed payment before recipient credit is verified. The current treasury snapshot is manual and can be stale.
4. Add a recipient/amount allowlist for human payments, approval thresholds, and broader negative tests around every payout route. This devnet proof tested one Finance approval, duplicate execution rejection, a per-payment agent cap, and revocation.
5. Build the invoice Suggest worker if the demo must show a real AI agent. The contract currently proves only bounded Execute mode from a separate float.
6. Finish role rotation, request/agent account close and rent recovery, durable recovery, Co-sign mode, and external security review before production use. Resolve dependency advisories before public deployment; the current Anchor JavaScript dependency pulls a vulnerable `toml` package without an available upstream fix.

Product scope and the provisional payment design are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
