-- Enlaces compartibles de captura de uso por tipo de entidad.

create table if not exists public.usage_capture_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type_id uuid not null references public.entity_types(id) on delete cascade,
  token text not null unique,
  label text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (char_length(trim(token)) >= 16)
);

create index if not exists usage_capture_links_org_active_idx
  on public.usage_capture_links (organization_id, is_active, created_at desc);

create index if not exists usage_capture_links_org_entity_type_idx
  on public.usage_capture_links (organization_id, entity_type_id, created_at desc);

-- Nuevo módulo RBAC: captura enfocada de uso por tipo.
insert into public.organization_member_type_modules (organization_id, member_type_id, module_key, can_view)
select t.organization_id,
       t.id,
       'usage_capture',
       case when lower(t.name) in ('owner', 'admin') then true else false end
from public.organization_member_types t
where not exists (
  select 1
  from public.organization_member_type_modules m
  where m.member_type_id = t.id
    and lower(m.module_key) = 'usage_capture'
);
