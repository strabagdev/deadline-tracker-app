-- Configuración analítica por campo dinámico de entidad.

alter table public.entity_fields
  add column if not exists analytics_mode text not null default 'none';

alter table public.entity_fields
  drop constraint if exists entity_fields_analytics_mode_chk;

alter table public.entity_fields
  add constraint entity_fields_analytics_mode_chk
  check (analytics_mode in ('none', 'distribution', 'trend', 'count'));

create index if not exists entity_fields_org_analytics_mode_idx
  on public.entity_fields (organization_id, analytics_mode, created_at desc);

