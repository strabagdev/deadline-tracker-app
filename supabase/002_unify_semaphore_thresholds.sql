-- Unifica semáforo en un solo set de umbrales (sin duplicar date_* y usage_*).
-- Ejecutar en Supabase SQL Editor.

alter table public.organization_settings
  add column if not exists yellow_days integer,
  add column if not exists orange_days integer,
  add column if not exists red_days integer;

-- Backfill desde columnas legacy si existen datos.
update public.organization_settings
set
  yellow_days = coalesce(yellow_days, date_yellow_days, usage_yellow_days, 60),
  orange_days = coalesce(orange_days, date_orange_days, usage_orange_days, 30),
  red_days = coalesce(red_days, date_red_days, usage_red_days, 15);

-- Defaults + not null para garantizar integridad del nuevo esquema.
alter table public.organization_settings
  alter column yellow_days set default 60,
  alter column orange_days set default 30,
  alter column red_days set default 15,
  alter column yellow_days set not null,
  alter column orange_days set not null,
  alter column red_days set not null;

-- Opcional (limpieza final cuando toda la app esté migrada):
-- alter table public.organization_settings
--   drop column if exists date_yellow_days,
--   drop column if exists date_orange_days,
--   drop column if exists date_red_days,
--   drop column if exists usage_yellow_days,
--   drop column if exists usage_orange_days,
--   drop column if exists usage_red_days;
