# Documentación técnica

Notas de investigación y exploración técnica del equipo (resultados de
**spikes**, pruebas de concepto y validaciones de enfoque previas a la
implementación).

Según el Working Agreement (Sprint 0, §2.7), este tipo de material es
"documentación viva" y su destino formal es Confluence. Mientras el equipo
no tenga Confluence en uso, se versiona acá para no perder el trabajo y
poder revisarlo vía Pull Request.

## Estructura

```
documentacion-tecnica/
├── spikes/     # conclusiones de tareas de investigación timeboxed (issues tipo Spike)
└── testing/    # procedimientos de verificación que se corren en cada historia
├── adr/        # decisiones de arquitectura en formato MADR
└── spikes/     # conclusiones de tareas de investigación timeboxed (issues tipo Spike)
```

Cada spike se nombra con el ID de su issue en Linear: `ENG-XX-<tema>.md`.

`testing/` es lo que se ejecuta, no lo que se investigó:

- [Checklist de testing manual en emulador Android](testing/checklist-emulador-android.md)
  (ENG-121) — obligatorio en toda historia de `mediconnect-mobile` mientras Detox no
  exista (Sprint 0 §4.2.3).
Cada ADR se nombra con su número: `ADR-NNN-<tema>.md`. Los ADR-001 a ADR-015 se
tomaron en el Sprint 0 y todavía viven en el documento de Google; ver
[`adr/README.md`](adr/README.md).
