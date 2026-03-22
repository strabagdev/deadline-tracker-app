create table if not exists public.dashboard_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_hash text not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  summary_lines jsonb not null default '[]'::jsonb,
  model text,
  generation_mode text not null default 'fallback',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_ai_summaries_org_uidx unique (organization_id),
  constraint dashboard_ai_summaries_generation_mode_check check (generation_mode in ('ai', 'fallback'))
);

create index if not exists dashboard_ai_summaries_org_idx
  on public.dashboard_ai_summaries (organization_id);

create index if not exists dashboard_ai_summaries_hash_idx
  on public.dashboard_ai_summaries (snapshot_hash);
