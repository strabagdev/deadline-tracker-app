-- Bootstrap consolidado del modelo actual de OpsAhead / deadline-tracker.
-- Objetivo:
-- - levantar una base limpia desde cero en un proyecto Supabase nuevo
-- - dejar plasmado el modelo vigente sin depender de la historia completa de migraciones
--
-- Notas:
-- - este script recrea el esquema de negocio en public
-- - NO borra auth.users
-- - usa IF NOT EXISTS / DO blocks para ser relativamente idempotente
-- - asume Postgres/Supabase con extensión pgcrypto disponible

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

create table if not exists public.profiles (
  user_id uuid primary key,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(email)) > 0)
);

create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email));

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) >= 2)
);

alter table public.organizations
  add column if not exists logo_url text null,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  active_organization_id uuid null references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_settings_active_org_idx
  on public.user_settings (active_organization_id);

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
  updated_at timestamptz not null default now(),
  check (yellow_days >= orange_days and orange_days >= red_days),
  check (yellow_days >= 0 and orange_days >= 0 and red_days >= 0)
);

alter table public.organization_settings
  add column if not exists label_green text not null default 'Al dia',
  add column if not exists label_yellow text not null default 'Aviso',
  add column if not exists label_orange text not null default 'Por vencer',
  add column if not exists label_red text not null default 'Vencido',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null,
  member_type_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (role in ('owner', 'admin', 'member', 'viewer'))
);

alter table public.organization_members
  add column if not exists member_type_id uuid null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists organization_members_user_idx
  on public.organization_members (user_id);

create index if not exists organization_members_org_role_idx
  on public.organization_members (organization_id, role);

create index if not exists organization_members_org_member_type_idx
  on public.organization_members (organization_id, member_type_id);

create table if not exists public.organization_member_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.organization_member_types
  add column if not exists is_active boolean not null default true,
  add column if not exists is_system boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organization_member_type_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_type_id uuid not null references public.organization_member_types(id) on delete cascade,
  module_key text not null,
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, member_type_id, module_key)
);

alter table public.organization_member_type_modules
  add column if not exists can_view boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.entity_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  icon text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.entity_types
  add column if not exists icon text null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entity_types_org_created_idx
  on public.entity_types (organization_id, created_at);

create table if not exists public.usage_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  show_in_usage_records boolean not null default true,
  suggested_values jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.usage_units
  add column if not exists show_in_usage_records boolean not null default true,
  add column if not exists suggested_values jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists usage_units_org_active_idx
  on public.usage_units (organization_id, is_active, created_at desc);

create unique index if not exists usage_units_org_id_id_uidx
  on public.usage_units (organization_id, id);

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type_id uuid not null references public.entity_types(id) on delete restrict,
  name text not null,
  tracks_usage boolean not null default false,
  usage_unit_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) > 0)
);

alter table public.entities
  add column if not exists tracks_usage boolean not null default false,
  add column if not exists usage_unit_id uuid null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entities_org_created_idx
  on public.entities (organization_id, created_at desc);

create index if not exists entities_org_entity_type_idx
  on public.entities (organization_id, entity_type_id);

create index if not exists entities_org_usage_unit_idx
  on public.entities (organization_id, usage_unit_id);

alter table public.entities
  drop constraint if exists entities_usage_unit_id_fkey;

alter table public.entities
  drop constraint if exists entities_org_usage_unit_fkey;

alter table public.entities
  add constraint entities_org_usage_unit_fkey
  foreign key (organization_id, usage_unit_id)
  references public.usage_units (organization_id, id)
  on update cascade
  on delete restrict;

create unique index if not exists entities_org_type_name_unique
  on public.entities (organization_id, entity_type_id, lower(trim(name)));

create table if not exists public.entity_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type_id uuid not null references public.entity_types(id) on delete cascade,
  name text not null,
  key text not null,
  field_type text not null,
  show_in_card boolean not null default false,
  analytics_mode text not null default 'none',
  options jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type_id, key),
  check (field_type in ('text', 'number', 'date', 'boolean', 'select')),
  check (analytics_mode in ('none', 'distribution', 'trend', 'count'))
);

alter table public.entity_fields
  add column if not exists analytics_mode text not null default 'none',
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entity_fields_org_created_idx
  on public.entity_fields (organization_id, entity_type_id, created_at);

create index if not exists entity_fields_org_analytics_mode_idx
  on public.entity_fields (organization_id, analytics_mode);

create table if not exists public.entity_field_values (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  entity_field_id uuid not null references public.entity_fields(id) on delete cascade,
  value_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_id, entity_field_id)
);

alter table public.entity_field_values
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entity_field_values_org_entity_idx
  on public.entity_field_values (organization_id, entity_id);

create index if not exists entity_field_values_org_field_idx
  on public.entity_field_values (organization_id, entity_field_id);

