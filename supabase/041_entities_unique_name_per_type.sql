-- Evita duplicados de nombre dentro del mismo tipo de entidad por organización.
-- La comparación usa lower(trim(name)) para tratar mayúsculas/minúsculas y espacios extremos como equivalentes.

do $$
declare
  duplicates_preview text;
begin
  select string_agg(
    format(
      'org=%s type=%s name=%s total=%s',
      organization_id,
      entity_type_id,
      normalized_name,
      total
    ),
    E'\n'
    order by total desc, normalized_name
  )
  into duplicates_preview
  from (
    select
      organization_id,
      entity_type_id,
      lower(trim(name)) as normalized_name,
      count(*) as total
    from public.entities
    group by 1, 2, 3
    having count(*) > 1
    order by total desc, normalized_name
    limit 20
  ) d;

  if duplicates_preview is not null then
    raise exception using
      message = 'No se puede crear entities_org_type_name_unique: existen entidades duplicadas por organización + tipo + nombre.',
      detail = duplicates_preview,
      hint = 'Limpia o renombra los duplicados antes de volver a ejecutar esta migración.';
  end if;
end $$;

create unique index if not exists entities_org_type_name_unique
  on public.entities (organization_id, entity_type_id, lower(trim(name)));
