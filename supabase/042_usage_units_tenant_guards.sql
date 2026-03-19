-- Blindaje multi-tenant para usage_units.
-- Evita referencias cruzadas entre organizaciones desde entities y usage_fields.

do $$
begin
  if exists (
    select 1
    from public.entities e
    join public.usage_units u on u.id = e.usage_unit_id
    where e.usage_unit_id is not null
      and e.organization_id <> u.organization_id
  ) then
    raise exception 'Cross-tenant references found: entities.usage_unit_id points to usage_units from another organization';
  end if;

  if exists (
    select 1
    from public.usage_fields f
    join public.usage_units u on u.id = f.usage_unit_id
    where f.organization_id <> u.organization_id
  ) then
    raise exception 'Cross-tenant references found: usage_fields.usage_unit_id points to usage_units from another organization';
  end if;
end $$;

create unique index if not exists usage_units_org_id_id_uidx
  on public.usage_units (organization_id, id);

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
