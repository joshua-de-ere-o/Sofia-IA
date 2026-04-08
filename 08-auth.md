# 08 — Autenticación

## Estrategia

Dos capas de acceso al CRM:

1. **Login inicial:** Supabase Auth con correo electrónico (magic link o password).
2. **Acceso rápido posterior:** PIN de 4 dígitos.

## Flujo

### Primer Acceso

1. Kelly entra a `/login`.
2. Ingresa correo → Supabase Auth envía magic link (o usa password).
3. Al autenticarse, el sistema pide crear un PIN de 4 dígitos.
4. PIN se guarda hasheado en tabla `user_settings`.
5. Sesión de Supabase Auth persiste por meses (refresh token).

### Accesos Posteriores

1. Si la sesión de Supabase Auth sigue activa → mostrar pantalla de PIN.
2. Kelly ingresa PIN de 4 dígitos.
3. Verificar contra hash en `user_settings`.
4. Si correcto → acceso al dashboard.
5. Si incorrecto 3 veces → cerrar sesión, pedir login completo.

### Sesión Expirada

1. Si el refresh token de Supabase Auth expiró → redirigir a login completo.
2. Tras autenticarse → pantalla de PIN.

## Tabla `user_settings`

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | PK, FK → auth.users |
| pin_hash | text | bcrypt hash del PIN |
| pin_intentos_fallidos | int | Default 0, reset a 0 tras éxito |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## Seguridad

- PIN hasheado con bcrypt — nunca en texto plano.
- Máximo 3 intentos fallidos → lockout (requiere login completo).
- RLS en todas las tablas: solo el usuario autenticado accede a sus datos.
- Solo un usuario tiene acceso (Dra. Kely) — no hay multi-tenancy en V1.

## Variables de Entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # solo server-side
```
