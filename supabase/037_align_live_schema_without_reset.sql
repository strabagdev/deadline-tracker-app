-- Alineacion no destructiva de una base legacy/hibrida al modelo actual.
-- Objetivo:
-- - conservar la data ya cargada
-- - llevar el esquema vivo a un estado compatible con el backend actual
-- - evitar reset/truncate
--
-- Uso recomendado:
-- 1) ejecutar este script en Supabase SQL Editor
-- 2) luego ejecutar 036_schema_verification_checklist.sql
-- 3) si 036 aun muestra desalineaciones, revisar esos resultados puntuales

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- organization_settings: normaliza thresholds y labels actuales a partir de columnas legacy
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  yellow_days integer not null default 60,
  orange_days integer not null default 30,
  red_days integer not null default 15,
  label_green text not null default 'Al dia',
  label_yellow text not null default 'Aviso',
  label_orange text not null default 'Por vencer',
  label_red text not null default 'Vencido',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_settings
  add column if not exists yellow_days integer,
  add column if not exists orange_days integer,
  add column if not exists red_days integer,
  add column if not exists label_green text,
  add column if not exists label_yellow text,
  add column if not exists label_orange text,
  add column if not exists label_red text,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  has_date_yellow boolean;
  has_date_orange boolean;
  has_date_red boolean;
  has_usage_yellow boolean;
  has_usage_orange boolean;
  has_usage_red boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'date_yellow_days'
  ) into has_date_yellow;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'date_orange_days'
  ) into has_date_orange;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'date_red_days'
  ) into has_date_red;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'usage_yellow_days'
  ) into has_usage_yellow;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'usage_orange_days'
  ) into has_usage_orange;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_settings' and column_name = 'usage_red_days'
  ) into has_usage_red;

  execute format(
    $sql$
      update public.organization_settings
      set
        yellow_days = coalesce(yellow_days, %s, %s, 60),
        orange_days = coalesce(orange_days, %s, %s, 30),
        red_days = coalesce(red_days, %s, %s, 15),
        label_green = coalesce(nullif(trim(label_green), ''), 'Al dia'),
        label_yellow = coalesce(nullif(trim(label_yellow), ''), 'Aviso'),
        label_orange = coalesce(nullif(trim(label_orange), ''), 'Por vencer'),
        label_red = coalesce(nullif(trim(label_red), ''), 'Vencido')
      where yellow_days is null
         or orange_days is null
         or red_days is null
         or label_green is null
         or label_yellow is null
         or label_orange is null
         or label_red is null
    $sql$,
    case when has_date_yellow then 'date_yellow_days' else 'null' end,
    case when has_usage_yellow then 'usage_yellow_days' else 'null' end,
    case when has_date_orange then 'date_orange_days' else 'null' end,
    case when has_usage_orange then 'usage_orange_days' else 'null' end,
    case when has_date_red then 'date_red_days' else 'null' end,
    case when has_usage_red then 'usage_red_days' else 'null' end
  );
end $$;

alter table public.organization_settings
  alter column yellow_days set default 60,
  alter column orange_days set default 30,
  alter column red_days set default 15,
  alter column label_green set default 'Al dia',
  alter column label_yellow set default 'Aviso',
  alter column label_orange set default 'Por vencer',
  alter column label_red set default 'Vencido';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'yellow_days'
  ) then
    execute 'alter table public.organization_settings alter column yellow_days set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'orange_days'
  ) then
    execute 'alter table public.organization_settings alter column orange_days set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'red_days'
  ) then
    execute 'alter table public.organization_settings alter column red_days set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'label_green'
  ) then
    execute 'alter table public.organization_settings alter column label_green set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'label_yellow'
  ) then
    execute 'alter table public.organization_settings alter column label_yellow set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'label_orange'
  ) then
    execute 'alter table public.organization_settings alter column label_orange set not null';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_settings'
      and column_name = 'label_red'
  ) then
    execute 'alter table public.organization_settings alter column label_red set not null';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_settings_thresholds_check'
  ) then
    alter table public.organization_settings
      add constraint organization_settings_thresholds_check
      check (yellow_days >= orange_days and orange_days >= red_days);
  end if;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_settings_non_negative_check'
  ) then
    alter table public.organization_settings
      add constraint organization_settings_non_negative_check
      check (yellow_days >= 0 and orange_days >= 0 and red_days >= 0);
  end if;
exception when duplicate_object then
  null;
end $$;

-- organization_members / member types / modules
alter table public.organization_members
  add column if not exists member_type_id uuid null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.organization_member_types
  add column if not exists is_active boolean not null default true,
  add column if not exists is_system boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.organization_member_type_modules
  add column if not exists can_view boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_members_member_type_fkey'
  ) then
    alter table public.organization_members
      add constraint organization_members_member_type_fkey
      foreign key (member_type_id)
      references public.organization_member_types(id)
      on delete set null;
  end if;
end $$;

-- usage_units
alter table public.usage_units
  add column if not exists show_in_usage_records boolean not null default true,
  add column if not exists suggested_values jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- alert_events: normaliza columnas actuales desde columnas legacy si existieran
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  deadline_id uuid null references public.deadlines(id) on delete set null,
  type text not null,
  severity text not null,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

alter table public.alert_events
  add column if not exists type text,
  add column if not exists severity text,
  add column if not exists message text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists resolved_at timestamptz null;

