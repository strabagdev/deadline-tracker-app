-- Fase temporal: desactivar módulo de alertas.
-- Elimina la tabla de alertas para reimplementación futura.

drop table if exists public.alerts cascade;
