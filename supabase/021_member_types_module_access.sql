-- Tipos de miembro por organización y visibilidad por módulo.

create table if not exists public.organization_member_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  check (char_length(trim(name)) > 0)
);

create unique index if not exists organization_member_types_org_name_uidx
  on public.organization_member_types (organization_id, lower(name));

create table if not exists public.organization_member_type_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_type_id uuid not null references public.organization_member_types(id) on delete cascade,
  module_key text not null,
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  check (char_length(trim(module_key)) > 0)
);

create unique index if not exists org_member_type_modules_type_module_uidx
  on public.organization_member_type_modules (member_type_id, lower(module_key));

alter table public.organization_members
  add column if not exists member_type_id uuid references public.organization_member_types(id) on delete set null;

create index if not exists organization_members_org_member_type_idx
  on public.organization_members (organization_id, member_type_id);

-- Backfill tipos sistema por organización.
with base_types(name, is_system) as (
  values ('owner', true), ('admin', true), ('member', true), ('viewer', true)
)
insert into public.organization_member_types (organization_id, name, is_system, is_active)
select o.id, bt.name, bt.is_system, true
from public.organizations o
cross join base_types bt
where not exists (
  select 1
  from public.organization_member_types t
  where t.organization_id = o.id
    and lower(t.name) = lower(bt.name)
);

-- Vincula memberships existentes al tipo equivalente por nombre.
update public.organization_members m
set member_type_id = t.id
from public.organization_member_types t
where m.organization_id = t.organization_id
  and lower(t.name) = lower(m.role)
  and m.member_type_id is null;

-- Catálogo de módulos a controlar.
with module_keys(module_key) as (
  values
    ('dashboard'),
    ('forecast'),
    ('alerts'),
    ('entities'),
    ('usage'),
    ('reports_usage'),
    ('semaphore'),
    ('entity_types'),
    ('deadline_types'),
    ('usage_units'),
    ('users')
)
insert into public.organization_member_type_modules (organization_id, member_type_id, module_key, can_view)
select t.organization_id, t.id, mk.module_key,
  case
    when lower(t.name) in ('owner', 'admin') then true
    when lower(t.name) = 'member' then mk.module_key in ('dashboard', 'forecast', 'alerts', 'entities', 'usage', 'reports_usage')
    when lower(t.name) = 'viewer' then mk.module_key in ('dashboard', 'forecast', 'alerts', 'reports_usage')
    else false
  end
from public.organization_member_types t
cross join module_keys mk
where not exists (
  select 1
  from public.organization_member_type_modules m
  where m.member_type_id = t.id
    and lower(m.module_key) = lower(mk.module_key)
);
