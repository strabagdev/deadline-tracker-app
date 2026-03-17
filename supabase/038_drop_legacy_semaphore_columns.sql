-- Elimina columnas legacy de semaforo solo si el esquema moderno ya esta listo.
-- Uso recomendado:
-- 1) ejecutar 037_align_live_schema_without_reset.sql
-- 2) confirmar con 036_schema_verification_checklist.sql que existen:
--    yellow_days, orange_days, red_days, label_green, label_yellow, label_orange, label_red
-- 3) ejecutar este script
-- 4) volver a correr 036_schema_verification_checklist.sql

begin;

do $$
declare
  missing_count integer;
  null_count integer;
begin
  -- Verifica columnas modernas requeridas
  select count(*)
  into missing_count
  from (
    values
      ('yellow_days'),
      ('orange_days'),
      ('red_days'),
      ('label_green'),
      ('label_yellow'),
      ('label_orange'),
      ('label_red')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'organization_settings'
      and c.column_name = required.column_name
  );

  if missing_count > 0 then
    raise exception 'No se pueden eliminar columnas legacy: faltan columnas modernas en public.organization_settings';
  end if;

  -- Verifica que no haya filas con null en thresholds modernos
  execute $sql$
    select count(*)
    from public.organization_settings
    where yellow_days is null
       or orange_days is null
       or red_days is null
       or label_green is null
       or label_yellow is null
       or label_orange is null
       or label_red is null
  $sql$
  into null_count;

  if null_count > 0 then
    raise exception 'No se pueden eliminar columnas legacy: hay filas con columnas modernas sin poblar en public.organization_settings';
  end if;
end $$;

alter table public.organization_settings
  drop column if exists date_yellow_days,
  drop column if exists date_orange_days,
  drop column if exists date_red_days,
  drop column if exists usage_yellow_days,
  drop column if exists usage_orange_days,
  drop column if exists usage_red_days;

commit;
