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

## Protección de la rama `main`

`main` tiene un ruleset activo (ENG-127), igual al de los repos de código salvo que
acá no se exigen checks, porque el repo no tiene CI:

| Regla | Qué impide |
| --- | --- |
| Pull request obligatorio, **1 aprobación** | Pushear directo a `main` o mergear sin que nadie haya revisado. |
| Sin borrado | Eliminar la rama `main`. |
| Sin force push | Reescribir el historial de `main`. |

**Nadie tiene bypass**, tampoco los administradores del repo.

`dismiss_stale_reviews_on_push` y `strict_required_status_checks_policy` están en `false`,
igual que en backend, web y mobile. Se deciden para los cuatro repos juntos en ENG-128:
cambiarlos solo acá volvería a abrir la divergencia entre repos que este ruleset cierra.

Para comparar esta descripción contra lo que hay cargado en GitHub:

```sh
gh api repos/Proyecto-final-Mediconnect/mediconnect-docs/rules/branches/main
```

### Los ADR llevan dos aprobaciones

El ruleset exige una aprobación para todo el repo: GitHub no permite pedir más
aprobaciones según el tipo de archivo. Por eso esto es una **convención**, y la cumple quien
mergea:

> Un PR que agrega o modifica un ADR, o que cambia el estado de uno (por ejemplo, de
> *Propuesto* a *Aceptado*), no se mergea con menos de **dos aprobaciones** de
> desarrolladores distintos del autor.

Sale del Sprint 0 §1.7.4, que exige validación de al menos dos desarrolladores para
cualquier decisión de seguridad, arquitectura o cumplimiento normativo asistida por IA. Un
ADR es por definición una decisión de arquitectura, y en la práctica casi toda la
documentación del proyecto se escribe con asistencia de IA. Distinguir PR por PR si hubo IA
de por medio es más frágil que aplicar la regla siempre, así que se aplica siempre.
