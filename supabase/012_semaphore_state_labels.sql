-- Nombres configurables para estados de semáforo por organización.
-- Ejecutar en Supabase SQL Editor.

alter table public.organization_settings
  add column if not exists label_green text not null default 'Al día',
  add column if not exists label_yellow text not null default 'Aviso',
  add column if not exists label_orange text not null default 'Por vencer',
  add column if not exists label_red text not null default 'Vencido';

update public.organization_settings
set
  label_green = coalesce(nullif(label_green, ''), 'Al día'),
  label_yellow = coalesce(nullif(label_yellow, ''), 'Aviso'),
  label_orange = coalesce(nullif(label_orange, ''), 'Por vencer'),
  label_red = coalesce(nullif(label_red, ''), 'Vencido');
