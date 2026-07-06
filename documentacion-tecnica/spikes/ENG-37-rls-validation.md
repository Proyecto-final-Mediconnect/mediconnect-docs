# ENG-37 — Spike: Validación de RLS en Supabase con Prisma

**Épica:** EP-10 (Plataforma e Infraestructura) · **Sprint 1** · **5 SP** · **Tipo:** Spike
**Autor:** Magris

## Objetivo

Confirmar —antes de modelar todas las tablas— que las políticas de **Row Level
Security (RLS)** de Supabase aíslan de verdad los datos entre usuarios cuando el
backend consulta la base **con Prisma**, y dejar documentado el patrón a seguir en
el proyecto real.

La validación se hizo de forma **empírica contra la base real** (`mediconnect-dev`),
sobre las dos tablas que ya existen del módulo de identidad (`profiles` y
`patients`, creadas en ENG-42), no sobre tablas de juguete.

---

## El problema de fondo: Prisma bypassa RLS por defecto

RLS solo se aplica al **rol de Postgres** con el que corre la consulta. La cadena
`DATABASE_URL` del backend conecta como el rol `postgres`, que **no está sujeto a
RLS**. Es decir: si el backend consulta "tal cual", **ve todas las filas de todos
los usuarios** — RLS no lo protege.

Para que RLS aplique, cada consulta hecha en nombre de un usuario debe correr:

1. adoptando el rol `authenticated`, y
2. publicando el claim `sub` del JWT del usuario en la sesión (es lo que alimenta
   a `auth.uid()` en las políticas).

Ambas cosas se hacen **por transacción**, con `SET LOCAL`, para que valgan solo
dentro de esa unidad de trabajo y no contaminen la conexión del pool.

### Patrón recomendado para el backend (Prisma)

```ts
// Corre `work(tx)` como el usuario autenticado: RLS aplica dentro de la transacción.
function runAsUser<T>(prisma: PrismaClient, userId: string, work: (tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set local role authenticated');
    await tx.$executeRawUnsafe(
      "select set_config('request.jwt.claims', $1, true)",
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    );
    return work(tx);
  });
}
```

El `userId` sale del JWT ya verificado por el backend (ver
[ENG-40](./ENG-40-supabase-auth.md): verificación local con JWKS). El backend
**nunca** debe consultar datos de un usuario sin envolverlos en este contexto.

---

## Segundo hallazgo: las tablas creadas por Prisma necesitan GRANTs explícitos

Supabase concede automáticamente privilegios a los roles `anon` / `authenticated`
sobre las tablas creadas **por su propia API/Studio**. Las tablas creadas por
**Prisma** (`db push` / migraciones, owner `postgres`) **no reciben esos grants**.

Sin los GRANT, el rol `authenticated` recibe `permission denied for table ...`
**antes** de que RLS evalúe siquiera las filas. Son dos capas necesarias y
distintas:

- **GRANT** → da acceso a la tabla al rol.
- **RLS** → filtra qué filas ve ese rol.

Por eso la migración incluye, además de las políticas:

```sql
grant usage on schema public to authenticated;
grant select, update on public.profiles  to authenticated;
grant select, insert, update on public.patients to authenticated;
-- A `anon` no se le concede nada sobre estas tablas con PII → deny-all fuerte.
```

Esta es una regla a repetir en **toda** tabla nueva creada por Prisma.

---

## Tercer hallazgo: hueco de auto-escalada de rol

La política "cada uno actualiza su propia fila" (`id = auth.uid()`), por sí sola,
deja que un paciente haga `update profiles set role = 'MODERADOR' where id = auth.uid()`.
RLS valida la **fila**, no las **columnas**. Se cierra con un trigger `BEFORE UPDATE`
que rechaza cualquier cambio de `role`. Queda documentado como patrón para columnas
sensibles (p. ej. `professionals.status`).

---

## Resultados

Script de validación: `mediconnect-backend/scripts/verify-rls.ts` (crea 2 usuarios
vía Admin API, corre las aserciones desde Prisma y limpia todo al final). Corrida
contra `mediconnect-dev`:

| Verificación | Resultado |
|---|---|
| El trigger `on_auth_user_created` crea el `profile` al registrarse | ✅ |
| `profiles`: un usuario solo ve su propia fila | ✅ |
| `patients`: un usuario solo ve su propia fila | ✅ |
| `profiles`: A no puede **leer** la fila de B | ✅ |
| `patients`: A no puede **leer** la fila de B | ✅ |
| `profiles`: el `UPDATE` de A sobre la fila de B afecta 0 filas | ✅ |
| `profiles`: A no puede **auto-escalar** su rol a `MODERADOR` | ✅ |
| `profiles`: un anónimo no accede a ninguna fila (deny-all) | ✅ |

**7/7 verificaciones en verde.** El aislamiento entre usuarios funciona con el
patrón descripto.

### Cómo reproducirlo

```bash
# .env con DATABASE_URL (conexión directa 5432), SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
cd mediconnect-backend
pnpm exec prisma generate
pnpm exec prisma db execute \
  --file prisma/migrations/20260706000000_ep01_identity_rls/migration.sql \
  --schema prisma/schema.prisma
pnpm verify:rls
```

---

## Conclusiones para el proyecto

1. **Toda consulta con datos de un usuario va envuelta en `runAsUser`** (rol
   `authenticated` + claim `sub`). Sin eso, Prisma bypassa RLS.
2. **Toda tabla con PII o datos clínicos**: `enable row level security` + políticas
   `deny-all` por defecto + **GRANT explícito** a `authenticated`. Nada para `anon`
   salvo datos deliberadamente públicos (p. ej. catálogo de profesionales activos).
3. **Columnas sensibles** (rol, estado de matrícula): proteger con trigger, porque
   RLS es a nivel fila, no columna.
4. Las políticas se **versionan como migración SQL** (ADR-004), no se aplican a mano.
   La primera quedó en `prisma/migrations/20260706000000_ep01_identity_rls/`.
5. El patrón está listo para replicarse en las tablas de las próximas épicas
   (`appointments`, `clinical_record_entries`, `messages`, MediPass), varias con la
   condición extra de "profesional con relación vigente" ya prevista en el modelo.

---

## Referencias

- Row Level Security — Supabase Docs, https://supabase.com/docs/guides/database/postgres/row-level-security
- Row Level Security — PostgreSQL Docs, https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- RLS con Prisma en Supabase, https://supabase.com/docs/guides/database/prisma
- ADR-004 (Base de datos y ORM) y `modelo-de-datos/esquema.md` (RLS por tabla)
