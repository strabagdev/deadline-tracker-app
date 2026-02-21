-- Campos dinámicos asociados a unidades de uso.

create table if not exists public.usage_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  usage_unit_id uuid not null references public.usage_units(id) on delete cascade,
  name text not null,
  key text not null,
  field_type text not null default 'text',
  options jsonb,
  created_at timestamptz not null default now(),
  check (char_length(trim(name)) > 0),
  check (char_length(trim(key)) > 0)
);

create unique index if not exists usage_fields_org_unit_key_uidx
  on public.usage_fields (organization_id, usage_unit_id, key);

create index if not exists usage_fields_org_unit_created_idx
  on public.usage_fields (organization_id, usage_unit_id, created_at);
