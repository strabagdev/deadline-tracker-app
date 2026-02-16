# RBAC Matrix (Current Baseline)

## Roles
- `super_admin`: gobierno global de plataforma y organizaciones.
- `owner`: gobierno de su organización.
- `admin`: administración operativa de su organización.
- `member`: operación estándar dentro de su organización.
- `viewer`: lectura limitada (en endpoints donde aplique).

## Platform (Global)
- `GET /api/platform/super-admin/public-status`: público.
- `GET /api/platform/super-admin/status`: autenticado, devuelve estado según usuario.
- `POST /api/platform/super-admin/bootstrap`: autenticado, solo cuando no existe super admin.
- `POST /api/platform/super-admin/initialize`: flujo inicial de configuración (bootstrap).
- `GET|POST|DELETE /api/platform/branding`: `super_admin` para mutaciones; lectura disponible para UI autenticada.
- `POST /api/platform/admin/orgs/create`: `super_admin`.
- `DELETE /api/platform/admin/orgs/delete`: `super_admin`.
- `GET|PUT|DELETE /api/platform/admin/orgs`: `super_admin`.
- `POST /api/platform/admin/invite`: `super_admin`.

## Organization / Membership
- `GET /api/orgs`: miembro autenticado (lista membresías propias).
- `GET /api/orgs/active`: miembro autenticado.
- `POST /api/orgs/set-active`: miembro de la org destino.
- `POST /api/orgs/create`: requiere `ALLOW_ORG_BOOTSTRAP=true` + autenticado (endpoint legacy bootstrap).
- `GET /api/orgs/branding`: miembro de org activa.
- `POST|DELETE /api/orgs/branding`: `owner`.

## Members / Invitations (Organization Scope)
- `GET|POST /api/admin/invite`: `owner|admin`.
- `GET /api/admin/members`: `owner|admin`.
- `POST /api/admin/members/remove`: `owner|admin` (no elimina owner).

## Core Domain (Organization Scope)
- `GET /api/dashboard`: miembro.
- `GET|POST|PUT|DELETE /api/deadline-types`: lectura miembro, mutación `owner|admin`.
- `GET|POST|PUT|DELETE /api/deadlines`: miembro (validado por membership y org activa).
- `GET|POST|PUT|DELETE /api/entities`: miembro (validado por membership y org activa).
- `GET|POST /api/entity-types`: lectura miembro, mutación `owner|admin`.
- `GET|POST|PUT /api/entity-fields`: lectura miembro, mutación `owner|admin`.
- `GET|POST|DELETE /api/usage-logs`: miembro.
- `GET|PUT /api/settings/semaphore`: lectura miembro, mutación `owner|admin`.

## Profile / Auth
- `POST /api/profile/sync`: autenticado.
- `POST /api/auth/password-reset/request`: público controlado por rate limits.
- `POST /api/auth/provision-temp-password`: autenticado (sobre usuario de sesión).

## Notes
- Esta matriz documenta el baseline actual de código.
- Avance Sprint 1: helper central implementado en `src/lib/server/orgAccess.ts`.
- Endpoints ya migrados al helper: `entity-types`, `entity-fields`, `deadline-types`, `settings/semaphore`.
- Pendiente: migrar progresivamente el resto de endpoints de dominio para eliminar duplicación de checks.
