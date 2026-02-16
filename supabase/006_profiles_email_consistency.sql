-- Consistencia de profiles.email para evitar duplicados y ambiguedad en owners/invitaciones.
-- Ejecutar en Supabase SQL Editor (proyecto de datos).

-- 1) Normaliza emails (trim + lower) cuando exista la columna.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'Tabla public.profiles no existe, se omite migracion.';
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  ) then
    execute $sql$
      update public.profiles
      set email = lower(trim(email))
      where email is not null
    $sql$;
  end if;
end $$;

-- 2) Elimina filas duplicadas por email (mantiene 1 fila por email).
--    Priorizamos la fila con user_id "menor" para mantener criterio deterministico.
do $$
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  ) then
    execute $sql$
      with ranked as (
        select
          ctid,
          row_number() over (
            partition by lower(email)
            order by user_id asc
          ) as rn
        from public.profiles
        where email is not null and email <> ''
      )
      delete from public.profiles p
      using ranked r
      where p.ctid = r.ctid
        and r.rn > 1
    $sql$;
  end if;
end $$;

-- 3) Refuerza unicidad de email (case-insensitive) excluyendo null/vacio.
do $$
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  ) then
    if not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'profiles'
        and indexname = 'profiles_email_unique_ci_idx'
    ) then
      execute $sql$
        create unique index profiles_email_unique_ci_idx
        on public.profiles (lower(email))
        where email is not null and email <> ''
      $sql$;
    end if;
  end if;
end $$;
