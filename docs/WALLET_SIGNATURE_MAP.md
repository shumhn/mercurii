# Wallet signature map

This map separates wallet prompts from transactions. One transaction may contain several ordered
instructions while still requiring one wallet approval. Solana base-layer instructions and MagicBlock
PER instructions cannot share a transaction, and actions owned by different wallets stay separate.

## Current interactive approvals

| Flow | Wallet approvals | What is grouped |
| --- | ---: | --- |
| Private login | 1 message signature per session | Authentication only; no transaction fee. |
| New company and private workspace | 2 transaction signatures | Base: create company, delegate company, create balance tracker, delegate tracker. PER: create both permissions and turn on privacy. |
| Optional spending policy change | 1 | Company and AI-agent caps. |
| Finance, Manager, Requester, or Viewer access | 2 for a fresh grant | Base: create and delegate the grant. PER: create permission, protect readers, and activate role rules. |
| AI-agent policy | 2 for a fresh policy | Base: create and delegate policy. PER: create permission, protect readers, and activate caps/recipient. |
| Founder-created payment request | 2 before approval | Base: create and delegate request. PER: create permission, protect terms, and submit terms. |
| Team-member-created payment request | 4 before approval | Requester owns create, delegate, permission, and submit; Founder owns privacy activation, so only the two base instructions are grouped. |
| Payment approval | 1 | Budget reservation and role checks. Payroll groups up to 8 approvals in one transaction. |
| Founder payment execution | 1 | Transfer, request finalization, and treasury snapshot update are atomic in one PER transaction. |
| Finance payment execution | 1, plus snapshot sync when needed | Finance can execute; Founder currently owns the separate snapshot recovery path. |
| Private receive | 2 | Payer signs the deposit; Founder signs snapshot sync after the deposit is confirmed. |
| Recipient onboarding deposit | 1 | Private deposit. |
| Recipient withdrawal | 1 | Private withdrawal. |
| Agent fund, pay, reclaim, or revoke | 1 per action | Each money movement or revocation remains independently auditable. |
| Share a request with a Viewer | 1 per request | Replaces the private request reader set. |
| Revoke team access | 1 plus reader cleanup | Grant revocation is one approval; historical request/snapshot/agent reader cleanup is currently one approval per target. |
| Payroll schedule create/pause/resume/launch | 1 message signature per action | Authorization message only; no transaction fee. |
| x402 purchase | No interactive user prompt per purchase | The isolated, policy-limited service signer signs after the user-authorized workflow passes policy checks. |

## Remaining batching candidates

1. **Reader cleanup chunks.** Several request-reader resets signed by the Founder can share one PER
   transaction. The receipt journal must record every target against the same signature before this is safe.
2. **Payroll execution chunks.** Several approved payouts signed by the same Founder or Finance wallet can
   fit in one PER transaction. A failed payout would roll back the entire chunk, so chunking needs per-run
   failure and retry semantics.
3. **Approve and execute.** Founder or Finance could approve and execute one payment in one PER transaction.
   Keeping these separate preserves the current review boundary and payment-journal recovery model. A Manager
   approval cannot be combined with execution because Managers are not execution signers.

## Boundaries that should remain separate

- Base-layer and PER instructions use different RPCs.
- Steps signed by different wallets cannot become one single-signature transaction.
- Receive deposit and snapshot sync depend on confirmation from the Private Payments flow.
- Uncertain broadcasts reuse the original signed bytes; they do not create a replacement signature until the
  original transaction is reconciled or proven expired.
