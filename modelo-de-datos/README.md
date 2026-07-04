# Modelo de Datos — MediConnect

Diseño de la base de datos relacional de MediConnect sobre **PostgreSQL 15 (Supabase)**,
accedida vía **Prisma 5** desde el backend NestJS. El diseño se basa en el User Story Mapping,
las 10 épicas y los ADRs del Sprint 0 (especialmente ADR-004 BD/ORM, ADR-005 Supabase,
ADR-007 Auth+RLS, ADR-014 integridad de HC, ADR-015 interoperabilidad FHIR).

## Contenido

| Archivo | Qué contiene |
|---------|--------------|
| [`der.md`](./der.md) | Diagrama Entidad-Relación completo (Mermaid) + leyenda |
| [`esquema.md`](./esquema.md) | Especificación tabla por tabla: columnas, tipos, claves, RLS, índices |
| [`normalizacion.md`](./normalizacion.md) | Justificación 1FN / 2FN / 3FN y denormalizaciones deliberadas |
| [`../diagrams/der.mmd`](../diagrams/der.mmd) | Fuente Mermaid canónica del DER |

## Decisiones de modelado (resumen)

1. **Identidad delegada a Supabase Auth.** `auth.users` (tabla gestionada por Supabase) es la
   fuente de identidad. En el esquema `public` se crea `profiles` en relación 1:1 con
   `auth.users`, y de ahí cuelgan los perfiles por rol (`patients`, `professionals`). Ver ADR-007.
2. **Un rol → una tabla especializada.** Evita columnas nulas por rol y respeta 3FN.
3. **Datos clínicos como FHIR R5 en `JSONB`.** El campo `content` de las entradas de HC guarda
   recursos FHIR (Patient, Observation, Condition, MedicationStatement, AllergyIntolerance) con
   codificación ICD-10 / SNOMED CT / LOINC embebida. Ver ADR-015.
4. **Historia clínica append-only con cadena de hash SHA-256.** Ver ADR-014 y sección
   correspondiente en [`esquema.md`](./esquema.md#ep-06--historia-clínica).
5. **RLS en toda tabla con datos clínicos o PII.** Política por defecto: *deny-all*; se habilita
   acceso explícito por dueño/relación. Ver ADR-007.

## Convenciones de nombres

- Tablas en `snake_case`, plural (`appointments`, `clinical_record_entries`).
- Columnas en `snake_case`.
- PK: `id UUID` (`gen_random_uuid()`), salvo tablas 1:1 donde la PK es también FK
  (`profile_id`).
- Timestamps `timestamptz`; toda tabla con `created_at`, y `updated_at` donde aplica mutación.
- Enums como tipos `ENUM` de PostgreSQL (equivalen a `enum` de Prisma).
- FK con `ON DELETE` explícito según el caso (RESTRICT por defecto en datos clínicos).

## Cómo ver los diagramas

Los `.mmd` / bloques ` ```mermaid ` renderizan automáticamente en:
- GitHub / GitLab (vista del archivo `.md`).
- VS Code con la extensión *Markdown Preview Mermaid Support*.
- Confluence con el macro *Mermaid Diagrams*.
- [mermaid.live](https://mermaid.live) pegando el contenido de `der.mmd`.
