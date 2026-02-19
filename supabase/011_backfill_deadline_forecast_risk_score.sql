-- Backfill de risk_score en deadline_forecasts
-- para alinearlo al esquema por estado semáforo.
-- Ejecutar en Supabase SQL Editor.

update public.deadline_forecasts
set risk_score = case
  when risk_level = 'red' then 100
  when risk_level = 'orange' then 80
  when risk_level = 'yellow' then 60
  when risk_level = 'green' then 25
  else 0
end;
