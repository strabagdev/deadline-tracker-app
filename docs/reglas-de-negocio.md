# Reglas de negocio

Este documento consolida reglas funcionales relevantes del sistema para que no queden
dispersas solo entre migraciones SQL, APIs y frontend.

## Reglas transversales

### Multi-tenant

- Los datos de negocio deben pertenecer a una organización activa.
- Ningún recurso de una organización debe poder referenciar recursos de otra organización.
- Las validaciones de aplicación deben respetar siempre `organization_id`.
- Cuando una regla sea crítica para integridad, debe existir también a nivel base de datos y no solo en la API.

### Organización activa requerida

- Las operaciones de negocio requieren una organización activa para el usuario autenticado.
- Si el usuario no tiene organización activa, la API debe responder con error funcional y no continuar la operación.
- Esta regla aplica transversalmente a módulos como entidades, tipos, vencimientos, uso y reportes.

### Accesos y permisos

- Ver un módulo no implica necesariamente poder administrarlo.
- Las operaciones de escritura requieren además un rol con privilegios suficientes.
- Varias operaciones administrativas requieren rol `admin` u `owner`.
- Algunas operaciones organizacionales son exclusivas de `owner`.
- Un usuario no debe poder remover su propio acceso en flujos administrativos cuando eso deje el control inconsistente.

### Convención de errores funcionales

- La API debe preferir errores explícitos y accionables antes que mensajes técnicos genéricos.
- Cuando una operación falla por regla de negocio, el mensaje debe explicar la causa funcional.
- Cuando sea útil, la respuesta debe incluir un `code` estable para que frontend y soporte puedan interpretarlo.

### Desactivación vs borrado

- Cuando un recurso participa en operación o historial, se prefiere desactivar antes que borrar físicamente.
- Este criterio ya aplica al menos a:
  - tipos de vencimiento
  - unidades de uso en escenarios no forzados

## Entidades

### Identidad y unicidad

- Dentro de una misma organización, no pueden existir dos entidades con el mismo nombre dentro del mismo tipo de entidad.
- La comparación considera equivalentes diferencias de mayúsculas/minúsculas y espacios al inicio o final.
- Si existen duplicados históricos, la migración de unicidad debe fallar con detalle para obligar limpieza previa.

Implementación relacionada:
- [041_entities_unique_name_per_type.sql](/home/dannysilver/dev2026/deadline-tracker/supabase/041_entities_unique_name_per_type.sql)

### Datos mínimos

- Una entidad requiere al menos `name` y `entity_type_id`.
- Si una entidad usa unidad de uso, la unidad debe ser válida dentro de la organización activa.
- Si una entidad no trabaja con uso, puede quedar sin `usage_unit_id`.

## Vencimientos

### Tipos de vencimiento

- Los tipos de vencimiento son por organización.
- Cada tipo de vencimiento debe indicar cómo se mide:
  - `date`
  - `usage`
- El atributo `requires_document` forma parte de la configuración del tipo.

### Ciclo de vida de tipos de vencimiento

- El borrado de tipos de vencimiento es lógico, no físico.
- Al eliminar un tipo de vencimiento desde la API, el sistema lo desactiva con `is_active = false`.
- Esto permite conservar trazabilidad histórica y evitar pérdida de referencias.

Implementación relacionada:
- [deadline-types/route.ts](/home/dannysilver/dev2026/deadline-tracker/src/app/api/deadline-types/route.ts)

### Reglas para vencimientos medidos por fecha

- Si un vencimiento se mide por fecha, debe existir `next_due_date`.

### Reglas para vencimientos medidos por uso

- Si un vencimiento se mide por uso, la entidad debe tener `tracks_usage = true`.
- Si un vencimiento se mide por uso, deben existir:
  - `last_done_usage`
  - `frequency`
  - `frequency_unit`
- Si el modo de promedio diario es manual, debe existir `usage_daily_average`.

### Restricción funcional

- No se debe permitir crear ni actualizar un vencimiento basado en uso para una entidad que no registra uso.

## Uso

### Unidades de uso

