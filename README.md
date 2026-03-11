# Deadline Tracker

Aplicación Next.js con Supabase Auth para acceso por invitación, restablecimiento de contraseña y membresías por organización.

## Desarrollo

```bash
npm install
npm run dev
```

## Variables de entorno

Define la URL pública de la app con una de estas variables:

```env
SITE_URL=https://tu-dominio.com
APP_URL=https://tu-dominio.com
```

Compatibilidad heredada:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Prioridad actual en servidor:

1. `SITE_URL`
2. `APP_URL`
3. `NEXT_PUBLIC_APP_URL`
4. origen inferido del request

Para Resend:

```env
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL=no-reply@tu-dominio.com
RESEND_FROM_NAME=Deadline Tracker
```

## Supabase Auth en este proyecto

Usos actuales detectados:

- `signInWithPassword`
  - [src/app/login/page.tsx](/home/dannysilver/dev2026/deadline-tracker/src/app/login/page.tsx)
- `signUp`
  - [src/app/login/page.tsx](/home/dannysilver/dev2026/deadline-tracker/src/app/login/page.tsx)
- `signInWithOAuth`
  - [src/app/login/page.tsx](/home/dannysilver/dev2026/deadline-tracker/src/app/login/page.tsx)
- `inviteUserByEmail`
  - [src/app/api/admin/invite/route.ts](/home/dannysilver/dev2026/deadline-tracker/src/app/api/admin/invite/route.ts)
  - [src/app/api/platform/admin/invite/route.ts](/home/dannysilver/dev2026/deadline-tracker/src/app/api/platform/admin/invite/route.ts)
- `resetPasswordForEmail`
  - [src/app/api/auth/password-reset/request/route.ts](/home/dannysilver/dev2026/deadline-tracker/src/app/api/auth/password-reset/request/route.ts)
- `signInWithOtp`
  - [src/app/login/page.tsx](/home/dannysilver/dev2026/deadline-tracker/src/app/login/page.tsx)

### Estrategia actual de acceso

El login quedó orientado a SaaS B2B:

1. `Microsoft OAuth`
2. `Google OAuth`
3. `Correo + contraseña`
4. `Magic link` como respaldo

Esto reduce la dependencia de entrega de correos en entornos corporativos con filtros estrictos.

### `redirectTo`

Todos los flujos que envían correo desde Supabase Auth quedaron centralizados así:

- invitaciones: `SITE_URL|APP_URL|NEXT_PUBLIC_APP_URL + /auth/callback`
- reset password: `SITE_URL|APP_URL|NEXT_PUBLIC_APP_URL + /reset-password`
- sign up por contraseña: `SITE_URL|APP_URL|NEXT_PUBLIC_APP_URL + /auth/callback`
- OAuth Google / Microsoft: `SITE_URL|APP_URL|NEXT_PUBLIC_APP_URL + /auth/callback`

Helper usado:

- [publicAppOrigin.ts](/home/dannysilver/dev2026/deadline-tracker/src/lib/server/publicAppOrigin.ts)

### Resend + Supabase Auth

Cuando `RESEND_API_KEY` y `RESEND_FROM_EMAIL` están configuradas:

- las invitaciones generan el link con `auth.admin.generateLink({ type: "invite" })`
- el reset password genera el link con `auth.admin.generateLink({ type: "recovery" })`
- el correo se envía con Resend desde la app

Cuando Resend no está configurado:

- se mantiene el envío nativo de Supabase Auth

## Callback de autenticación

La ruta que recibe magic links e invitaciones ya existe:

- [src/app/auth/callback/page.tsx](/home/dannysilver/dev2026/deadline-tracker/src/app/auth/callback/page.tsx)

Qué hace:

1. Lee `code` o `token_hash` desde la URL.
2. Intercambia/verifica el token con Supabase Auth.
3. Sincroniza perfil local.
4. Provisiona contraseña provisoria si corresponde a una invitación.
5. Redirige a `select-org`, `setup-super-admin` o `app/super-admin`.

Este callback sirve para:

- Google OAuth
- Microsoft OAuth
- magic link
- invitaciones
- confirmación posterior a `signUp` si el proyecto exige confirmación de correo

## Configuración OAuth en Supabase

### Google

En `Supabase Dashboard -> Authentication -> Providers -> Google`:

1. Habilita `Google`.
2. Crea un OAuth Client en Google Cloud.
3. Usa como redirect/callback URL la que te entrega Supabase para el provider.
4. Configura los orígenes/autorizados también para tu dominio público.

Redirects de aplicación a mantener:

- `https://app.opsahead.cl/auth/callback`

### Microsoft

En `Supabase Dashboard -> Authentication -> Providers -> Azure`:

1. Habilita `Azure`.
2. Registra la app en Microsoft Entra ID / Azure AD.
3. Usa la callback URL del provider que Supabase indica.
4. Configura tenant, client id y client secret en Supabase.

Redirects de aplicación a mantener:

- `https://app.opsahead.cl/auth/callback`

## Registro con contraseña

Para un flujo SaaS B2B donde no quieres depender del correo para entrar:

1. Revisa en `Supabase Dashboard -> Authentication -> Providers -> Email`
2. Decide si `Confirm email` estará:
   - activado: el usuario deberá confirmar email tras `signUp`
   - desactivado: el usuario podrá entrar inmediatamente con correo + contraseña

Recomendación operativa:

- si el acceso principal será `SSO + contraseña`, desactivar confirmación de email simplifica onboarding
- si necesitas verificación fuerte de email, déjala activa y comunica que el correo sigue siendo un paso auxiliar, no el método principal de login

## SMTP externo en Supabase

Este proyecto sigue usando Supabase Auth para:

- invitaciones
- magic links
- recovery / reset password

Este proyecto ahora puede enviar correos de invitación y recovery con Resend desde la app, pero también puedes seguir usando SMTP externo en Supabase Dashboard si prefieres que Supabase entregue sus propias plantillas.

Si quieres usar tu propio proveedor SMTP (por ejemplo Resend), configúralo directamente en Supabase Dashboard:

1. Abre tu proyecto en Supabase.
2. Ve a `Authentication`.
3. Entra a `Email Settings` o `SMTP Settings`.
4. Desactiva el proveedor por defecto si aplica.
5. Configura tu SMTP externo con:
   - host
   - port
   - username
   - password / API key SMTP
   - sender name
   - sender email
6. Guarda y prueba los templates de:
   - Invite
   - Magic Link
   - Reset Password

### Ejemplo con Resend SMTP

Valores típicos:

- host: `smtp.resend.com`
- port: `465` o `587`
- username: `resend`
- password: API key SMTP de Resend

Antes de probar:

1. Verifica el dominio/remitente en Resend.
2. Agrega en Supabase Auth las Redirect URLs válidas:
   - `https://tu-dominio.com/auth/callback`
   - `https://tu-dominio.com/reset-password`
3. Asegúrate de que `SITE_URL` o `APP_URL` coincida con el dominio público real.

## Notas operativas

- Si cambias de dominio, actualiza `SITE_URL` / `APP_URL` y las Redirect URLs de Supabase Auth.
- Si usas Vercel o un proxy, el servidor también puede inferir el host desde `x-forwarded-host` y `x-forwarded-proto`.
- Si activas Resend en código, el SMTP configurado en Supabase ya no participa en invitaciones y recovery de este proyecto.
