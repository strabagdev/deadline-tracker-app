-- Convierte public.deadlines.frequency_unit a text si en la base viva aun existe
-- como enum legacy (por ejemplo deadline_frequency_unit).
--
-- Objetivo:
-- - permitir unidades libres como "Kilómetros"
-- - alinear la columna al modelo actual de la app
-- - conservar los valores ya existentes

begin;

do $$
declare
  column_udt text;
begin
  select c.udt_name
  into column_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'deadlines'
    and c.column_name = 'frequency_unit';

  if column_udt is null then
    raise exception 'public.deadlines.frequency_unit no existe';
  end if;

  if column_udt <> 'text' then
    execute 'alter table public.deadlines alter column frequency_unit type text using frequency_unit::text';
  end if;
end $$;

commit;
