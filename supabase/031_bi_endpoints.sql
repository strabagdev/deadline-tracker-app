-- Endpoints de integración BI por organización.

create table if not exists public.reporting_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  label text not null,
  dataset_key text not null,
  endpoint_token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(slug)) > 0),
  check (char_length(trim(label)) > 0),
  check (char_length(trim(dataset_key)) > 0),
  check (char_length(trim(endpoint_token)) >= 16)
);

create unique index if not exists reporting_endpoints_org_slug_uidx
  on public.reporting_endpoints (organization_id, lower(slug));

create unique index if not exists reporting_endpoints_token_uidx
  on public.reporting_endpoints (endpoint_token);

create index if not exists reporting_endpoints_org_active_idx
  on public.reporting_endpoints (organization_id, is_active, created_at desc);

-- Nuevo módulo RBAC para administrar endpoints BI.
insert into public.organization_member_type_modules (organization_id, member_type_id, module_key, can_view)
select
  t.organization_id,
  t.id,
  'bi_integrations',
  case when lower(t.name) in ('owner', 'admin') then true else false end
from public.organization_member_types t
where not exists (
  select 1
  from public.organization_member_type_modules m
  where m.member_type_id = t.id
    and lower(m.module_key) = 'bi_integrations'
);