create table if not exists public.deadline_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  measure_by text not null,
  requires_document boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  check (measure_by in ('date', 'usage'))
);

alter table public.deadline_types
  add column if not exists requires_document boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists deadline_types_org_active_idx
  on public.deadline_types (organization_id, is_active, created_at desc);

create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  deadline_type_id uuid not null references public.deadline_types(id) on delete restrict,
  title text null,
  measure_by text null,
  last_done_date date null,
  next_due_date date null,
  last_done_usage numeric null,
  frequency numeric null,
  frequency_unit text null,
  usage_daily_average numeric null,
  usage_daily_average_mode text null default 'auto',
  version_group_id uuid null,
  version_no integer null,
  is_current boolean not null default true,
  superseded_at timestamptz null,
  superseded_by_deadline_id uuid null references public.deadlines(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (measure_by is null or measure_by in ('date', 'usage')),
  check (usage_daily_average_mode is null or usage_daily_average_mode in ('manual', 'auto')),
  check (frequency is null or frequency >= 0),
  check (last_done_usage is null or last_done_usage >= 0),
  check (usage_daily_average is null or usage_daily_average >= 0),
  check (version_no is null or version_no >= 1)
);

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

create index if not exists deadlines_org_entity_current_idx
  on public.deadlines (organization_id, entity_id, is_current, created_at desc);

create index if not exists deadlines_org_current_idx
  on public.deadlines (organization_id, is_current, created_at desc);

create table if not exists public.deadline_forecasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deadline_id uuid not null references public.deadlines(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  forecast_due_date timestamptz null,
  days_remaining numeric null,
  risk_level text not null,
  risk_score numeric not null default 0,
  computed_at timestamptz not null default now(),
  check (risk_level in ('red', 'orange', 'yellow', 'green', 'none'))
);

alter table public.deadline_forecasts
  add column if not exists forecast_due_date timestamptz null,
  add column if not exists days_remaining numeric null,
  add column if not exists risk_level text null,
  add column if not exists risk_score numeric not null default 0,
  add column if not exists computed_at timestamptz not null default now();

create unique index if not exists deadline_forecasts_org_deadline_uidx
  on public.deadline_forecasts (organization_id, deadline_id);

create index if not exists deadline_forecasts_org_entity_idx
  on public.deadline_forecasts (organization_id, entity_id);

create index if not exists deadline_forecasts_org_due_idx
  on public.deadline_forecasts (organization_id, forecast_due_date);

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
  add column if not exists type text null,
  add column if not exists severity text null,
  add column if not exists message text null,
  add column if not exists resolved_at timestamptz null;

create index if not exists alert_events_org_active_idx
  on public.alert_events (organization_id, resolved_at);

create index if not exists alert_events_org_entity_idx
  on public.alert_events (organization_id, entity_id);

create index if not exists alert_events_org_deadline_idx
  on public.alert_events (organization_id, deadline_id);

create index if not exists alert_events_org_type_idx
  on public.alert_events (organization_id, type);

create table if not exists public.usage_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  usage_unit_id uuid not null,
  name text not null,
  key text not null,
  field_type text not null,
  options jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, usage_unit_id, key),
  check (field_type in ('text', 'number', 'date', 'boolean', 'select'))
);

alter table public.usage_fields
  add column if not exists updated_at timestamptz not null default now();

alter table public.usage_fields
  drop constraint if exists usage_fields_usage_unit_id_fkey;

alter table public.usage_fields
  drop constraint if exists usage_fields_org_usage_unit_fkey;

alter table public.usage_fields
  add constraint usage_fields_org_usage_unit_fkey
  foreign key (organization_id, usage_unit_id)
  references public.usage_units (organization_id, id)
  on update cascade
  on delete cascade;

create index if not exists usage_fields_org_unit_created_idx
  on public.usage_fields (organization_id, usage_unit_id, created_at);

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  value numeric null,
  value_text text null,
  logged_on date not null default current_date,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (value is null or value >= 0),
  check (value is not null or value_text is not null)
);

alter table public.usage_logs
  add column if not exists value_text text null,
  add column if not exists logged_on date not null default current_date;

create unique index if not exists usage_logs_org_entity_logged_on_uidx
  on public.usage_logs (organization_id, entity_id, logged_on);

create index if not exists usage_logs_org_entity_logged_on_idx
  on public.usage_logs (organization_id, entity_id, logged_on desc, logged_at desc);

create table if not exists public.usage_log_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  usage_log_id uuid not null references public.usage_logs(id) on delete cascade,
  usage_field_id uuid not null references public.usage_fields(id) on delete cascade,
  value_text text null,
  value_number numeric null,
  value_date date null,
  value_boolean boolean null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usage_log_id, usage_field_id)
);

