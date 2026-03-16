-- Limpieza total de datos de negocio conservando usuarios de Supabase Auth.
-- Uso:
-- - ejecutar en Supabase SQL Editor
-- - preserva auth.users y auth.identities
-- - limpia tablas de public relacionadas al modelo de la app

begin;

do $$
begin
  if to_regclass('public.organization_access_requests') is not null then
    execute 'truncate table public.organization_access_requests restart identity cascade';
  end if;

  if to_regclass('public.organization_invite_email_cooldowns') is not null then
    execute 'truncate table public.organization_invite_email_cooldowns restart identity cascade';
  end if;

  if to_regclass('public.deadline_change_events') is not null then
    execute 'truncate table public.deadline_change_events restart identity cascade';
  end if;

  if to_regclass('public.reporting_endpoints') is not null then
    execute 'truncate table public.reporting_endpoints restart identity cascade';
  end if;

  if to_regclass('public.alert_events') is not null then
    execute 'truncate table public.alert_events restart identity cascade';
  end if;

  if to_regclass('public.deadline_forecasts') is not null then
    execute 'truncate table public.deadline_forecasts restart identity cascade';
  end if;

  if to_regclass('public.usage_log_field_values') is not null then
    execute 'truncate table public.usage_log_field_values restart identity cascade';
  end if;

  if to_regclass('public.usage_logs') is not null then
    execute 'truncate table public.usage_logs restart identity cascade';
  end if;

  if to_regclass('public.usage_fields') is not null then
    execute 'truncate table public.usage_fields restart identity cascade';
  end if;

  if to_regclass('public.deadlines') is not null then
    execute 'truncate table public.deadlines restart identity cascade';
  end if;

  if to_regclass('public.deadline_types') is not null then
    execute 'truncate table public.deadline_types restart identity cascade';
  end if;

  if to_regclass('public.entity_field_values') is not null then
    execute 'truncate table public.entity_field_values restart identity cascade';
  end if;

  if to_regclass('public.entity_fields') is not null then
    execute 'truncate table public.entity_fields restart identity cascade';
  end if;

  if to_regclass('public.entities') is not null then
    execute 'truncate table public.entities restart identity cascade';
  end if;

  if to_regclass('public.usage_units') is not null then
    execute 'truncate table public.usage_units restart identity cascade';
  end if;

  if to_regclass('public.entity_types') is not null then
    execute 'truncate table public.entity_types restart identity cascade';
  end if;

  if to_regclass('public.organization_member_type_modules') is not null then
    execute 'truncate table public.organization_member_type_modules restart identity cascade';
  end if;

  if to_regclass('public.organization_member_types') is not null then
    execute 'truncate table public.organization_member_types restart identity cascade';
  end if;

  if to_regclass('public.organization_members') is not null then
    execute 'truncate table public.organization_members restart identity cascade';
  end if;

  if to_regclass('public.organization_settings') is not null then
    execute 'truncate table public.organization_settings restart identity cascade';
  end if;

  if to_regclass('public.user_settings') is not null then
    execute 'truncate table public.user_settings restart identity cascade';
  end if;

  if to_regclass('public.platform_admins') is not null then
    execute 'truncate table public.platform_admins restart identity cascade';
  end if;

  if to_regclass('public.platform_settings') is not null then
    execute 'truncate table public.platform_settings cascade';
  end if;

  if to_regclass('public.organizations') is not null then
    execute 'truncate table public.organizations restart identity cascade';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'truncate table public.profiles restart identity cascade';
  end if;
end $$;

commit;

-- Si además quisieras borrar usuarios de Auth, eso sería aparte:
-- delete from auth.identities;
-- delete from auth.users;