- Las unidades de uso representan magnitudes operativas como horas, kilómetros, días o ciclos.
- Las unidades de uso se administran por organización.
- Dos organizaciones distintas pueden tener unidades con el mismo nombre.
- Cada unidad puede tener configuración adicional:
  - activa/inactiva
  - visible/no visible en registros de uso
  - valores sugeridos

### Tenant boundary de unidades de uso

- `usage_units` es un catálogo por organización, no global.
- Una entidad solo puede usar una unidad de uso de su misma organización.
- Un campo dinámico de uso solo puede pertenecer a una unidad de uso de su misma organización.
- Si se detectan referencias cruzadas entre organizaciones, la migración de blindaje debe fallar antes de aplicar constraints nuevos.

Implementación relacionada:
- [042_usage_units_tenant_guards.sql](/home/dannysilver/dev2026/deadline-tracker/supabase/042_usage_units_tenant_guards.sql)
- [034_full_schema_bootstrap.sql](/home/dannysilver/dev2026/deadline-tracker/supabase/034_full_schema_bootstrap.sql)

### Campos dinámicos de uso

- Los campos dinámicos de uso pertenecen a una unidad de uso.
- Los campos dinámicos también deben quedar acotados a la misma organización que la unidad de uso.
- La clave funcional de un campo de uso debe ser única dentro de la combinación `organización + unidad de uso`.
- Los tipos válidos de campo de uso son:
  - `text`
  - `number`
  - `date`
  - `boolean`
  - `select`

### Captura de uso

- La captura de uso requiere permiso de módulo `usage_capture`.
- Adicionalmente, puede restringirse por tipo de entidad dentro del módulo.
- Un usuario no debe poder registrar uso para un tipo o una entidad fuera de su alcance.

### Integridad de registros de uso

- Cada registro de uso debe indicar `entity_id`.
- Debe existir un valor principal numérico o textual según el caso de uso.
- Si se informan `field_values`, cada item debe incluir `usage_field_id` y `value`.
- No se permite repetir un mismo `usage_field_id` dentro del mismo payload.
- Un `usage_field_id` solo es válido si pertenece a la unidad de uso de la entidad.

### Tipado de valores dinámicos

- Los campos dinámicos tipo `number` requieren valor numérico.
- Los campos dinámicos tipo `boolean` requieren valor booleano interpretable.
- Los campos dinámicos tipo `date` requieren fecha válida.
- Los campos dinámicos tipo `text` requieren texto no vacío.

### Eliminación de unidades de uso

- Una unidad de uso no debe poder eliminarse si todavía está siendo utilizada.

Bloquean la eliminación:
- entidades que tienen asignada esa unidad
- campos dinámicos asociados a esa unidad
- vencimientos medidos por uso que todavía referencian esa unidad por nombre en `deadlines.frequency_unit`

Comportamiento esperado:
- El sistema debe responder con un mensaje claro y entendible, no con un error técnico genérico.
- El mensaje debe indicar que la unidad no puede eliminarse porque está en uso.
- Cuando sea posible, el mensaje debe indicar qué tipo de uso la está bloqueando.

Implementación relacionada:
- [usage-units/route.ts](/home/dannysilver/dev2026/deadline-tracker/src/app/api/usage-units/route.ts)

### Relación entre vencimientos y unidades de uso

- Los vencimientos medidos por uso todavía almacenan la unidad en `deadlines.frequency_unit` como texto.
- Por eso, el bloqueo de borrado de una unidad de uso respecto de vencimientos hoy se resuelve a nivel aplicación.
- Mientras esa relación siga siendo textual, no existe una FK directa desde `deadlines` hacia `usage_units`.

Implicancias:
- Cambiar el nombre de una unidad no equivale automáticamente a migrar textos históricos en vencimientos.
- Antes de normalizar esta relación, cualquier validación sobre uso en vencimientos debe considerar coincidencia por nombre.

## Criterio de mantenimiento

- Si una regla afecta integridad de datos, debe evaluarse primero si corresponde reforzarla con constraint SQL.
- Si una regla afecta experiencia de usuario o flujo operativo, debe existir también un mensaje claro a nivel API/frontend.
- Cuando una regla nueva cambie el comportamiento esperado, este documento debe actualizarse.