alter table public.usage_log_field_values
  add column if not exists value_text text null,
  add column if not exists value_number numeric null,
  add column if not exists value_date date null,
  add column if not exists value_boolean boolean null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists usage_log_field_values_org_log_idx
  on public.usage_log_field_values (organization_id, usage_log_id);

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id boolean primary key default true check (id = true),
  platform_logo_url text null,
  updated_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  check (char_length(trim(slug)) > 0),
  check (char_length(trim(name)) > 0),
  check (char_length(trim(dataset_key)) > 0),
  check (char_length(trim(token_hash)) > 0)
);

create index if not exists reporting_endpoints_org_active_idx
  on public.reporting_endpoints (organization_id, is_active, created_at desc);

create table if not exists public.deadline_change_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deadline_id uuid null references public.deadlines(id) on delete set null,
  entity_id uuid not null references public.entities(id) on delete cascade,
  action text not null,
  actor_user_id uuid null references public.profiles(user_id) on delete set null,
  reason text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (action in ('create', 'update', 'delete'))
);

create index if not exists deadline_change_events_org_created_idx
  on public.deadline_change_events (organization_id, created_at desc);

create index if not exists deadline_change_events_org_entity_idx
  on public.deadline_change_events (organization_id, entity_id, created_at desc);

create index if not exists deadline_change_events_org_deadline_idx
  on public.deadline_change_events (organization_id, deadline_id, created_at desc);

create table if not exists public.organization_invite_email_cooldowns (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  cooldown_until timestamptz not null,
  last_error text null,
  last_requested_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, email),
  check (char_length(trim(email)) > 0)
);

create index if not exists organization_invite_email_cooldowns_org_until_idx
  on public.organization_invite_email_cooldowns (organization_id, cooldown_until desc);

create table if not exists public.organization_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.profiles(user_id) on delete set null,
  organization_id uuid null references public.organizations(id) on delete set null,
  assigned_role text null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(email)) > 0),
  check (status in ('pending', 'approved', 'rejected')),
  check (assigned_role is null or assigned_role in ('owner', 'admin', 'member', 'viewer'))
);

create unique index if not exists organization_access_requests_user_pending_uidx
  on public.organization_access_requests (user_id)
  where status = 'pending';

create index if not exists organization_access_requests_status_requested_idx
  on public.organization_access_requests (status, requested_at desc);

create index if not exists organization_access_requests_email_requested_idx
  on public.organization_access_requests (lower(email), requested_at desc);

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

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_organizations_set_updated_at on public.organizations;
create trigger trg_organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_settings_set_updated_at on public.user_settings;
create trigger trg_user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

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

drop trigger if exists trg_entity_types_set_updated_at on public.entity_types;
create trigger trg_entity_types_set_updated_at
before update on public.entity_types
for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_units_set_updated_at on public.usage_units;
create trigger trg_usage_units_set_updated_at
before update on public.usage_units
for each row execute function public.set_updated_at();

drop trigger if exists trg_entities_set_updated_at on public.entities;
create trigger trg_entities_set_updated_at
before update on public.entities
for each row execute function public.set_updated_at();

drop trigger if exists trg_entity_fields_set_updated_at on public.entity_fields;
create trigger trg_entity_fields_set_updated_at
before update on public.entity_fields
for each row execute function public.set_updated_at();

drop trigger if exists trg_entity_field_values_set_updated_at on public.entity_field_values;
create trigger trg_entity_field_values_set_updated_at
before update on public.entity_field_values
for each row execute function public.set_updated_at();

drop trigger if exists trg_deadline_types_set_updated_at on public.deadline_types;
create trigger trg_deadline_types_set_updated_at
before update on public.deadline_types
for each row execute function public.set_updated_at();

drop trigger if exists trg_deadlines_set_updated_at on public.deadlines;
create trigger trg_deadlines_set_updated_at
before update on public.deadlines
for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_fields_set_updated_at on public.usage_fields;
create trigger trg_usage_fields_set_updated_at
before update on public.usage_fields
for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_log_field_values_set_updated_at on public.usage_log_field_values;
create trigger trg_usage_log_field_values_set_updated_at
before update on public.usage_log_field_values
for each row execute function public.set_updated_at();

drop trigger if exists trg_reporting_endpoints_set_updated_at on public.reporting_endpoints;
create trigger trg_reporting_endpoints_set_updated_at
before update on public.reporting_endpoints
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_invite_email_cooldowns_set_updated_at on public.organization_invite_email_cooldowns;
create trigger trg_organization_invite_email_cooldowns_set_updated_at
before update on public.organization_invite_email_cooldowns
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_access_requests_set_updated_at on public.organization_access_requests;
create trigger trg_organization_access_requests_set_updated_at
before update on public.organization_access_requests
for each row execute function public.set_updated_at();

commit;

-- Sugerencia post-bootstrap:
-- 1) ejecutar este script
-- 2) crear / bootstrapear el primer super admin desde la app
-- 3) crear organizaciones nuevas desde el panel global
