-- Separa permisos del dashboard en dos módulos:
-- 1) analytics_dashboard (/app)
-- 2) operations_dashboard (/app/operations)
--
-- Mantiene compatibilidad con datos existentes copiando el valor de can_view
-- del módulo legacy 'dashboard' cuando exista.

with base as (
  select
    m.organization_id,
    m.member_type_id,
    m.can_view,
    'analytics_dashboard'::text as module_key
  from public.organization_member_type_modules m
  where lower(m.module_key) = 'dashboard'

  union all

  select
    m.organization_id,
    m.member_type_id,
    m.can_view,
    'operations_dashboard'::text as module_key
  from public.organization_member_type_modules m
  where lower(m.module_key) = 'dashboard'
)
insert into public.organization_member_type_modules (organization_id, member_type_id, module_key, can_view)
select b.organization_id, b.member_type_id, b.module_key, b.can_view
from base b
where not exists (
  select 1
  from public.organization_member_type_modules x
  where x.member_type_id = b.member_type_id
    and lower(x.module_key) = lower(b.module_key)
);

-- Fallback para organizaciones/tipos sin módulo dashboard legacy:
-- crea ambos módulos con defaults por tipo sistema.
with defaults as (
  select
    t.organization_id,
    t.id as member_type_id,
    k.module_key,
    case
      when lower(t.name) in ('owner', 'admin') then true
      when lower(t.name) in ('member', 'viewer') then true
      else false
    end as can_view
  from public.organization_member_types t
  cross join (values ('analytics_dashboard'::text), ('operations_dashboard'::text)) as k(module_key)
)
insert into public.organization_member_type_modules (organization_id, member_type_id, module_key, can_view)
select d.organization_id, d.member_type_id, d.module_key, d.can_view
from defaults d
where not exists (
  select 1
  from public.organization_member_type_modules x
  where x.member_type_id = d.member_type_id
    and lower(x.module_key) = lower(d.module_key)
);
