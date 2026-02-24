-- Refresh de entidades (sin tocar tipos, unidades ni configuración).
-- Reemplaza los UUID antes de ejecutar.
--
-- Notas:
-- - Mantiene la validación de borrado uno-a-uno en la app para uso normal.
-- - Esto es para limpieza masiva controlada desde SQL.
-- - Las tablas relacionadas se limpiarán según FKs/cascada.

-- =========================================
-- A) Preview de entidades a eliminar (ORG)
-- =========================================
select id, name, entity_type_id, created_at
from public.entities
where organization_id = 'TU_ORG_ID'
order by created_at desc;

-- =========================================
-- B) Delete masivo por organización
-- =========================================
begin;

delete from public.entities
where organization_id = 'TU_ORG_ID';

commit;
-- Para probar sin confirmar, reemplaza commit por rollback.

-- =========================================
-- C) Delete masivo por tipo (opcional)
-- =========================================
-- begin;
--
-- delete from public.entities
-- where organization_id = 'TU_ORG_ID'
--   and entity_type_id = 'TU_ENTITY_TYPE_ID';
--
-- commit;

