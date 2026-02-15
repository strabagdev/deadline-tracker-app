-- Limpieza final del semáforo:
-- elimina columnas duplicadas date_* y usage_*,
-- dejando una única fuente de verdad:
--   yellow_days, orange_days, red_days
--
-- Ejecutar después de:
--   supabase/002_unify_semaphore_thresholds.sql

alter table public.organization_settings
  drop column if exists date_yellow_days,
  drop column if exists date_orange_days,
  drop column if exists date_red_days,
  drop column if exists usage_yellow_days,
  drop column if exists usage_orange_days,
  drop column if exists usage_red_days;