do $$
declare
  has_event_type boolean;
  has_first_seen_at boolean;
  has_last_seen_at boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alert_events' and column_name = 'event_type'
  ) into has_event_type;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alert_events' and column_name = 'first_seen_at'
  ) into has_first_seen_at;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alert_events' and column_name = 'last_seen_at'
  ) into has_last_seen_at;

  execute format(
    $sql$
      update public.alert_events
      set
        type = coalesce(type, %s, 'forecast_risk'),
        severity = coalesce(severity, 'yellow'),
        message = coalesce(message, 'Alerta generada'),
        created_at = coalesce(created_at, %s, %s, now())
      where type is null
         or severity is null
         or message is null
    $sql$,
    case when has_event_type then 'event_type' else 'null' end,
    case when has_first_seen_at then 'first_seen_at' else 'null' end,
    case when has_last_seen_at then 'last_seen_at' else 'null' end
  );
end $$;

alter table public.alert_events
  alter column type set not null,
  alter column severity set not null,
  alter column message set not null;

create index if not exists alert_events_org_active_idx
  on public.alert_events (organization_id, resolved_at);

create index if not exists alert_events_org_entity_idx
  on public.alert_events (organization_id, entity_id);

create index if not exists alert_events_org_deadline_idx
  on public.alert_events (organization_id, deadline_id);

create index if not exists alert_events_org_type_idx
  on public.alert_events (organization_id, type);

-- reporting_endpoints: normaliza columnas actuales desde columnas legacy si existieran
create table if not exists public.reporting_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  kind text not null default 'powerbi',
  is_active boolean not null default true,
  dataset_key text not null,
  token_hash text not null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reporting_endpoints
  add column if not exists name text,
  add column if not exists kind text not null default 'powerbi',
  add column if not exists token_hash text,
  add column if not exists created_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  has_label boolean;
  has_endpoint_token boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reporting_endpoints' and column_name = 'label'
  ) into has_label;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reporting_endpoints' and column_name = 'endpoint_token'
  ) into has_endpoint_token;

  execute format(
    $sql$
      update public.reporting_endpoints
      set
        name = coalesce(name, %s),
        token_hash = coalesce(token_hash, %s),
        kind = coalesce(kind, 'powerbi')
      where name is null
         or token_hash is null
    $sql$,
    case when has_label then 'label' else quote_literal('') end,
    case when has_endpoint_token then 'endpoint_token' else quote_literal('') end
  );
end $$;

alter table public.reporting_endpoints
  alter column name set not null,
  alter column token_hash set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_endpoints_slug_trim_check'
  ) then
    alter table public.reporting_endpoints
      add constraint reporting_endpoints_slug_trim_check
      check (char_length(trim(slug)) > 0);
  end if;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_endpoints_name_trim_check'
  ) then
    alter table public.reporting_endpoints
      add constraint reporting_endpoints_name_trim_check
      check (char_length(trim(name)) > 0);
  end if;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_endpoints_dataset_key_trim_check'
  ) then
    alter table public.reporting_endpoints
      add constraint reporting_endpoints_dataset_key_trim_check
      check (char_length(trim(dataset_key)) > 0);
  end if;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_endpoints_token_hash_trim_check'
  ) then
    alter table public.reporting_endpoints
      add constraint reporting_endpoints_token_hash_trim_check
      check (char_length(trim(token_hash)) > 0);
  end if;
exception when duplicate_object then
  null;
end $$;

create index if not exists reporting_endpoints_org_active_idx
  on public.reporting_endpoints (organization_id, is_active, created_at desc);

-- deadlines / usage tables: asegura columnas modernas usadas por backend
alter table public.deadlines
  add column if not exists title text null,
  add column if not exists measure_by text null,
  add column if not exists usage_daily_average_mode text null default 'auto',
  add column if not exists version_group_id uuid null,
  add column if not exists version_no integer null,
  add column if not exists is_current boolean not null default true,
  add column if not exists superseded_at timestamptz null,
  add column if not exists superseded_by_deadline_id uuid null references public.deadlines(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.deadlines
set
  version_group_id = coalesce(version_group_id, id),
  version_no = coalesce(version_no, 1),
  is_current = coalesce(is_current, true)
where version_group_id is null
   or version_no is null;

alter table public.deadlines
  alter column version_group_id set not null,
  alter column version_no set not null;

create unique index if not exists deadlines_org_group_version_uidx
  on public.deadlines (organization_id, version_group_id, version_no);

alter table public.usage_logs
  add column if not exists value_text text null,
  add column if not exists logged_on date not null default current_date;

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

alter table public.usage_log_field_values
  add column if not exists value_text text null,
  add column if not exists value_number numeric null,
  add column if not exists value_date date null,
  add column if not exists value_boolean boolean null,
  add column if not exists updated_at timestamptz not null default now();

-- triggers updated_at
drop trigger if exists trg_organization_settings_set_updated_at on public.organization_settings;
create trigger trg_organization_settings_set_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_members_set_updated_at on public.organization_members;
create trigger trg_organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_member_types_set_updated_at on public.organization_member_types;
create trigger trg_organization_member_types_set_updated_at
before update on public.organization_member_types
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_member_type_modules_set_updated_at on public.organization_member_type_modules;
create trigger trg_organization_member_type_modules_set_updated_at
before update on public.organization_member_type_modules
for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_units_set_updated_at on public.usage_units;
create trigger trg_usage_units_set_updated_at
before update on public.usage_units
for each row execute function public.set_updated_at();

drop trigger if exists trg_deadlines_set_updated_at on public.deadlines;
create trigger trg_deadlines_set_updated_at
before update on public.deadlines
for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_log_field_values_set_updated_at on public.usage_log_field_values;
create trigger trg_usage_log_field_values_set_updated_at
before update on public.usage_log_field_values
for each row execute function public.set_updated_at();

drop trigger if exists trg_reporting_endpoints_set_updated_at on public.reporting_endpoints;
create trigger trg_reporting_endpoints_set_updated_at
before update on public.reporting_endpoints
for each row execute function public.set_updated_at();

commit;
