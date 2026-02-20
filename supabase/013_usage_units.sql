-- Catálogo dinámico de unidades de uso por organización.

create table if not exists public.usage_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (char_length(trim(name)) > 0)
);

create unique index if not exists usage_units_org_name_uidx
  on public.usage_units (organization_id, lower(name));

create index if not exists usage_units_org_active_idx
  on public.usage_units (organization_id, is_active, created_at desc);

-- Backfill base: conserva unidades ya usadas en deadlines.
insert into public.usage_units (organization_id, name, is_active)
select distinct d.organization_id, trim(d.frequency_unit::text), true
from public.deadlines d
where nullif(trim(d.frequency_unit::text), '') is not null
  and not exists (
    select 1
    from public.usage_units u
    where u.organization_id = d.organization_id
      and lower(u.name) = lower(trim(d.frequency_unit::text))
  )
on conflict (organization_id, lower(name)) do nothing;

-- Backfill defaults para organizaciones sin esas unidades.
with default_units(name) as (
  values ('hours'), ('kilometers'), ('days'), ('cycles')
)
insert into public.usage_units (organization_id, name, is_active)
select o.id, du.name, true
from public.organizations o
cross join default_units du
where not exists (
  select 1
  from public.usage_units u
  where u.organization_id = o.id
    and lower(u.name) = lower(du.name)
)
on conflict (organization_id, lower(name)) do nothing;
