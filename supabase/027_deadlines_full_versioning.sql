-- Versionado completo de vencimientos.

alter table public.deadlines
  add column if not exists version_group_id uuid,
  add column if not exists version_no integer,
  add column if not exists is_current boolean not null default true,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_deadline_id uuid references public.deadlines(id) on delete set null;

-- Backfill para datos existentes.
update public.deadlines
set
  version_group_id = coalesce(version_group_id, id),
  version_no = coalesce(version_no, 1),
  is_current = coalesce(is_current, true)
where version_group_id is null
   or version_no is null;

alter table public.deadlines
  alter column version_group_id set not null,
  alter column version_no set not null;

create unique index if not exists deadlines_org_group_version_uidx
  on public.deadlines (organization_id, version_group_id, version_no);

create index if not exists deadlines_org_entity_current_idx
  on public.deadlines (organization_id, entity_id, is_current, created_at desc);

create index if not exists deadlines_org_current_idx
  on public.deadlines (organization_id, is_current, created_at desc);

