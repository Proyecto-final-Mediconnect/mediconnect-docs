# ENG-219 — Prueba de concepto: resumen IPS de Argentina al MediPass

La decisión está en el [ADR-022](../../adr/ADR-022-carga-automatica-historia-clinica.md).

| Archivo | Qué es |
| --- | --- |
| `ips-a-medipass.mjs` | Lee un resumen IPS-AR (FHIR R4, `Bundle` de tipo `document`) y propone las alergias, la medicación y las condiciones del MediPass. No guarda nada. |
| `ips-argentina-ejemplo.json` | El ejemplo oficial del grupo de trabajo IPS del Ministerio de Salud ([SALUD-AR/IPS-Argentina](https://github.com/SALUD-AR/IPS-Argentina), licencia Apache 2.0). Va sin cambios. |

Para correrla (Node 20 o más, sin dependencias):

```sh
node ips-a-medipass.mjs ips-argentina-ejemplo.json
```
