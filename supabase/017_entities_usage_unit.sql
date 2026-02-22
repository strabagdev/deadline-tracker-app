-- Unidad de uso asignada por entidad.

alter table public.entities
  add column if not exists usage_unit_id uuid references public.usage_units(id) on delete set null;

create index if not exists entities_org_usage_unit_idx
  on public.entities (organization_id, usage_unit_id);
