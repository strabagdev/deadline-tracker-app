create table if not exists public.organization_invite_email_cooldowns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  cooldown_until timestamptz not null,
  last_error text null,
  last_requested_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(email)) > 0)
);

create unique index if not exists organization_invite_email_cooldowns_org_email_uidx
  on public.organization_invite_email_cooldowns (organization_id, email);

create index if not exists organization_invite_email_cooldowns_org_until_idx
  on public.organization_invite_email_cooldowns (organization_id, cooldown_until desc);

create or replace function public.set_updated_at_organization_invite_email_cooldowns()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_organization_invite_email_cooldowns on public.organization_invite_email_cooldowns;

create trigger trg_set_updated_at_organization_invite_email_cooldowns
before update on public.organization_invite_email_cooldowns
for each row execute function public.set_updated_at_organization_invite_email_cooldowns();
