# ADRs — Architecture Decision Records

Decisiones de arquitectura del proyecto, en formato [MADR](https://adr.github.io/madr/).

## Por qué esta carpeta existe

Los **ADR-001 a ADR-015** se tomaron durante el Sprint 0 y viven dentro del
documento de Google del Sprint 0 (§3.4). El **ADR-016 es el primero versionado
acá**, por dos motivos:

- El Sprint 0 §3.4.6 difirió esa decisión "al ADR-016", sin decir dónde iba a
  escribirse. Un ADR que bloquea trabajo tiene que poder revisarse por Pull
  Request, como cualquier otro cambio.
- Mismo criterio que `documentacion-tecnica/spikes/` (§2.7 del Working
  Agreement): mientras el equipo no tenga Confluence en uso, se versiona acá
  para no perder el trabajo y poder discutirlo en un PR.

Los ADR-001 a ADR-015 **no se migran** en este PR. Si en algún momento se
migran, el orden natural es hacerlo de a uno, cuando alguno haya que tocar.

## Convenciones

- Un archivo por decisión: `ADR-NNN-<tema-en-kebab-case>.md`.
- La numeración continúa la del Sprint 0; el próximo libre es el **ADR-017**
  (reservado por ENG-111 para el recorte de alcance mobile).
- **Estados:** `Propuesto` · `Aceptado` · `Rechazado` · `Reemplazado por ADR-NNN`.
  Un ADR nace `Propuesto` y pasa a `Aceptado` cuando se aprueba el PR.
- Sprint 0 §1.7.4: **las decisiones de arquitectura las toman dos
  desarrolladores.** El campo `Aceptado por` deja registro de quién fue el
  segundo; sin eso, el ADR no se mergea.
- Un ADR aceptado **no se edita para cambiar la decisión**: se escribe uno nuevo
  que lo reemplace y se actualiza el estado del viejo.

## Índice

| ADR | Decisión | Estado |
| --- | --- | --- |
| [016](ADR-016-navegacion-mobile.md) | Tecnología de navegación de la app mobile | Propuesto |
