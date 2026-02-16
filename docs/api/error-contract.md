# API Error Contract

Todas las rutas de `src/app/api` deben responder errores con este formato:

```json
{
  "error": "mensaje legible",
  "code": "ERROR_CODE"
}
```

## Reglas

- `error`: texto para mostrar/loggear.
- `code`: clave estable para lógica de frontend.
- Mantener `status` HTTP coherente con `code`.

## Codes estándar

- `BAD_REQUEST` -> `400`
- `UNAUTHORIZED` -> `401`
- `FORBIDDEN` -> `403`
- `NO_ACTIVE_ORGANIZATION` -> `400`
- `INTERNAL_ERROR` -> `500`

## Codes de dominio (ejemplos)

- `ENTITY_NOT_FOUND`
- `DEADLINE_NOT_FOUND`
- `DEADLINE_TYPE_NOT_FOUND`
- `DEADLINE_TYPE_INACTIVE`
- `MEMBER_NOT_FOUND`
- `OWNER_NOT_FOUND`
- `LAST_OWNER`
- `ORGANIZATION_NOT_FOUND`
- `AUTH_USER_NOT_FOUND`

## Criterio

- Si el error representa validación de entrada, usar `BAD_REQUEST`.
- Si representa permisos, usar `FORBIDDEN` o `UNAUTHORIZED`.
- Si representa ausencia de recurso, usar `*_NOT_FOUND`.
- Excepciones no controladas deben caer en `INTERNAL_ERROR`.
