-- Regla de negocio: máximo un registro de uso por entidad y día.

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, entity_id, logged_on
      order by logged_at desc, id desc
    ) as rn
  from public.usage_logs
)
delete from public.usage_logs ul
using ranked r
where ul.id = r.id
  and r.rn > 1;

create unique index if not exists usage_logs_org_entity_logged_on_uidx
  on public.usage_logs (organization_id, entity_id, logged_on);
