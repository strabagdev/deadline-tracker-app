-- Soporte de logo por organización (branding en header).
-- Ejecutar en Supabase SQL Editor.

alter table public.organizations
  add column if not exists logo_url text;
