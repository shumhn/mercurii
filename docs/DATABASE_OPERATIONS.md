# Mercury private operations database

Supabase stores encrypted operational records for each company. It is not an
authorization system: onchain `CompanyPolicy`, TeamGrant, PaymentRequest, and
AgentPolicy accounts remain the authority for money and permissions.

## Data ownership

Mercury has two deliberate data layers.

| Layer | Source of truth | Stored there |
| --- | --- | --- |
| Solana + MagicBlock PER | Onchain program state | Treasury funds, private payment execution, CompanyPolicy, TeamGrants, AgentPolicy, and private permission state. |
| Supabase | Encrypted application operations | Payment and payroll workflow records, payees, invoices, agent sessions, audit-share state, recovery checkpoints, operational membership cache, sync cursors, and notification delivery status. |

`mercury_company_members`, `mercury_operation_sync_cursors`, and
`mercury_notification_deliveries` are service-only application indexes. They
make the app responsive and recoverable, but never grant authority by
themselves. A server action always rechecks the relevant onchain policy or
grant before it can create, approve, or execute a payment.

Use `supabase/migrations/20261010160000_mercury_app_operations.sql` after the
private-record migrations. The tables intentionally contain only opaque IDs,
state, and routing fields. Member display names, branch labels, notification
bodies, and all financial values stay in encrypted private-record payloads.

## What is encrypted

Every private record is AES-256-GCM encrypted by the backend before it reaches
Postgres. The encryption additional data binds the ciphertext to its company,
domain, and opaque record ID. Balance, recipient, amount, payroll roster,
invoice, audit bundle, session data, and agent message never enter JSONB
metadata in plaintext.

The backend uses a server-only Supabase secret. Browser clients never receive
that secret. RLS is enabled and `anon`/`authenticated` have no table grants.

## Devnet operation

1. Apply `supabase/migrations/20261010140000_mercury_private_operations.sql`.
2. Keep `MERCURY_SUPABASE_URL`, `MERCURY_SUPABASE_SECRET_KEY`, and a private
   `MERCURY_SUPABASE_RECORDS_KEY_FILE` only in `backend/.env.local` or the
   deployment secret store.
3. Set `MERCURY_SUPABASE_PERSISTENCE=1` only after the company row exists.
4. Run `npm run supabase:check`, `npm run supabase:checkpoint`, and
   `npm run supabase:verify` from `backend/`.
5. Run `npm run supabase:coverage` to prove that every local operational row
   for the configured company has a corresponding encrypted `operation.*`
   record in Postgres.

## Database cutover

The legacy journals are a development migration source, not the deployment
architecture. Production Mercury must use encrypted Postgres records for every
workflow state that can affect an operation. The first cutover domain is
`operation.payment`: it supports idempotent creation, optimistic concurrency
for every state transition, reconciliation, and encrypted record reads.

`MERCURY_PAYMENT_STATE_STORE=supabase`, `MERCURY_PAYEE_STORE=supabase`,
`MERCURY_PAYMENT_FLOW_STORE=supabase`, `MERCURY_ONBOARDING_RECEIPT_STORE=supabase`,
`MERCURY_PAYROLL_RUN_STORE=supabase`, `MERCURY_PAYROLL_SCHEDULE_STORE=supabase`,
`MERCURY_INVOICE_STORE=supabase`, and `MERCURY_AGENT_RECORD_STORE=supabase`
enable the devnet MVP repositories.

The HTTP routes await the database write before returning success for payment
state, payees, guided payment flows, onboarding receipts, payroll runs and
schedules, invoice idempotency, and agent sessions/audit records. On boot,
onboarding receipts and payroll schedules hydrate an in-process read cache so
existing synchronous program inspectors continue to work after a restart; the
encrypted database records are the recovery source for that cache.

`MERCURY_SUPABASE_PERSISTENCE=1` additionally mirrors every recognized legacy
journal as encrypted recovery snapshots during the migration. This includes
payments, payment flows, payees, payroll runs/schedules, invoices, onboarding
receipts, agent sessions, audit shares, and x402 purchases. These mirrors are
not permission authority and never contain plaintext financial data.

Audit-share and x402-purchase journals still use the local implementation in
the devnet MVP. They are not required to create, approve, execute, recover, or
reconcile company treasury payments. Their encrypted mirrors and recovery
checkpoints are available while their dedicated asynchronous repositories are
added before any production deployment.

## Founder recovery checkpoint

`npm run supabase:recovery-checkpoint` stores a separately encrypted,
point-in-time copy of all company journals. To reconstruct it without replacing
live state, set `MERCURY_RECOVERY_CHECKPOINT_ID` and run
`npm run supabase:recovery-restore`. It writes private files beneath
`backend/.state/recovery-restores/` and refuses any other output location.

Before any real treasury migration: freeze company operations, validate the
restored journals against onchain state, migrate treasury funds, sanitize
private state, then commit and undelegate the legacy PER state. A checkpoint
is evidence for recovery; it does not authorize payments or an automatic PER
commit.
