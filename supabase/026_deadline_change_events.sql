-- Historial auditable de cambios en vencimientos.

create table if not exists public.deadline_change_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deadline_id uuid references public.deadlines(id) on delete set null,
  entity_id uuid not null references public.entities(id) on delete cascade,
  action text not null,
  actor_user_id uuid,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(trim(action)) > 0)
);

create index if not exists deadline_change_events_org_created_idx
  on public.deadline_change_events (organization_id, created_at desc);

create index if not exists deadline_change_events_org_entity_idx
  on public.deadline_change_events (organization_id, entity_id, created_at desc);

create index if not exists deadline_change_events_org_deadline_idx
  on public.deadline_change_events (organization_id, deadline_id, created_at desc);

