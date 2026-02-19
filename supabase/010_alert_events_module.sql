-- Módulo nuevo de alertas auditables (separado de forecast snapshot).
-- Ejecutar en Supabase SQL Editor.

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  deadline_id uuid references public.deadlines(id) on delete set null,
  event_type text not null,
  severity text not null,
  message text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists alert_events_org_active_idx
  on public.alert_events (organization_id, resolved_at);

create index if not exists alert_events_org_entity_idx
  on public.alert_events (organization_id, entity_id);

create index if not exists alert_events_org_deadline_idx
  on public.alert_events (organization_id, deadline_id);

create index if not exists alert_events_org_type_idx
  on public.alert_events (organization_id, event_type);
