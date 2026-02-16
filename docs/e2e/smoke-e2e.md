# Smoke E2E

Prueba rápida de flujo crítico end-to-end:

1. Login superadmin
2. Crear organización
3. Asignar owner
4. Login owner
5. Set active org
6. Crear tipo de entidad
7. Crear entidad
8. Crear tipo de vencimiento
9. Crear vencimiento
10. Verificar dashboard

## Variables requeridas

- `SMOKE_SUPERADMIN_EMAIL`
- `SMOKE_SUPERADMIN_PASSWORD`
- `SMOKE_OWNER_EMAIL`
- `SMOKE_OWNER_PASSWORD`

Opcional:

- `SMOKE_BASE_URL` (default: `http://localhost:3000`)

Nota: el script lee `.env.local` automáticamente para tomar `NEXT_PUBLIC_SUPABASE_AUTH_URL` y `NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY`.

## Ejecución

Con la app corriendo local:

```bash
npm run smoke:e2e
```

Si quieres apuntar a otra URL:

```bash
SMOKE_BASE_URL=http://localhost:3000 npm run smoke:e2e
```

## Resultado esperado

- Mensaje final `Smoke E2E OK`
- IDs creados impresos en JSON (org, entity type, entity, deadline type)
