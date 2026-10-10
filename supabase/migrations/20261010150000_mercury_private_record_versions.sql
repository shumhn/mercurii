-- Optimistic concurrency for encrypted operational records.
-- Version is non-confidential metadata only; ciphertext remains application-encrypted.
alter table public.mercury_private_records
  add column if not exists record_version bigint not null default 1
  check (record_version >= 1);

create index if not exists mercury_private_records_company_domain_record_version_idx
  on public.mercury_private_records (company_id, domain, record_id, record_version);
