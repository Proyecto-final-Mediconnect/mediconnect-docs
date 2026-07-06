# ENG-40 — Spike: Exploración de Supabase Auth

**Épica:** EP-01 (Gestión de Identidad y Acceso) · **Sprint 1** · **3 SP** · **Tipo:** Spike
**Autor:** Ignacio Patriarca

## Objetivo

Entender en profundidad el comportamiento de Supabase Auth para los flujos
de registro, verificación de email, login y refresh token, antes de
implementar el módulo de autenticación (ENG-42 y siguientes).

Este documento responde los tres criterios de aceptación de la issue:

1. Documentar el flujo completo de JWT + refresh token rotativo.
2. Validar que el JWT de Supabase se puede verificar en el backend NestJS
   sin llamar a Supabase en cada request.
3. Identificar las limitaciones del plan Free relevantes para el proyecto.

---

## 1. Flujo completo de JWT + refresh token rotativo

### 1.1 Registro y verificación de email

Con **"Confirm email" habilitado** en el proyecto Supabase (configuración
que usará el proyecto):

1. El cliente llama `supabase.auth.signUp({ email, password })`.
2. Supabase crea la fila en `auth.users` con `email_confirmed_at = null` y
   dispara el email de confirmación. **La respuesta no trae sesión**
   (`session: null`): el usuario existe pero todavía no puede loguearse.
3. El link del email confirma la cuenta (marca `email_confirmed_at`) y
   redirige al frontend. Recién ahí el usuario puede obtener una sesión.

Consecuencia: mientras el email no está verificado, **no hay sesión y por
lo tanto no hay JWT válido** — el criterio "sin verificar el email no se
permiten operaciones críticas" queda cubierto por el propio flujo, sin
lógica extra.

### 1.2 Login

`supabase.auth.signInWithPassword({ email, password })` devuelve una sesión:

| Campo | Qué es |
|---|---|
| `access_token` | JWT de corta duración (default 1 h). Se envía en `Authorization: Bearer <token>`. |
| `refresh_token` | String opaco de un solo uso, sin expiración fija. |
| `user` | `id` (UUID, = `profiles.id`), `email`, `app_metadata`, etc. |

### 1.3 Refresh token rotativo

- La **rotación está habilitada por defecto** en todo proyecto Supabase.
- Cada refresh token es de **un solo uso**: al canjearlo, Supabase devuelve
  un par nuevo (access + refresh) y el anterior queda inválido.
- Hay una **ventana de gracia de 10 segundos**: si el token padre se
  reintenta dentro de esos 10 s (dos pestañas refrescando a la vez, etc.),
  Supabase devuelve la sesión activa en vez de rechazar.
- **Detección de reuso:** si se usa un refresh token viejo fuera de esa
  ventana, Supabase lo interpreta como robo y **revoca toda la cadena de
  tokens** de esa sesión (logout forzado).

Para los clientes (web/mobile): no implementar el refresh a mano; delegar
en el auto-refresh de `supabase-js`. Nunca loguear el refresh token; en web
preferir cookie `httpOnly`.

---

## 2. Verificar el JWT en NestJS sin llamar a Supabase por request

**Sí es posible y es el enfoque recomendado.** Se logra usando **claves de
firma asimétricas (ES256)** en vez del secreto compartido legacy (HS256):

1. En el proyecto Supabase, usar signing keys asimétricas (Dashboard →
   Auth → Signing Keys). Solo Supabase tiene la clave privada; el backend
   solo necesita la **clave pública**.
2. El backend obtiene la clave pública del endpoint de descubrimiento:
   `GET https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
3. Con eso, cada request se valida **localmente** (firma ES256 contra la
   clave pública cacheada), sin round-trip a Supabase. El endpoint JWKS ya
   cachea 10 min en el edge; la librería cachea otro tanto en memoria.

Implementación sugerida con `jose` (no requiere el SDK de Supabase):

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

async function verifySupabaseJwt(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
  });
  return payload; // payload.sub === profiles.id
}
```

`createRemoteJWKSet` maneja el cacheo y el refetch automático cuando aparece
un `kid` desconocido (rotación de claves), así que no hay que
reimplementarlo.

#### Validación empírica (realizada)

Se validó con las manos contra el proyecto real `mediconnect-dev`
(script `mediconnect-backend/scripts/verify-jwt.mjs`): login real →
access token → verificación local con `jose` + JWKS. Resultado:

