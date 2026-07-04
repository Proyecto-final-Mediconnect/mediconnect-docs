# mediconnect-docs

Documentación formal y versionada del proyecto **MediConnect** (UTN FRC — Proyecto Final 2026).
Todo artefacto que requiere historial de cambios, revisión vía Pull Request y constituye
decisión o registro permanente vive acá.

## Estructura

```
mediconnect-docs/
├── README.md                  # este archivo
├── 01-inicio-proyecto/        # estudio inicial, plan de proyecto
├── 02-sprint-0/               # working agreement, gestión config, arquitectura, testing, USM
├── 03-sprints/                # informes y retrospectivas por sprint
├── adrs/                      # Architecture Decision Records
├── modelo-de-datos/           # ⭐ esquema de base de datos, DER y normalización
├── diagrams/                  # fuentes de diagramas (C4, DER)
├── assets/                    # imágenes y recursos
└── glossary.md                # glosario del dominio
```

## Modelo de datos

El diseño completo de la base de datos PostgreSQL (Supabase) está en
[`modelo-de-datos/`](./modelo-de-datos/README.md):

- [Diagrama Entidad-Relación (DER)](./modelo-de-datos/der.md)
- [Esquema detallado tabla por tabla](./modelo-de-datos/esquema.md)
- [Justificación de la normalización (3FN)](./modelo-de-datos/normalizacion.md)

## Convenciones

- Archivos y carpetas en `kebab-case`, en español.
- Los diagramas se escriben en **Mermaid** (renderiza nativo en GitHub y en Confluence con el
  macro Mermaid) y se versionan como texto, no como imágenes binarias.
- Cambios vía Pull Request siguiendo la política del Working Agreement.
