-- Valores sugeridos por unidad de uso para acelerar ingreso del valor principal.

alter table public.usage_units
  add column if not exists suggested_values text[] not null default '{}';

