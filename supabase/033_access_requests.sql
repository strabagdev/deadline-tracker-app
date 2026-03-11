create table if not exists public.organization_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.profiles(user_id) on delete set null,
  organization_id uuid null references public.organizations(id) on delete set null,
  assigned_role text null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(email)) > 0),
  check (status in ('pending', 'approved', 'rejected')),
  check (assigned_role is null or assigned_role in ('owner', 'admin', 'member', 'viewer'))
);

create unique index if not exists organization_access_requests_user_pending_uidx
  on public.organization_access_requests (user_id)
  where status = 'pending';

create index if not exists organization_access_requests_status_requested_idx
  on public.organization_access_requests (status, requested_at desc);

create index if not exists organization_access_requests_email_requested_idx
  on public.organization_access_requests (lower(email), requested_at desc);

create or replace function public.set_updated_at_organization_access_requests()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_organization_access_requests on public.organization_access_requests;

create trigger trg_set_updated_at_organization_access_requests
before update on public.organization_access_requests
for each row execute function public.set_updated_at_organization_access_requests();
