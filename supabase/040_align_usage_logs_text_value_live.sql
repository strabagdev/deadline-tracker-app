-- Alinea public.usage_logs al modelo actual sin borrar datos.
-- Objetivo:
-- - permitir registros principales numericos o textuales
-- - quitar NOT NULL legacy sobre usage_logs.value
-- - asegurar la regla "value o value_text"

begin;

alter table public.usage_logs
  add column if not exists value_text text null;

alter table public.usage_logs
  alter column value drop not null;

alter table public.usage_logs
  drop constraint if exists usage_logs_value_or_text_chk;

alter table public.usage_logs
  add constraint usage_logs_value_or_text_chk
  check (
    value is not null
    or nullif(trim(value_text), '') is not null
  );

commit;
