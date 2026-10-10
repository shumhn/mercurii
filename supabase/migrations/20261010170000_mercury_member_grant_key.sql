-- A member can hold more than one scoped grant. Keep each grant as a distinct
-- cache row; the TeamGrant account remains the authorization source of truth.
alter table public.mercury_company_members
  alter column grant_address set not null;

alter table public.mercury_company_members
  drop constraint if exists mercury_company_members_pkey;

alter table public.mercury_company_members
  add primary key (company_id, wallet_address, grant_address);
