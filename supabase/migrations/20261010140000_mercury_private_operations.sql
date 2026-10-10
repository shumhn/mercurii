-- Mercury durable private-operations store.
--
-- Confidential business data never goes in plaintext columns.  The backend
-- encrypts each payload before it reaches these tables and binds it to its
-- company, record domain, and opaque record ID with AES-GCM additional data.

create table if not exists public.mercury_companies (
  company_id text primary key,
  founder_wallet text not null,
  policy_address text not null,
  mint_address text not null,
  per_validator text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_id ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (founder_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (policy_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

create table if not exists public.mercury_private_records (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  domain text not null,
  record_id text not null,
  envelope jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercury_private_records_domain_check check (domain ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  constraint mercury_private_records_record_id_check check (record_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  constraint mercury_private_records_envelope_check check (
    envelope ? 'iv' and envelope ? 'tag' and envelope ? 'ciphertext'
  ),
  unique (company_id, domain, record_id)
);

create index if not exists mercury_private_records_company_domain_updated_idx
  on public.mercury_private_records (company_id, domain, updated_at desc);

create table if not exists public.mercury_private_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  event_id text not null,
  event_type text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  constraint mercury_private_audit_events_event_id_check check (event_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  constraint mercury_private_audit_events_event_type_check check (event_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  constraint mercury_private_audit_events_envelope_check check (
    envelope ? 'iv' and envelope ? 'tag' and envelope ? 'ciphertext'
  ),
  unique (company_id, event_id)
);

create index if not exists mercury_private_audit_events_company_created_idx
  on public.mercury_private_audit_events (company_id, created_at desc);

-- Founder emergency recovery data is a separately encrypted checkpoint.  It is
-- intentionally opaque to Postgres and does not authorize a direct PER commit.
create table if not exists public.mercury_recovery_checkpoints (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  checkpoint_id text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  constraint mercury_recovery_checkpoints_checkpoint_id_check check (checkpoint_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  constraint mercury_recovery_checkpoints_envelope_check check (
    envelope ? 'iv' and envelope ? 'tag' and envelope ? 'ciphertext'
  ),
  unique (company_id, checkpoint_id)
);

-- Nothing is readable through the Data API by default.  Mercury's backend uses
-- a server-only Supabase secret after wallet/TEE authorization succeeds.
alter table public.mercury_companies enable row level security;
alter table public.mercury_private_records enable row level security;
alter table public.mercury_private_audit_events enable row level security;
alter table public.mercury_recovery_checkpoints enable row level security;

revoke all on public.mercury_companies from anon, authenticated;
revoke all on public.mercury_private_records from anon, authenticated;
revoke all on public.mercury_private_audit_events from anon, authenticated;
revoke all on public.mercury_recovery_checkpoints from anon, authenticated;

comment on table public.mercury_private_records is
  'Encrypted Mercury business records. No balance, recipient, amount, payroll roster, invoice, or audit plaintext belongs in metadata.';
