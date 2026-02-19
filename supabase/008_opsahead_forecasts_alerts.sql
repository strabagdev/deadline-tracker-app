-- OpsAhead predictive layer
-- Nuevas tablas para proyecciones y alertas automáticas.
-- No modifica tablas existentes.

create table if not exists public.deadline_forecasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deadline_id uuid not null references public.deadlines(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  forecast_due_date timestamptz,
  days_remaining numeric,
  risk_level text not null,
  risk_score numeric not null default 0,
  computed_at timestamptz not null default now()
);

create unique index if not exists deadline_forecasts_org_deadline_uidx
  on public.deadline_forecasts (organization_id, deadline_id);

create index if not exists deadline_forecasts_org_entity_idx
  on public.deadline_forecasts (organization_id, entity_id);

create index if not exists deadline_forecasts_org_due_idx
  on public.deadline_forecasts (organization_id, forecast_due_date);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  deadline_id uuid references public.deadlines(id) on delete set null,
  type text not null,
  severity text not null,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists alerts_org_entity_idx
  on public.alerts (organization_id, entity_id);

create index if not exists alerts_org_deadline_idx
  on public.alerts (organization_id, deadline_id);

create index if not exists alerts_org_active_idx
  on public.alerts (organization_id, resolved_at);

create index if not exists alerts_org_type_idx
  on public.alerts (organization_id, type);

