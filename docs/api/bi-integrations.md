# BI Integrations API (Power BI / Externos)

Este módulo permite administrar endpoints de exportación por organización desde:

- UI: `/app/bi-integrations`
- Admin API: `/api/reporting/endpoints`
- Endpoint externo: `/api/reporting/external/[slug]?token=...`

## 1) Flujo recomendado

1. Crear endpoint en `Integraciones BI` (elige dataset).
2. Copiar URL generada.
3. Consumir desde Power BI (Web connector) u otra herramienta.
4. Si se compromete la URL, rotar token.

## 2) Seguridad

- El endpoint externo se autoriza por `slug + token` (query param).
- Puede desactivarse sin eliminarlo (`is_active = false`).
- El token puede rotarse sin cambiar el slug.
- El acceso al módulo de administración usa RBAC (`bi_integrations`).

## 3) Endpoints de administración (internos)

Requieren sesión autenticada y rol `owner|admin` de la organización activa.

### `GET /api/reporting/endpoints`

Devuelve datasets disponibles y endpoints configurados:

```json
{
  "datasets": [{ "key": "usage_logs_flat", "label": "Registros de uso (plano BI)" }],
  "endpoints": [
    {
      "id": "uuid",
      "slug": "alpha-signal",
      "label": "Uso diario",
      "dataset_key": "usage_logs_flat",
      "endpoint_token": "token",
      "is_active": true
    }
  ]
}
```

### `POST /api/reporting/endpoints`

Crea endpoint:

```json
{
  "label": "Uso diario",
  "dataset_key": "usage_logs_flat"
}
```

Notas:
- `slug` se genera automáticamente (formato `palabra-palabra`).
- `token` se genera automáticamente.

### `PUT /api/reporting/endpoints?id={id}`

Actualiza endpoint:

```json
{
  "label": "Nuevo nombre",
  "dataset_key": "usage_logs",
  "is_active": true,
  "rotate_token": false
}
```

Campos opcionales:
- `label`
- `slug`
- `dataset_key`
- `is_active`
- `rotate_token` (`true` para regenerar token)

### `DELETE /api/reporting/endpoints?id={id}`

Elimina endpoint.

## 4) Endpoint externo de consumo

### `GET /api/reporting/external/{slug}?token={token}`

Parámetros comunes:
- `limit` (default `1000`, max `10000`)
- `offset` (default `0`)

Parámetros extra para `usage_logs` y `usage_logs_flat`:
- `date_from` (`YYYY-MM-DD`)
- `date_to` (`YYYY-MM-DD`)

Respuesta:

```json
{
  "meta": {
    "organization_id": "uuid",
    "endpoint_slug": "alpha-signal",
    "dataset_key": "usage_logs_flat",
    "dataset_note": "Incluye columnas planas con prefijos entity_profile__* y usage_field__*.",
    "limit": 1000,
    "offset": 0,
    "returned_rows": 123
  },
  "rows": []
}
```

## 5) Datasets soportados

## `forecast`
- Fuente: `deadline_forecasts`
- Uso: paneles de riesgo/proyección.

## `deadlines_current`
- Fuente: `deadlines` (`is_current = true`)
- Uso: estado actual de vencimientos.

## `usage_logs`
- Fuente: `usage_logs`
- Incluye:
  - valor principal (`value`, `value_text`)
  - `entity_profile` (objeto por fila)
  - `usage_field_values` (objeto por fila)
- Uso: consumo flexible JSON.

## `usage_logs_flat`
- Igual que `usage_logs`, pero aplana los objetos:
  - `entity_profile__campo`
  - `usage_field__campo`
- Uso recomendado para Power BI (modelo tabular).

## 6) Errores comunes

- `UNAUTHORIZED`:
  - token faltante o inválido.
- `FORBIDDEN`:
  - endpoint desactivado.
- `NOT_FOUND`:
  - slug inexistente.
- `BAD_REQUEST`:
  - dataset inválido, parámetros inválidos.

Contrato de error general: `docs/api/error-contract.md`.
