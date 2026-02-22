-- Permite registrar valor principal como texto o número en usage_logs.

alter table public.usage_logs
  add column if not exists value_text text;

-- Se habilita valor numérico opcional para casos de estado/texto.
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
