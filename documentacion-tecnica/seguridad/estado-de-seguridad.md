# Estado de seguridad frente al Sprint 0

- **Issue:** [ENG-167](https://linear.app/summercamp-pasantes/issue/ENG-167) · Backlog técnico transversal
- **Fecha de corte:** 09/11/2026 (filas 16 y 18 actualizadas; el resto, verificado al 04/11)
- **Contra qué se verificó:** `main` de cada repo — backend `ba8f345`, web `4cb648f`,
  mobile `069f4f2` — más los PRs mergeados, Linear y, donde se indica, el entorno de
  producción.
- **Fuentes del compromiso:** Sprint 0 §4.8, §5.3.2 y §5.5; Estudio Inicial §4.5.

El Sprint 0 promete más de lo que el sistema hace hoy en algunos puntos, y menos en
otros. Este documento registra la diferencia, compromiso por compromiso, con la
evidencia de cada estado. La idea es que cualquier pregunta de la defensa sobre
seguridad tenga acá una respuesta que se pueda señalar.

## Cómo leer la tabla

| Estado | Significa |
|---|---|
| **Cumplido** | Se hace lo que dice el Sprint 0. |
| **Cumplido distinto** | Se cumple el objetivo con otra herramienta o con otro valor. La justificación está en la fila. |
| **Parcial** | Una parte está hecha y otra no. La fila dice cuál. |
| **Pendiente** | No está hecho. Si hay ticket o PR abierto, se indica. |
| **Superado** | Va más allá de lo que el Sprint 0 prometía. |

Abreviaturas de los enlaces: `backend#N`, `web#N` y `mobile#N` son PRs de cada repo;
`ENG-N` es el ticket de Linear.

## Resumen

| Estado | Cantidad |
|---|---|
| Cumplido | 15 |
| Cumplido distinto | 7 |
| Parcial | 6 |
| Pendiente | 4 |
| Superado | 1 |
| **Total de compromisos** | **33** |

Los **pendientes** son: revisión de seguridad por dos developers (§4.8.2), checklist de
cierre de release (§4.8.3), pre-commit hook con gitleaks (§5.5.5) y rotación semestral
de secretos (§5.5.5).

Además hay controles que el Sprint 0 no pedía, o que dejaba fuera del MVP, y que
están hechos: ver [Lo que va más allá del Sprint 0](#lo-que-va-más-allá-del-sprint-0).

## Compromisos y estado

### §4.8.1 — Checks automáticos de seguridad en CI

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 1 | `npm audit` en cada PR; con *high* o *critical* el build falla y el merge se bloquea. | Cumplido distinto | `security.yml` en [backend](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/.github/workflows/security.yml), [web](https://github.com/Proyecto-final-Mediconnect/mediconnect-web/blob/main/.github/workflows/security.yml) y [mobile](https://github.com/Proyecto-final-Mediconnect/mediconnect-mobile/blob/main/.github/workflows/security.yml) · backend#85, web#55 ([ENG-166](https://linear.app/summercamp-pasantes/issue/ENG-166)) | Backend y web usan `pnpm audit --prod --audit-level=high` (el gestor del repo); mobile, `npm audit --omit=dev`. Corre en cada PR, en `main`, en `release/**` y en un cron semanal. **En los PRs del backend solo avisa** (`continue-on-error`): una CVE publicada hoy sobre una dependencia que el PR no tocó no puede trabar trabajo ajeno. En `main`, `release/**` y el cron sí falla. |
| 2 | TruffleHog en cada PR para detectar secretos. | Cumplido distinto | Job `secrets` de los mismos `security.yml` · backend#85, web#55 | Se usa **gitleaks** (binario, sobre los commits del PR, con los secretos tapados en el log). La action oficial de TruffleHog y la de gitleaks piden licencia paga en repos de organizaciones; el binario de gitleaks no. Cubre lo mismo. |
| 3 | ESLint con plugin de seguridad. | Parcial | [`eslint.config.mjs` del backend](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/eslint.config.mjs) (`eslint-plugin-security`, backend#85) | Está en el backend, que es donde están SQL, `eval` y redirecciones. **Web y mobile no lo tienen.** `detect-object-injection` está apagada en el backend: eran 22 falsos positivos y cero casos reales. |
| 4 | Tests de RLS en integración en cada PR a `release/*`. | Superado | [`integration-tests.yml`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/.github/workflows/integration-tests.yml) · p. ej. [`chat-rls.integration.spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/chat-rls.integration.spec.ts), [`clinical-records.integration.spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/clinical-records.integration.spec.ts) | Corren en **todo** PR y en cada push a `main` y `release/**`, no solo en los PRs a release, contra un Postgres 15 real. |

### §4.8.2 — Revisión manual de seguridad en PRs

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 5 | Los PRs que tocan RLS, guards, endpoints con datos clínicos o PII, el token MediPass o el schema de tablas clínicas los revisan **dos** developers. | Pendiente | Ruleset de `main` (1 aprobación, ENG-127) · muestra: backend#43, #47, #62, #63, #68, #80, #85, #102 y #103 tienen **una** aprobación cada uno | GitHub no permite exigir más aprobaciones según los archivos tocados, y nadie lo aplicó a mano. Opciones: subir el ruleset del backend a 2 aprobaciones, o aplicarlo como convención para los PRs con label `seguridad`, igual que se hace con los ADR en este repo. |

### §4.8.3 — Checklist de seguridad al cierre de cada release

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 6 | Antes de mergear `release/*` a `main` se completa el checklist en el PR de release. | Pendiente | Release 1.0.0 (backend#13), 1.2.0 (backend#39) y 2.0.0 (backend#58) se mergearon sin el checklist | Desde este PR existe la plantilla: [`checklist-cierre-de-release.md`](checklist-cierre-de-release.md). Se usa por primera vez en la release 3.0.0. |

### §5.3.2 — Integridad

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 7 | Cadena de hash SHA-256 sobre cada entrada de HC, enlazada con la anterior del mismo paciente (ADR-014). | Cumplido | [`hash-chain.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/common/hash-chain/hash-chain.ts) · backend#43 ([ENG-57](https://linear.app/summercamp-pasantes/issue/ENG-57)), backend#47 ([ENG-126](https://linear.app/summercamp-pasantes/issue/ENG-126)), backend#55 y #60 ([ENG-100](https://linear.app/summercamp-pasantes/issue/ENG-100)) | Las correcciones son entradas nuevas que apuntan a la original; la original no se toca. |
| 8 | Append-only con políticas RLS que bloquean `UPDATE` y `DELETE` sobre las tablas críticas. | Cumplido distinto | Migraciones `eng57_clinical_record_chain`, `eng126_clinical_record_hardening`, `eng87_audit_log_append_only` · backend#62 ([ENG-87](https://linear.app/summercamp-pasantes/issue/ENG-87)) | Lo bloquean **triggers**, no políticas RLS: una política no frena al dueño de la tabla ni a un rol con `BYPASSRLS`, un trigger sí. Desde backend#103 el rol del backend además **no tiene el permiso** `UPDATE`/`DELETE` sobre esas tablas (ver fila 18). |
| 9 | Validación periódica de la cadena por un job del backend. | Cumplido | [`integrity-check.yml`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/.github/workflows/integrity-check.yml) (lunes 06:00 UTC) · backend#31 ([ENG-85](https://linear.app/summercamp-pasantes/issue/ENG-85)) · [runbook](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/integrity-check-runbook.md) | Corre en GitHub Actions y no como cron de Nest porque Render Free duerme el proceso. Si falla, avisa a Slack. |
| 10 | Audit log inmutable de **cualquier intento** de acceso. | Parcial | `audit_logs` y `medipass_access_logs` append-only (backend#62) · [`clinical-records.service.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/clinical-records/clinical-records.service.ts) (`recordAccess`) · backend#86 ([ENG-165](https://linear.app/summercamp-pasantes/issue/ENG-165)) · backend#105 ([ENG-145](https://linear.app/summercamp-pasantes/issue/ENG-145)) | Se registran los accesos **concedidos** (lectura de HC, documentos, MediPass) y el paciente los ve. Un intento **denegado** de leer una HC (401/403) no deja fila en `audit_logs`. La hora de cada fila la pone el servidor. |
| 11 | Validación de inputs en runtime con **Zod** en cada endpoint. | Cumplido distinto | [`app.setup.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/app.setup.ts) (`ValidationPipe` global) · DTOs en `src/**/dto/` | `class-validator` + `class-transformer` con `whitelist`, `forbidNonWhitelisted` y `transform`. Ver [Registro del cambio](#registro-del-cambio-zod--class-validator). |

### §5.5.1 — Capa de red y transporte

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 12 | TLS 1.3 obligatorio en todas las comunicaciones. | Cumplido distinto | HSTS de un año con subdominios en la API ([`security-headers.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/common/http/security-headers.ts)) · verificado en producción el 04/11 | Todo va por HTTPS y no hay endpoint en HTTP plano. El TLS lo terminan Cloudflare/Render y Supabase, no el equipo: **aceptan TLS 1.2** (probado con `curl --tls-max 1.2` contra la API y contra Supabase, ambos responden). Exigir solo 1.3 no se puede configurar en los planes Free. TLS 1.2 con los cifrados actuales no tiene ataques prácticos conocidos. |
| 13 | CORS restringido a los orígenes propios. | Cumplido | `enableCors` en [`app.setup.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/app.setup.ts) | Un único origen (`WEB_ORIGIN`) con `credentials`. En producción responde `access-control-allow-origin` con el host de la web y nada más (verificado el 04/11). |
| 14 | Rate limiting global por IP con un interceptor de NestJS. | Cumplido | `ThrottlerModule` + `ClientIpThrottlerGuard` global en [`app.module.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/app.module.ts) · backend#21 ([ENG-44](https://linear.app/summercamp-pasantes/issue/ENG-44)), backend#53 ([ENG-84](https://linear.app/summercamp-pasantes/issue/ENG-84)), backend#71 ([ENG-170](https://linear.app/summercamp-pasantes/issue/ENG-170)) · [`rate-limiting.md`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/rate-limiting.md) | Es un guard, no un interceptor. 60/min por cliente en toda la API, 5/min en login, refresh y recuperación, y un techo global para el canje del MediPass. El cliente se identifica por `CF-Connecting-IP`: con `req.ip` todos los usuarios compartían la IP de Cloudflare. |

### §5.5.2 — Capa de autenticación y autorización

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 15 | JWT con expiración de **15 minutos** y refresh token rotativo. | Cumplido distinto | [`jwt-auth.guard.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/auth/guards/jwt-auth.guard.ts) · [spike ENG-40](../spikes/ENG-40-supabase-auth.md) · [`refresh-token-reuse-risk-plan.md`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/refresh-token-reuse-risk-plan.md) | El access token dura **1 hora**: el default de Supabase, que nadie cambió. El refresh rota en cada uso, pero la detección de reuso de Supabase no funciona como dice su documentación (verificado dos veces). Ver [Sesión y JWT](#sesión-y-jwt). |
| 16 | MFA TOTP opcional para todos, recomendado para profesionales. | Cumplido | backend#110, web#73, mobile#41 ([ENG-88](https://linear.app/summercamp-pasantes/issue/ENG-88)) · migración `eng88_mfa_rls` · backend#112 (deploy) | TOTP opcional con MFA nativo de Supabase, para todos los roles. Con la MFA activa, el backend exige `aal2` y **también la base**: políticas RLS `RESTRICTIVE` (`mfa_ok()`) en 21 tablas, `storage.objects` y `realtime.messages`, así que con la contraseña sola no se lee nada directo de Supabase. Un trigger impide que el usuario apague `mfa_enabled` por PostgREST. Verificado en producción el 09/11. **Falta:** restablecer la contraseña con la MFA activa (hoy responde un error claro y deriva a soporte) y códigos de recuperación. |
| 17 | Row Level Security activa en todas las tablas con datos clínicos. | Cumplido | Migración [`20260710000000_force_rls`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/tree/main/prisma/migrations/20260710000000_force_rls) (`FORCE ROW LEVEL SECURITY`) + políticas por tabla en cada migración · backend#2 ([ENG-37](https://linear.app/summercamp-pasantes/issue/ENG-37)) | Protege lo que los clientes leen directo de Supabase (Realtime del chat, Storage, PostgREST). Lo que pasa por el backend **no** lo filtra RLS: ver fila 18. |
| 18 | Mínimo privilegio en la base: el backend usa un rol propio con acceso solo a lo que necesita; **nadie usa el superusuario en operación normal**. | Parcial | backend#103 ([ENG-138](https://linear.app/summercamp-pasantes/issue/ENG-138), *In Review*) · [`eng138-rol-backend.sql`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/prisma/sql/eng138-rol-backend.sql) · [`rol-backend.md`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/rol-backend.md) · [`backend-role.integration.spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/backend-role.integration.spec.ts) | Lo que mergeó backend#103 es la **parte 1**: el rol `mediconnect_backend` no es dueño de nada (no puede desactivar triggers, hacer DDL ni `TRUNCATE`) y no tiene `UPDATE`/`DELETE` sobre las cinco tablas append-only. **Pero se creó con `BYPASSRLS`**: el título del ticket ("sin BYPASSRLS") todavía no se cumple, porque RLS por usuario desde Prisma es la parte 2, sin ticket propio. Además, crear el rol y cambiar `DATABASE_URL` en Render son **pasos manuales**, y **el 09/11 se verificó en Supabase que el rol `mediconnect_backend` no existe**: el backend sigue conectando como `postgres`. Las migraciones siguen corriendo como `postgres` desde GitHub Actions; eso es esperable y está documentado. |

### §5.5.3 — Capa de datos

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 19 | Cifrado AES-256 en reposo (lo provee Supabase). | Cumplido | Supabase, proyecto en `sa-east-1` | Lo provee el proveedor; el equipo no lo configura. El cifrado a nivel de campo con `pgcrypto` sigue fuera del MVP (Sprint 0 §5.8). |
| 20 | Políticas RLS por tabla, con tests automatizados en CI que verifican que un usuario no lee datos de otro. | Cumplido | Tests de integración que cambian a `authenticated` con `request.jwt.claims` (p. ej. [`chat-rls.integration.spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/chat-rls.integration.spec.ts), [`clinical-records-hardening.integration.spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/clinical-records-hardening.integration.spec.ts)) | Corren en cada PR (fila 4). |
| 21 | Integridad referencial estricta en la base. | Cumplido | [`prisma/schema.prisma`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/prisma/schema.prisma) · [esquema](../../modelo-de-datos/esquema.md) | Claves foráneas en la base, no solo en el ORM. |
| 22 | Append-only sobre `historia_clinica` y `audit_logs`. | Cumplido | Ver fila 8 | También `medipass_access_logs`, `legal_acceptances` e `integrity_checks`. |
| 23 | Cadena de hash SHA-256 con validación periódica. | Cumplido | Ver filas 7 y 9 | — |

### §5.5.4 — Capa de aplicación

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 24 | Validación de inputs con Zod en cada endpoint, antes de procesar. | Cumplido distinto | Ver fila 11 | — |
| 25 | Queries parametrizadas solo con Prisma; prohibido concatenar SQL. | Cumplido | `git grep -E 'queryRawUnsafe\|executeRawUnsafe\|Prisma\.raw\('` sobre `src/` del backend: sin resultados | El SQL crudo que existe usa el tagged template `$queryRaw`, que parametriza. |
| 26 | Sanitización automática del output en JSX. | Cumplido | `git grep dangerouslySetInnerHTML` sobre `src/` de web y mobile: sin resultados | React escapa todo; nadie lo saltea. |
| 27 | CSP estricta en los headers HTTP. | Parcial | API: [`security-headers.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/common/http/security-headers.ts) (helmet, `default-src 'none'`), backend#85, test [`security-headers.e2e-spec.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/test/security-headers.e2e-spec.ts) · Web: [`render.yaml`](https://github.com/Proyecto-final-Mediconnect/mediconnect-web/blob/main/render.yaml), web#55 | **La API sí**: en producción responde con CSP, `X-Frame-Options: DENY`, HSTS y `Cache-Control: no-store` (verificado el 04/11). **La web no**: la CSP está escrita en `render.yaml`, pero el static site no es un Blueprint y Render no lee ese archivo. Hay que cargar los headers a mano en el dashboard (Settings → Headers). El 04/11 la web respondía sin `Content-Security-Policy` ni `X-Frame-Options`. |
| 28 | Un error 500 en producción no expone el stack trace. | Cumplido | `SentryGlobalFilter` en [`app.module.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/app.module.ts) | Extiende el filtro base de Nest, que responde `{"statusCode":500,"message":"Internal server error"}`. El detalle va a Sentry, no al cliente. |

### §5.5.5 — Capa de infraestructura y secretos

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 29 | Secretos solo en variables de entorno de los dashboards de **Vercel** y Render; nunca en el código. | Cumplido distinto | `.env.example` de cada repo (solo nombres) · gitleaks en cada PR (fila 2) | La web se despliega como static site de **Render**, no en Vercel (ver `render.yaml`). Las variables del frontend (`VITE_*`, `EXPO_PUBLIC_*`) son públicas por diseño: solo URLs y la `anon key`. |
| 30 | Pre-commit hook con gitleaks. | Pendiente | Ningún repo tiene `.husky/`, `.pre-commit-config.yaml` ni hook equivalente | La única barrera es el job de CI (fila 2). Un secreto commiteado llega igual al historial de la rama remota antes de que CI lo frene. |
| 31 | TruffleHog en cada PR como segunda línea. | Cumplido distinto | Ver fila 2 (gitleaks) | — |
| 32 | Rotación de secretos semestral, o inmediata ante sospecha de compromiso. | Pendiente | Sin registro de rotaciones | No hay calendario ni registro. Con el proyecto arrancado en julio, la primera rotación semestral vence en enero de 2027. |
| 33 | `npm audit` en CI sobre cada PR, con bloqueo ante vulnerabilidades críticas. | Cumplido distinto | Ver fila 1 | La auditoría corre en CI (fila 1). Dependabot, que abría los PRs de actualización, **se sacó el 13/11** hasta después de la entrega (backend#122, web#84, mobile#51): las actualizaciones se hacen a mano. |

### §5.5.6 — Capa de monitoreo y observabilidad

| # | Compromiso | Estado | Evidencia | Justificación / qué falta |
|---|---|---|---|---|
| 34 | Logs estructurados en **JSON** sin PII. | Parcial | [`request-logger.middleware.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/common/middleware/request-logger.middleware.ts) | **Sin PII sí**: método, path sin query string, status, duración y el `sub` del usuario, nunca body, headers, cookies, token ni email. **JSON no**: es el `Logger` de Nest en texto plano. Para pasarlo alcanza con `new ConsoleLogger({ json: true })`. |
| 35 | Sentry en web, mobile y backend. | Cumplido | [`instrument.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/instrument.ts) y [`sentry.scrubbing.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/config/sentry.scrubbing.ts) · backend#26 ([ENG-97](https://linear.app/summercamp-pasantes/issue/ENG-97)), web#13 ([ENG-98](https://linear.app/summercamp-pasantes/issue/ENG-98)), mobile#13 ([ENG-99](https://linear.app/summercamp-pasantes/issue/ENG-99)) | `sendDefaultPii: false`, scrubbing en `beforeSend`/`beforeBreadcrumb` y sin tracing. |
| 36 | Health check del backend consumido por el cron de ping. | Cumplido | [`health.controller.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/health/health.controller.ts) · [`keepalive.yml`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/.github/workflows/keepalive.yml) | Ping a Render cada 10 minutos y a Supabase cada 3 días (§5.3.3). |
| 37 | Alertas a Slack ante caídas de los servicios principales. | Parcial | [`integrity-alerter.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/integrity/integrity-alerter.ts) · `integrity-check.yml` · repo `mediconnect-backups` ([ENG-108](https://linear.app/summercamp-pasantes/issue/ENG-108)) | A Slack llegan el chequeo de integridad, el ancla del hash y los backups fallidos. **Si el backend se cae, Slack no se entera**: `keepalive.yml` falla en silencio y el aviso queda en las notificaciones de GitHub de quien tocó el workflow. |
| 38 | Audit log de cada acceso a HC y MediPass, en tabla append-only. | Cumplido | Ver fila 10 · backend#68 ([ENG-72/73](https://linear.app/summercamp-pasantes/issue/ENG-72)) | El paciente ve su historial de accesos (ENG-165). |

> Las filas 22, 23, 24, 31 y 33 repiten compromisos que el Sprint 0 escribe en dos
> secciones, y se resuelven en la fila a la que remiten. Por eso el resumen cuenta
> **33** compromisos y no 38.

## Lo que va más allá del Sprint 0

Controles que el Sprint 0 no pedía, o que el §5.8 dejaba explícitamente fuera del
MVP:

| Control | Qué decía el Sprint 0 | Qué hay | Evidencia |
|---|---|---|---|
| Ancla externa del hash | §5.8: "Notarización de cadena de hash — Solo hash interno", fuera del MVP | Una raíz semanal de todas las cadenas, publicada en Slack y en el resumen de GitHub Actions: dos sistemas con credenciales distintas de las de Supabase. Detecta que alguien reescriba la HC y el snapshot en la misma operación. | backend#36 ([ENG-123](https://linear.app/summercamp-pasantes/issue/ENG-123)) · [`chain-anchor.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/integrity/chain-anchor.ts) |
| Endurecimiento de la cadena | §5.3.2: cadena + append-only | Además: `TRUNCATE` bloqueado, funciones `SECURITY DEFINER`, una sola corrección por entrada y serialización de la cabeza ante escrituras concurrentes. | backend#47 ([ENG-126](https://linear.app/summercamp-pasantes/issue/ENG-126)), backend#55 y #60 ([ENG-100](https://linear.app/summercamp-pasantes/issue/ENG-100)) |
| Rol sin propiedad de las tablas | §5.5.2: rol con mínimo privilegio | Aunque una inyección SQL llegara a la base, el rol no podría desactivar los triggers ni borrar la auditoría: le falta el permiso. **Rige recién cuando Render use el rol** (fila 18). | backend#103 ([ENG-138](https://linear.app/summercamp-pasantes/issue/ENG-138)) |
| Backups cifrados con restauración verificada | §5.3.3: `pg_dump` semanal cifrado a un repo privado | Además, cada corrida **restaura** el dump en un Postgres descartable y compara la cantidad de filas, y registra si la cadena estaba íntegra. Cifrado con `age` a una clave pública; la privada no está en GitHub. Retención de 90 días. | [ENG-108](https://linear.app/summercamp-pasantes/issue/ENG-108) · repo privado `mediconnect-backups` |
| Derechos ARCO | §5.2 (Ley 25.326): "endpoints de derecho de acceso (ARCO)" | Exportación de los datos (acceso), preferencias y baja de cuenta (supresión). La HC se conserva 10 años aunque se cierre la cuenta (Ley 26.529, art. 18). | backend#102 ([ENG-86](https://linear.app/summercamp-pasantes/issue/ENG-86)) |
| Constancia de consentimiento | §5.2: flujos de consentimiento en el registro | Aceptación versionada (`LEGAL_VERSION`), con fecha, IP y user-agent, en una tabla append-only, y exigida en cada request autenticado. | backend#63 y #67 ([ENG-140](https://linear.app/summercamp-pasantes/issue/ENG-140)) |
| Hora de servidor en las bitácoras | — | Ninguna bitácora acepta la hora que manda el cliente. | backend#105 ([ENG-145](https://linear.app/summercamp-pasantes/issue/ENG-145)) |
| Headers de seguridad de la API | §5.5.4: CSP | Además de la CSP: `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS y `Cache-Control: no-store` en todas las respuestas, incluidas las de error. | backend#85 ([ENG-166](https://linear.app/summercamp-pasantes/issue/ENG-166)) |

## Registro del cambio: Zod → class-validator

**Qué dice el Sprint 0.** §5.3.2: *"validación de inputs en runtime con Zod en cada
endpoint"*. §5.5.4: *"Validación de inputs con Zod en cada endpoint del backend,
antes de cualquier procesamiento"*. El propio §4.8.3 ya habla de *"validación de
input con Zod/class-validator"*.

**Qué hace el backend.** Un `ValidationPipe` global, configurado en
[`src/app.setup.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/app.setup.ts),
que es lo que llaman tanto `main.ts` como los e2e:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

Cada endpoint declara su body, query o params como un DTO con decoradores de
`class-validator` (`src/**/dto/*.dto.ts`).

| Opción | Efecto |
|---|---|
| `whitelist` | Saca las propiedades que el DTO no declara. |
| `forbidNonWhitelisted` | En vez de sacarlas en silencio, responde **400**. Un campo de más (por ejemplo, `role` en el registro) no llega al servicio. |
| `transform` | Convierte el payload en una instancia del DTO y castea tipos (por ejemplo, un query `?page=2` a número). |

Como el pipe es global, valida antes de que el controller ejecute, en todos los
endpoints. Un endpoint nuevo sin DTO es el único hueco posible, y lo cubre la revisión
del PR. Las variables de entorno se validan con el mismo mecanismo al arrancar
([`env.validation.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/config/env.validation.ts)).

**Por qué cambió.**

- Es el mecanismo nativo de NestJS: el `ValidationPipe` viene con el framework y el
  DTO es a la vez el tipo y las reglas. Con Zod hace falta un pipe propio o sumar una
  librería puente.
- La garantía de seguridad que buscaba el Sprint 0 es la misma: validación en
  runtime, antes de procesar, y rechazo de lo que no está declarado.
  `forbidNonWhitelisted` cubre la asignación masiva, que es el riesgo concreto de un
  backend con Prisma.

**Lo que se pierde.** Zod infiere el tipo TypeScript del schema. Con `class-validator`,
el tipo y las reglas viven en la misma clase pero son dos cosas: se puede declarar
`@IsString()` sobre un campo tipado como `number` y el compilador no avisa. Los tests
e2e de cada endpoint son lo que lo cubre.

## Sesión y JWT

### Cómo valida el backend un token

[`JwtAuthGuard`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/auth/guards/jwt-auth.guard.ts)
toma el token del header `Authorization: Bearer` (mobile) o de la cookie httpOnly
`sb-access-token` (web) y lo verifica **localmente** con `jose` contra el JWKS del
proyecto de Supabase:

- firma **ES256**;
- `iss` igual al del proyecto;
- `aud` igual a `authenticated`;
- `exp` no vencido.

No consulta a Supabase en cada request ([spike ENG-40](../spikes/ENG-40-supabase-auth.md)).
Eso es lo que lo hace rápido, y también lo que explica lo que sigue: **el backend no
sabe si la sesión que emitió el token se cerró**. No mira el claim `session_id`
contra `auth.sessions`.

### Duración

| Token | Duración | Dónde vive |
|---|---|---|
| Access token (JWT) | **1 hora** (default de Supabase; el Sprint 0 decía 15 minutos) | Cookie httpOnly `sb-access-token`, `maxAge` 1 h (web) · `expo-secure-store` (mobile) |
| Refresh token | Opaco, de un solo uso, rota en cada refresh | Cookie httpOnly `sb-refresh-token`, `maxAge` 7 días (web) · `expo-secure-store` (mobile) |

### Qué pasa con un token ya emitido

| Evento | Refresh token | Access token |
|---|---|---|
| **Logout en la web** (`POST /auth/logout`) | El backend borra las cookies del navegador, pero **no revoca la sesión en Supabase**. Una copia del refresh hecha antes del logout sigue sirviendo. | **Sigue valiendo hasta que vence** (como mucho 1 h). |
| **Logout en la app** (mobile#16, [ENG-114](https://linear.app/summercamp-pasantes/issue/ENG-114)) | Se borra del Keychain/Keystore. Tampoco se revoca en Supabase ([`mobile-session.md`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/mobile-session.md)). | Igual: hasta que vence. |
| **Cambio de contraseña por el enlace del mail** (backend#64, [ENG-142](https://linear.app/summercamp-pasantes/issue/ENG-142)) | `signOut({ scope: 'global' })`: **se revocan todas las sesiones** del usuario. | **Sigue valiendo hasta que vence.** El guard no se entera de la revocación. |
| **Refresh token reusado** | Supabase dice detectarlo y revocar la cadena. **En este proyecto no lo hace** (verificado dos veces, [`refresh-token-reuse-risk-plan.md`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/refresh-token-reuse-risk-plan.md)). Mitigación: 5 refresh por minuto por cliente. | — |

En resumen: **la ventana de exposición de un access token robado es de hasta una hora**,
haga lo que haga el usuario. La de un refresh token robado dura hasta que el usuario
cambie la contraseña.

### Qué se puede hacer (pendiente, decisión del equipo)

1. **Bajar el vencimiento del access token a 900 segundos** en la configuración de
   JWT del proyecto de Supabase.
   Cumple §5.5.2 al pie de la letra y achica la ventana a 15 minutos. El costo es
   cuatro veces más refresh: en mobile choca con el límite de 5 por minuto por IP
   bajo CGNAT, que `mobile-session.md` ya marca como provisorio.
2. **Revocar la sesión en el logout** con `auth.admin.signOut(<access token>, 'local')`
   antes de borrar las cookies o el secure store. Cierra el hueco del
   refresh token en web y mobile.
3. **Validar `session_id`** contra `auth.sessions` solo en las rutas de datos
   clínicos. Cierra también el del access token, a costa de una consulta por request.

Las opciones 1 y 2 son chicas y no se pisan entre sí. La 3 solo se justifica con datos
reales.

## Ubicación de los datos y transferencia internacional

### Dónde está cada cosa

| Componente | Qué datos toca | Dónde corre | Cómo se verificó |
|---|---|---|---|
| **Supabase** (Postgres, Auth, Storage, Realtime) | Todos: PII, HC, documentos, chat, bitácoras | **`sa-east-1` — São Paulo, Brasil** | API de Supabase el 04/11/2026 (proyecto `mediconnect-dev`, `region: sa-east-1`) y host del pooler en el [README del backend](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/README.md) (`aws-1-sa-east-1.pooler.supabase.com`) |
| **Render** (backend NestJS) | Todos, en tránsito y en memoria | **No consta en el repo.** Render solo ofrece Oregon, Ohio y Virginia (EE.UU.), Frankfurt (Alemania) y Singapur; [no tiene región en Sudamérica](https://render.com/docs/regions) | El backend no tiene `render.yaml` y los headers de respuesta no la dicen. **Hay que mirarla en el dashboard** (Settings del servicio). |
| **Cloudflare** (delante de Render) | Tránsito | Edge más cercano al usuario (`cf-ray` con `EZE`, Buenos Aires, en la prueba del 04/11) | Headers de respuesta |
| **Render** (web, static site) | Ninguno: solo sirve el bundle | CDN global | [`render.yaml`](https://github.com/Proyecto-final-Mediconnect/mediconnect-web/blob/main/render.yaml) |
| **Daily.co** (videoconsulta) | Audio y video en tránsito; con `VIDEO_RECORDING_MODE=cloud-audio-only`, la grabación del audio queda en Daily | EE.UU. (empresa y almacenamiento) | [`env.validation.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/config/env.validation.ts) |
| **Resend** (emails de turno) | Nombre, email, fecha del turno y nombre del profesional | `api.resend.com`; la región la fija el dominio en el dashboard (por defecto, EE.UU.) | `email.service.ts` · **confirmar en el dashboard** |
| **Sentry** | Errores, **sin PII** (scrubbing, fila 35) | Organización en la región **DE** (Alemania), según la CSP de la web | `render.yaml` de la web (`*.ingest.de.sentry.io`) · confirmar que el `SENTRY_DSN` del backend sea de la misma organización |
| **MercadoPago** | Monto y referencia del turno; nunca datos de tarjeta | Argentina | [`mercadopago.service.ts`](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/src/payments/mercadopago.service.ts) |
| **OpenAI / Gemini** | Ninguno hoy | — | `OPENAI_API_KEY` y `GEMINI_API_KEY` están en `.env.example`, pero ningún archivo de `src/` las usa: la transcripción no está implementada. |

### Qué dice la ley

- **Ley 25.326, art. 2:** la información sobre la salud es **dato sensible**.
- **Ley 25.326, art. 12, inc. 1:** prohíbe transferir datos personales de cualquier
  tipo a países que no ofrezcan niveles de protección adecuados. Las excepciones del
  inc. 2 (entre ellas, el intercambio de datos médicos cuando lo exige el tratamiento
  del afectado) no cubren alojar la base de una plataforma en otro país.
  [Texto actualizado en InfoLEG](https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/64790/texact.htm).
- **Decreto 1558/2001, art. 12:** la prohibición **no rige si el titular consintió
  expresamente** la cesión, y la protección adecuada puede venir también de
  **cláusulas contractuales**.
  [Texto en InfoLEG](https://servicios.infoleg.gob.ar/infolegInternet/anexos/70000-74999/70368/norma.htm).
- **Disposición DNPDP 60-E/2016, art. 3**, en el texto que le dio la **Resolución AAIP
  34/2019**: es la lista de países con legislación adecuada. Incluye a los Estados de
  la Unión Europea y del EEE, el Reino Unido (agregado por la 34/2019), Suiza,
  Guernsey, Jersey, la Isla de Man, las Islas Feroe, Canadá (solo sector privado),
  Andorra, Nueva Zelanda, Uruguay e Israel (solo datos con tratamiento automatizado).
  **Brasil no figura. Estados Unidos tampoco.**
  [Disposición 60-E/2016](https://www.argentina.gob.ar/normativa/nacional/267922/texto) ·
  [Resolución AAIP 34/2019, Boletín Oficial del 26/02/2019](https://www.boletinoficial.gob.ar/detalleAviso/primera/202373/20190226).
- **Resolución AAIP 198/2023:** aprueba cláusulas contractuales modelo para
  transferir a países **sin** legislación adecuada. Complementa a la 60/2016 y no
  cambia la lista.
  [Boletín Oficial del 18/10/2023](https://www.boletinoficial.gob.ar/detalleAviso/primera/296189/20231018).

No encontramos ninguna resolución de la AAIP posterior a la 34/2019 que agregue a
Brasil. La propia Disposición 60/2016 aclara que estar fuera de la lista no equivale
a una declaración de inadecuación. Pero **sin esa declaración, la lectura prudente es
tratar a Brasil como país no adecuado** y transferir solo con alguno de los
mecanismos del Decreto 1558/2001.

> Esto es el análisis de un equipo de estudiantes de Ingeniería, no asesoramiento
> legal. Antes de operar con datos reales, lo tiene que validar un abogado.

### Postura

**En el MVP académico.** La plataforma opera **solo con datos sintéticos** (Sprint 0
§5.7 y §5.8), y la página legal de la web avisa que es un proyecto académico. Con datos
sintéticos no hay datos personales de terceros y el art. 12 no aplica. La restricción
del Estudio Inicial §4.5 se respeta porque no se transfiere ningún dato real de salud.

**Para operar con datos reales.** Con la infraestructura actual, los datos de salud
salen del país hacia **Brasil** (Supabase) y, según la región de Render, hacia
**EE.UU.** o **Alemania** (backend). También van a EE.UU. por Daily y Resend. Hay
tres caminos:

| Camino | Qué implica | Contra |
|---|---|---|
| **A. Consentimiento expreso** del titular para la transferencia (Decreto 1558/2001, art. 12) | Una cláusula específica en la política de privacidad: qué datos, a qué países, a qué proveedores y para qué. Más un consentimiento separado y explícito en el registro. Exige subir `LEGAL_VERSION` (ENG-140) para que todos los usuarios vuelvan a aceptar. | Si un paciente no consiente, o retira el consentimiento, no puede usar la plataforma: es difícil sostener que ese consentimiento sea libre. Por sí solo es frágil para datos sensibles. |
| **B. Cláusulas contractuales** con cada proveedor (Disposición 60/2016, Anexo II; Resolución AAIP 198/2023) | Firmar con Supabase, Render, Daily y Resend un contrato con las cláusulas modelo argentinas. Si difiere del modelo, presentarlo ante la AAIP dentro de los 30 días. | Los DPA estándar de esos proveedores siguen el modelo europeo (GDPR), no el argentino. En planes Free no se negocia nada. |
| **C. Región adecuada** | Mover Supabase a una región de la UE (p. ej. `eu-central-1`, Frankfurt) o al Reino Unido (`eu-west-2`, Londres), y el backend de Render a Frankfurt. | Suma latencia a cada consulta desde Argentina (Frankfurt queda bastante más lejos que São Paulo) y obliga a migrar el proyecto de Supabase. Daily y Resend siguen en EE.UU. y necesitan A o B igual. |

**Recomendación.** Para la defensa, mantener `sa-east-1` y la postura de datos
sintéticos: es coherente con el Sprint 0 y está documentada. Para una operación real,
**A + B juntos**: cláusulas contractuales con los proveedores como base, y la cláusula
de transferencia internacional en los textos legales para cubrir lo que el contrato no
alcance. La C solo conviene si el contrato con Supabase no se puede conseguir, porque
São Paulo es la región con menor latencia para usuarios argentinos.

### Pendientes que salen de esta sección

- [ ] **Textos legales** (ENG-140): la política de privacidad dice que los proveedores
  acceden *"solo en lo necesario para prestar el servicio"*, pero no dice **dónde**
  están. Para operar con datos reales hay que agregar la transferencia internacional
  (países y proveedores) y subir `LEGAL_VERSION`. **No se cambia en este ticket**: con
  datos sintéticos no es necesario, y obligaría a todos los usuarios demo a volver a
  aceptar.
- [ ] Confirmar en el dashboard de Render la **región del backend** y anotarla en esta
  tabla.
- [ ] Confirmar en el dashboard de Resend la **región del dominio** de envío.
- [ ] Confirmar que el `SENTRY_DSN` del backend sea de la organización en la región DE.

## Decisiones que quedan para el equipo

1. **Rol de la base (fila 18):** correr el script de ENG-138 en Supabase y cambiar
   `DATABASE_URL` en Render siguiendo el
   [runbook](https://github.com/Proyecto-final-Mediconnect/mediconnect-backend/blob/main/docs/security/rol-backend.md).
   El PR pide hacerlo antes del 18/11. Después, abrir el ticket de la parte 2 (sacar
   `BYPASSRLS`).
2. **CSP de la web (fila 27):** cargar los headers de `render.yaml` a mano en el
   dashboard, o migrar el static site a Blueprint (ENG-124).
3. **Doble revisión de seguridad (fila 5):** subir el ruleset del backend a dos
   aprobaciones, o adoptarlo como convención con un label.
4. **Duración del JWT y logout (filas 15 y [Sesión y JWT](#sesión-y-jwt)):** si se baja
   a 15 minutos y si el logout revoca la sesión.
5. **Transferencia internacional:** cuál de los caminos A/B/C se toma si el proyecto
   sigue después de la cursada.

## Cómo mantener este documento

Cuando un PR cambia el estado de una fila (por ejemplo, cuando Render use el rol de ENG-138 la fila 18
cambia), el mismo PR, o uno en este repo que lo referencie, actualiza la
fila, el resumen y la fecha de corte. El [checklist de cierre de
release](checklist-cierre-de-release.md) pide revisarlo en cada release.
