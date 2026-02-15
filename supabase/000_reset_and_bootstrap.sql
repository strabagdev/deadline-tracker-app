-- Reset unificado para entorno "en cero" + soporte de super admin.
-- Ejecutar en Supabase SQL Editor.
--
-- 1) Este script SIEMPRE resetea datos de negocio (organizations, members, profiles, etc.).
-- 2) Opcionalmente puedes resetear también Auth (auth.users/auth.identities)
--    descomentando el bloque final "FULL AUTH RESET".

-- Tabla requerida por el flujo de super admin.
create table if not exists public.platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id boolean primary key default true check (id = true),
  platform_logo_url text,
  updated_at timestamptz not null default now()
);

-- Reset de datos de la aplicacion (mantiene usuarios de Auth por defecto).
do $$
begin
  if to_regclass('public.organization_members') is not null then
    execute 'truncate table public.organization_members restart identity cascade';
  end if;
  if to_regclass('public.user_settings') is not null then
    execute 'truncate table public.user_settings restart identity cascade';
  end if;
  if to_regclass('public.organization_settings') is not null then
    execute 'truncate table public.organization_settings restart identity cascade';
  end if;
  if to_regclass('public.usage_logs') is not null then
    execute 'truncate table public.usage_logs restart identity cascade';
  end if;
  if to_regclass('public.deadlines') is not null then
    execute 'truncate table public.deadlines restart identity cascade';
  end if;
  if to_regclass('public.entity_fields') is not null then
    execute 'truncate table public.entity_fields restart identity cascade';
  end if;
  if to_regclass('public.entities') is not null then
    execute 'truncate table public.entities restart identity cascade';
  end if;
  if to_regclass('public.deadline_types') is not null then
    execute 'truncate table public.deadline_types restart identity cascade';
  end if;
  if to_regclass('public.entity_types') is not null then
    execute 'truncate table public.entity_types restart identity cascade';
  end if;
  if to_regclass('public.organizations') is not null then
    execute 'truncate table public.organizations restart identity cascade';
  end if;
  if to_regclass('public.platform_admins') is not null then
    execute 'truncate table public.platform_admins restart identity cascade';
  end if;
  if to_regclass('public.platform_settings') is not null then
    execute 'truncate table public.platform_settings cascade';
  end if;
  if to_regclass('public.profiles') is not null then
    execute 'truncate table public.profiles restart identity cascade';
  end if;
end $$;

-- FULL AUTH RESET (opcional):
-- Descomenta solo si quieres borrar tambien todos los usuarios de Supabase Auth.
-- delete from auth.identities;
-- delete from auth.users;
