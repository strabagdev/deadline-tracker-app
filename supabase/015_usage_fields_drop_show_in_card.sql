-- Corrección: show_in_card no aplica para campos de uso.
alter table public.usage_fields
  drop column if exists show_in_card;
