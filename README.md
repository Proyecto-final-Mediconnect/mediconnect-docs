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
├── documentacion-tecnica/     # ⭐ ADRs (`adr/`) y conclusiones de spikes (`spikes/`)
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

## Enmiendas al Sprint 0 y al Plan de Proyecto

Los dos documentos viven en el Drive, así que lo que se enmienda se versiona acá
y después se pega allá:

- [Addendum — Alcance de la aplicación mobile](./02-sprint-0/addendum-alcance-mobile.md)
  (ENG-111): el alcance mobile acordado en la Planning del 15/08/2026, el paquete de
  WBS que faltaba y el presupuesto sin las cuentas de developer.

## Convenciones

- Archivos y carpetas en `kebab-case`, en español.
- Los diagramas se escriben en **Mermaid** (renderiza nativo en GitHub y en Confluence con el
  macro Mermaid) y se versionan como texto, no como imágenes binarias.
- Cambios vía Pull Request siguiendo la política del Working Agreement.
