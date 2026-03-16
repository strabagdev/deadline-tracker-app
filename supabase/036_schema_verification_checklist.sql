-- Checklist rápido para validar que la base actual refleja el modelo bootstrap.
-- Ejecutar en Supabase SQL Editor.

-- 1) Tablas críticas existentes
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'organizations',
    'organization_settings',
    'organization_members',
    'organization_member_types',
    'organization_member_type_modules',
    'entities',
    'entity_fields',
    'entity_field_values',
    'deadline_types',
    'deadlines',
    'deadline_forecasts',
    'alert_events',
    'usage_units',
    'usage_fields',
    'usage_logs',
    'usage_log_field_values',
    'reporting_endpoints',
    'organization_access_requests'
  )
order by table_name;

-- 2) Columnas sensibles del modelo actual
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'organization_settings' and column_name in ('yellow_days', 'orange_days', 'red_days', 'label_green', 'label_yellow', 'label_orange', 'label_red')) or
    (table_name = 'alert_events' and column_name in ('type', 'severity', 'message', 'created_at', 'resolved_at')) or
    (table_name = 'reporting_endpoints' and column_name in ('name', 'dataset_key', 'token_hash', 'is_active')) or
    (table_name = 'usage_units' and column_name in ('show_in_usage_records', 'suggested_values')) or
    (table_name = 'organization_members' and column_name in ('member_type_id')) or
    (table_name = 'organization_member_types' and column_name in ('is_active', 'is_system')) or
    (table_name = 'organization_member_type_modules' and column_name in ('can_view'))
  )
order by table_name, column_name;

-- 3) FKs críticas para joins / cascadas
select conname as constraint_name,
       conrelid::regclass as table_name
from pg_constraint
where contype = 'f'
  and conname in (
    'organization_members_member_type_fkey'
  )
order by conname;

-- 4) Muestra de datos por organización para detectar residuos
select
  o.id as organization_id,
  o.name,
  (select count(*) from public.organization_members m where m.organization_id = o.id) as members,
  (select count(*) from public.entities e where e.organization_id = o.id) as entities,
  (select count(*) from public.deadlines d where d.organization_id = o.id) as deadlines,
  (select count(*) from public.deadline_forecasts f where f.organization_id = o.id) as forecasts,
  (select count(*) from public.usage_logs u where u.organization_id = o.id) as usage_logs,
  (select count(*) from public.alert_events a where a.organization_id = o.id) as alert_events,
  (select count(*) from public.reporting_endpoints r where r.organization_id = o.id) as reporting_endpoints
from public.organizations o
order by o.created_at desc;

-- 5) Si esta query devuelve filas, aún quedan columnas legacy de semáforo
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organization_settings'
  and column_name in (
    'date_yellow_days',
    'date_orange_days',
    'date_red_days',
    'usage_yellow_days',
    'usage_orange_days',
    'usage_red_days'
  )
order by column_name;