- El JWKS endpoint devuelve una clave **ES256** (asimétrica), confirmando
  que el proyecto no usa el secreto compartido HS256.
- El access token se **verifica localmente sin llamar a Supabase Auth**; el
  claim `sub` coincide con el `profiles.id` creado por el trigger.
- Un token manipulado es **rechazado** por firma inválida.
- Confirmado en vivo: el claim `role` del JWT trae el rol de Postgres
  (`authenticated`), **no** el rol de negocio — hay que sincronizar
  `profiles.role` a `app_metadata` para leerlo desde el guard.

**Nota sobre el rol:** `payload.sub` es el mismo UUID que `profiles.id`. El
rol de negocio (`PACIENTE` / `PROFESIONAL` / `MODERADOR`) **no** viaja en el
JWT por default. Para que el guard de NestJS lo lea sin ir a la base en cada
request, hay que sincronizarlo a `app_metadata` (trigger de Postgres o Auth
Hook de Supabase).

**Alternativa descartada:** secreto compartido HS256 — funciona, pero un
secreto comprometido permite firmar tokens válidos indefinidamente y rotarlo
exige coordinar downtime. Supabase ya no lo recomienda para proyectos nuevos.

---

## 3. Limitaciones del plan Free relevantes

| Límite | Valor Free | Impacto en MediConnect |
|---|---|---|
| Emails de auth (SMTP interno) | **2 por hora** | Se agota apenas el equipo empieza a probar registro/verificación. **Recomendación: configurar SMTP custom (ej. Resend) desde el arranque de ENG-42.** |
| Cooldown por usuario (signup/recovery) | 60 s | Los tests que reintenten registro con el mismo email deben espaciarse o usar emails únicos. |
| Refresh token | 1800 req/h por IP | Suficiente para dev/demo; vigilar e2e masivos desde una sola IP en CI. |
| Verificación (`/verify`) | 360 req/h por IP | Sin impacto esperado. |
| MFA | 15 req/h por IP | Sin impacto en Sprint 1 (MFA es de un sprint posterior). |
| MAU (usuarios activos/mes) | 50.000 | Muy por encima de lo necesario. |
| Proyectos activos simultáneos | 2 | Alcanza para dev + staging/demo; sin margen para un tercero sin pausar alguno. |
| Pausa por inactividad | a los 7 días sin uso | **Riesgo real entre sprints o semanas de parcial**: hay que reactivar el proyecto manualmente antes de una demo. |
| SSO (SAML) / MFA por SMS | No incluido | Sin impacto — fuera del alcance del MVP. |

---

## 4. Conclusiones para la implementación (ENG-42)

1. **Detección de email ya existente sin filtrar información:** al llamar
   `signUp` con un email ya registrado y confirmado, Supabase **no devuelve
   error** — responde `error: null` con un usuario ofuscado que tiene
   `identities: []` (array vacío). El backend debe responder el mismo
   mensaje genérico de éxito en ambos casos (alta nueva o email duplicado),
   sin distinguirlos. Esto resuelve directamente el criterio de ENG-42 "si
   el email ya existe, se informa sin revelar si hay cuenta registrada".

   ```typescript
   const { data, error } = await supabase.auth.signUp({ email, password });
   if (error) throw new BadRequestException(error.message);
   // éxito real o email ya existente → misma respuesta:
   return { message: 'Revisá tu email para continuar el registro.' };
   ```

2. Configurar **SMTP custom** antes de empezar a testear (límite de 2
   emails/hora).
3. Usar **JWT asimétrico (ES256) + verificación local con `jose` + JWKS**,
   sin llamar a Supabase por request.
4. Sincronizar `profiles.role` a `app_metadata` para el guard de roles.
5. No implementar lógica propia de rotación/expiración de refresh token: el
   comportamiento default de Supabase ya lo cubre; los clientes delegan en
   `supabase-js`.

{{references}}
JSON Web Token (JWT) — Supabase Docs, https://supabase.com/docs/guides/auth/jwts
JWT Signing Keys — Supabase Docs, https://supabase.com/docs/guides/auth/signing-keys
User sessions — Supabase Docs, https://supabase.com/docs/guides/auth/sessions
Rate limits — Supabase Docs, https://supabase.com/docs/guides/auth/rate-limits
Supabase Pricing, https://supabase.com/pricing
JavaScript: signUp — Supabase Docs, https://supabase.com/docs/reference/javascript/auth-signup
{{/references}}
