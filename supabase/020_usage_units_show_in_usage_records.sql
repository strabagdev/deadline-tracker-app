-- Controla si la unidad debe mostrarse al renderizar registros de uso.

alter table public.usage_units
  add column if not exists show_in_usage_records boolean not null default true;
