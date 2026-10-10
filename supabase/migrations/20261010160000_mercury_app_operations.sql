-- Mercury app-level operational indexes.
-- Onchain/MagicBlock remains authoritative for treasury funds, policies,
-- grants and payment execution. These tables hold service-only app routing,
-- membership lookup, synchronization and notification delivery state. Any
-- private display name, branch detail, message body, or business note belongs
-- in an encrypted mercury_private_records payload referenced by opaque IDs.

create table if not exists public.mercury_company_members (
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  wallet_address text not null,
  grant_address text not null,
  role_cache text not null check (role_cache in ('founder', 'finance', 'manager', 'requester', 'viewer', 'agent')),
  membership_state text not null default 'active' check (membership_state in ('invited', 'active', 'revoked')),
  private_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, wallet_address, grant_address),
  check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (grant_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (private_record_id is null or private_record_id ~ '^[A-Za-z0-9_.:-]{1,160}$')
);

create table if not exists public.mercury_operation_sync_cursors (
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  stream text not null check (stream in ('base-chain', 'per-state', 'payment-reconciliation', 'notifications')),
  cursor_value text,
  observed_slot bigint,
  state text not null default 'idle' check (state in ('idle', 'running', 'degraded', 'blocked')),
  private_record_id text,
  updated_at timestamptz not null default now(),
  primary key (company_id, stream),
  check (private_record_id is null or private_record_id ~ '^[A-Za-z0-9_.:-]{1,160}$')
);

create table if not exists public.mercury_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.mercury_companies(company_id) on delete cascade,
  wallet_address text not null,
  event_key text not null,
  channel text not null check (channel in ('in_app', 'email', 'webhook')),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'suppressed')),
  private_record_id text not null,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, wallet_address, event_key, channel),
  check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  check (event_key ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  check (private_record_id ~ '^[A-Za-z0-9_.:-]{1,160}$')
);

create index if not exists mercury_company_members_company_state_idx
  on public.mercury_company_members (company_id, membership_state, role_cache);
create index if not exists mercury_notification_deliveries_pending_idx
  on public.mercury_notification_deliveries (company_id, status, available_at);

alter table public.mercury_company_members enable row level security;
alter table public.mercury_operation_sync_cursors enable row level security;
alter table public.mercury_notification_deliveries enable row level security;
revoke all on public.mercury_company_members from anon, authenticated;
revoke all on public.mercury_operation_sync_cursors from anon, authenticated;
revoke all on public.mercury_notification_deliveries from anon, authenticated;

comment on table public.mercury_company_members is
  'Service-only member lookup cache. Onchain TeamGrant and CompanyPolicy remain authoritative.';
comment on table public.mercury_operation_sync_cursors is
  'Service-only reconciliation cursor state; private detail is encrypted in mercury_private_records.';
comment on table public.mercury_notification_deliveries is
  'Service-only notification delivery index; notification contents are encrypted private records.';
