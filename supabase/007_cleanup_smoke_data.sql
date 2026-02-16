-- Limpieza de datos creados por scripts Smoke E2E.
-- Ejecutar en Supabase SQL Editor (proyecto de datos).
--
-- El script elimina SOLO registros con prefijo "Smoke " usados por smoke-e2e:
-- - organizations.name: "Smoke Org %"
-- - entity_types.name: "Smoke Type %"
-- - entities.name: "Smoke Entity %"
-- - deadline_types.name: "Smoke Deadline %"
--
-- Nota: si tienes datos reales con esos prefijos, también se eliminarán.

begin;

-- 1) Organizaciones smoke (y todo lo que cuelga de ellas).
with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
),
smoke_entities as (
  select e.id
  from public.entities e
  join smoke_orgs so on so.id = e.organization_id
)
delete from public.usage_logs ul
using smoke_entities se
where ul.entity_id = se.id;

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
),
smoke_entities as (
  select e.id
  from public.entities e
  join smoke_orgs so on so.id = e.organization_id
)
delete from public.deadlines d
using smoke_entities se
where d.entity_id = se.id;

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.entity_fields ef
using public.entity_types et
where ef.entity_type_id = et.id
  and et.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.entities e
where e.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.deadline_types dt
where dt.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.entity_types et
where et.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.organization_members om
where om.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
delete from public.organization_settings os
where os.organization_id in (select id from smoke_orgs);

with smoke_orgs as (
  select id
  from public.organizations
  where name ilike 'Smoke Org %'
)
update public.user_settings us
set active_organization_id = null
where us.active_organization_id in (select id from smoke_orgs);

delete from public.organizations
where name ilike 'Smoke Org %';

-- 2) Limpieza extra por prefijos (por si algo quedó fuera de org smoke).
delete from public.deadline_types where name ilike 'Smoke Deadline %';
delete from public.entity_types where name ilike 'Smoke Type %';
delete from public.entities where name ilike 'Smoke Entity %';

commit;
