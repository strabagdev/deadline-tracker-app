-- Branding global de plataforma (logo administrado por super admin).
-- Ejecutar en Supabase SQL Editor.

create table if not exists public.platform_settings (
  id boolean primary key default true check (id = true),
  platform_logo_url text,
  updated_at timestamptz not null default now()
);
