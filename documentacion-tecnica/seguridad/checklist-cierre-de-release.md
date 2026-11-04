# Checklist de seguridad al cierre de una release

- **Origen:** Sprint 0 §4.8.3 · [ENG-167](https://linear.app/summercamp-pasantes/issue/ENG-167)
- **Cuándo:** antes de mergear `release/*` a `main` al cierre de cada release mayor.
- **Dónde:** se copia en la descripción del PR de release de **cada** repo de código
  (backend, web, mobile) y se completa ahí. Lo que no aplica a un repo se marca
  `N/A` con el motivo; no se borra.

Las releases 1.0.0, 1.2.0 y 2.0.0 se cerraron sin este checklist (ver
[estado de seguridad](estado-de-seguridad.md), fila 6). La primera que lo usa es la 3.0.0.

## Cómo se usa

1. Quien abre el PR de release pega la plantilla y completa cada ítem con la
   **evidencia**: un link a la corrida de CI, el comando y su salida, o una captura.
   Un tilde sin evidencia no cuenta.
2. Un ítem que falla **bloquea el merge**, salvo que el equipo acepte el riesgo por
   escrito en el PR (qué falla, por qué se acepta y el ticket que lo resuelve).
3. Lo revisan **dos** developers distintos del autor (Sprint 0 §4.8.2).

## Plantilla

Copiar desde acá hasta el final del bloque:

```markdown
## Checklist de seguridad de cierre de release (Sprint 0 §4.8.3)

Release: `X.Y.Z` · Repo: `mediconnect-…` · Staging verificado el: `DD/MM/AAAA`

### Los siete del Sprint 0

- [ ] **Tests de RLS en verde** para todos los módulos del release.
      Evidencia: corrida de `Integration Tests` sobre `release/X.Y.Z` → <link>
- [ ] **Sin vulnerabilidades high ni critical** en dependencias de producción.
      Evidencia: job `Dependencias` de `Security` sobre `release/X.Y.Z` → <link>
      (backend/web: `pnpm audit --prod --audit-level=high`; mobile: `npm audit --omit=dev --audit-level=high`)
- [ ] **Sin secretos en el código** (gitleaks limpio; el Sprint 0 dice TruffleHog).
      Evidencia: `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:latest git /repo --redact --log-opts="origin/main..origin/release/X.Y.Z"` → sin hallazgos
- [ ] **Los endpoints nuevos validan el input** con un DTO de `class-validator`
      (el `ValidationPipe` global corre con `whitelist` y `forbidNonWhitelisted`).
      Evidencia: lista de endpoints nuevos y su DTO → …
- [ ] **Los logs no exponen PII ni datos clínicos.** Se revisan a mano los logs de
      Render de staging durante una pasada de los flujos nuevos, y los eventos de
      Sentry del período.
      Evidencia: qué flujos se recorrieron y qué se miró → …
- [ ] **Los errores 500 son genéricos**, sin stack trace.
      Evidencia: un 500 provocado en staging responde
      `{"statusCode":500,"message":"Internal server error"}` → …
- [ ] **Headers de seguridad correctos en staging** (CORS, CSP, X-Frame-Options).
      Evidencia: salida de
      `curl -sI <url>/health | grep -iE 'access-control|content-security|x-frame|strict-transport'` (API) y
      `curl -sI <url-web>/ | grep -iE 'content-security|x-frame|strict-transport|permissions-policy'` (web)
      → la web tiene que mostrar la CSP de `render.yaml`. Si no aparece, Render no la está aplicando.

### Agregados por lo que aprendimos (ENG-167)

- [ ] **El backend corre con el rol `mediconnect_backend`**, no como `postgres`.
      Evidencia: en Render → Environment, el usuario de `DATABASE_URL` empieza con
      `mediconnect_backend.` (no copiar la URL: tiene la contraseña), y en el SQL Editor
      `select count(*) from pg_stat_activity where usename = 'mediconnect_backend';` da más de 0 → …
- [ ] **Migraciones del release revisadas:** toda tabla nueva con datos clínicos o PII
      tiene RLS y `FORCE ROW LEVEL SECURITY`, y si es append-only revoca
      `UPDATE`/`DELETE` al rol del backend (`docs/security/rol-backend.md`).
- [ ] **Cadena de hash íntegra:** la última corrida de `Integrity Check` está en verde
      y el ancla coincide con la anterior o creció. Evidencia → <link>
- [ ] **Último backup verificado** de `mediconnect-backups` con menos de 7 días y la
      restauración en verde. Evidencia → <link>
- [ ] **Proveedores y regiones sin cambios**, o actualizados en la tabla
      "Dónde está cada cosa" de `estado-de-seguridad.md`.
      Si el release suma un proveedor que recibe datos personales, también va en la
      política de privacidad (ENG-140) y sube `LEGAL_VERSION`.
- [ ] **`estado-de-seguridad.md` al día:** las filas que este release cambia
      (por ejemplo, un ticket de seguridad que entró) están actualizadas.

### Riesgos aceptados en este release

| Ítem | Qué falla | Por qué se acepta | Ticket |
|---|---|---|---|
| — | — | — | — |

Revisado por: @… y @… (dos, distintos del autor)
```
