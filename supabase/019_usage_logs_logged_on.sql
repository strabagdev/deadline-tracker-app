-- Fecha de negocio para registros de uso (sin zona horaria).
-- logged_at queda para auditoría temporal exacta.

alter table public.usage_logs
  add column if not exists logged_on date;

-- Backfill desde logged_at para datos históricos.
update public.usage_logs
set logged_on = (logged_at at time zone 'UTC')::date
where logged_on is null;

alter table public.usage_logs
  alter column logged_on set not null;

create index if not exists usage_logs_org_entity_logged_on_idx
  on public.usage_logs (organization_id, entity_id, logged_on desc, logged_at desc);
