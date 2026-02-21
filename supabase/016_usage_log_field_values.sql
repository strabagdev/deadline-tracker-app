-- Valores de campos dinámicos asociados a cada registro de uso.

create table if not exists public.usage_log_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  usage_log_id uuid not null references public.usage_logs(id) on delete cascade,
  usage_field_id uuid not null references public.usage_fields(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  created_at timestamptz not null default now(),
  constraint usage_log_field_values_one_typed_value_chk check (
    (
      case when value_text is not null then 1 else 0 end +
      case when value_number is not null then 1 else 0 end +
      case when value_date is not null then 1 else 0 end +
      case when value_boolean is not null then 1 else 0 end
    ) = 1
  )
);

create unique index if not exists usage_log_field_values_org_log_field_uidx
  on public.usage_log_field_values (organization_id, usage_log_id, usage_field_id);

create index if not exists usage_log_field_values_org_log_idx
  on public.usage_log_field_values (organization_id, usage_log_id, created_at);
