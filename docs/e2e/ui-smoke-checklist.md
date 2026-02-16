# UI Smoke Checklist

Checklist manual (rápida) para validar UX + flujos críticos después de cada despliegue.

## 1) Super Admin (scope global)

- Login con cuenta super admin.
- Verificar redirección a `/app/super-admin`.
- Verificar que no accede a vistas de organización (`/app`, `/app/entities`) sin ser bloqueado.
- Crear organización nueva.
- Asignar owner por email existente en Auth.

## 2) Owner / Admin de Organización

- Login owner.
- Seleccionar organización activa.
- Crear tipo de entidad.
- Crear entidad.
- Crear tipo de vencimiento.
- Asignar vencimiento a entidad.
- Verificar entidad y estado en dashboard.

## 3) Invitaciones

- Invitar miembro desde panel owner/admin.
- Invitar usuario global desde panel super admin.
- Validar que usuario invitado queda con membership correcto (org + rol).

## 4) Branding

- Cambiar logo de plataforma (super admin).
- Cambiar logo de organización (owner).
- Verificar render correcto en header y login.

## 5) Resilience UX (mobile/tablet)

- Dashboard en ancho ~390px (móvil): sin cortes críticos de acciones.
- Dashboard en ancho ~768px (tablet): filtros y estados utilizables táctilmente.
- Lista de entidades: scroll y densidad correctos.
