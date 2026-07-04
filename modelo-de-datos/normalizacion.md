# Normalización del Modelo de Datos

El esquema relacional de MediConnect se diseñó en **Tercera Forma Normal (3FN)**. Este documento
justifica el cumplimiento de cada forma normal con ejemplos del propio modelo y explica las
denormalizaciones deliberadas (todas justificadas).

## Primera Forma Normal (1FN)

> Todos los atributos son atómicos; no hay grupos repetitivos ni columnas multivaluadas.

- **Especialidades del profesional** no se guardan como lista en `professionals` (p. ej. un campo
  `specialties` con `"cardiología, clínica"`). Se modela con el catálogo `specialties` y la tabla
  puente `professional_specialties`. Cada fila representa un único par atómico
  (profesional, especialidad).
- **Formación académica** no es un grupo repetitivo dentro de `professionals`: cada título vive
  como una fila en `professional_education`.
- **Reglas de agenda**: cada franja semanal es una fila en `schedule_rules`; no hay columnas tipo
  `lunes_inicio`, `martes_inicio`, etc.

## Segunda Forma Normal (2FN)

> Está en 1FN y todo atributo no clave depende de la **clave completa**, no de parte de ella.
> Relevante en tablas con clave compuesta.

- La única tabla con clave compuesta es `professional_specialties` con PK
  `(professional_id, specialty_id)`. Es una tabla puramente asociativa: **no tiene atributos no
  clave**, por lo que no puede existir dependencia parcial. Cumple 2FN trivialmente.
- El nombre de la especialidad (`name`) no se repite en la tabla puente: vive una sola vez en
  `specialties`. Evita la dependencia parcial `specialty_id → name` que existiría si se
  denormalizara.

## Tercera Forma Normal (3FN)

> Está en 2FN y ningún atributo no clave depende **transitivamente** de la clave (no hay
> dependencias entre atributos no clave).

- **Identidad por rol.** En vez de una única tabla `users` con columnas nulas según el rol
  (`license_number` solo para profesionales, `dni` solo para pacientes), se separan
  `profiles` → `patients` / `professionals`. Así cada atributo depende exclusivamente de la clave
  de su tabla, sin dependencias condicionadas por el valor de `role`.
- **Catálogo de especialidades.** `specialties.name` depende de `specialties.id` y de nada más.
  Si el nombre viviera en la tabla puente, dependería transitivamente vía `specialty_id`.
- **Precio del turno congelado.** `appointments.price` **no** se lee en tiempo real de
  `professionals.consultation_price`. Se copia al momento de reservar. Esto *no* viola 3FN: el
  precio del turno es un hecho propio del turno (el profesional puede cambiar su tarifa después
  sin alterar turnos ya reservados). Es una dependencia respecto de la clave del turno, no
  transitiva.
- **Datos de pago.** El estado del pago (`payments.status`) y el del turno
  (`appointments.status`) se mantienen en tablas distintas: el turno no deriva su estado del pago
  por columna, sino por lógica de negocio. Se evita duplicar el estado del pago dentro del turno.

## Denormalizaciones deliberadas (justificadas)

La 3FN es el objetivo, pero en dos lugares se elige conscientemente no descomponer más, por
razones de dominio y performance:

| Caso | Decisión | Justificación |
|------|----------|---------------|
| **Datos clínicos en `content` (JSONB)** | Se guarda el recurso FHIR R5 completo como documento, en lugar de descomponerlo en decenas de tablas relacionales | ADR-015: FHIR es el modelo estándar; descomponerlo perdería interoperabilidad y la capacidad de serializar el MediPass como Bundle. PostgreSQL permite consultas estructuradas sobre JSONB. |
| **`previous_hash` en cada entrada de HC** | Se almacena el hash de la entrada anterior, dato "derivable" recorriendo la cadena | ADR-014: es el mecanismo de integridad. Recalcularlo en cada lectura sería O(N); persistirlo permite verificación incremental y es la evidencia legal de inmutabilidad. |
| **`raw_payload` en `payment_webhook_events`** | Se guarda el JSON crudo del webhook además de los campos ya parseados | Trazabilidad y reproceso ante fallos; idempotencia. Es log, no fuente de verdad transaccional. |

## Integridad referencial

- Toda relación se expresa con `FOREIGN KEY` a nivel base de datos (ADR-004).
- `ON DELETE`:
  - `CASCADE` en dependencias de composición (perfil → patient/professional, conversación →
    mensajes, profesional → agenda).
  - `RESTRICT` (por defecto) en datos clínicos y catálogos: no se permite borrar una especialidad
    en uso ni un paciente con HC.
- `clinical_record_entries` y `audit_logs` son **append-only**: las políticas RLS niegan `UPDATE`
  y `DELETE`, garantizando inmutabilidad más allá de la integridad referencial.

## Resumen

| Forma normal | Estado | Evidencia principal |
|--------------|--------|---------------------|
| 1FN | ✅ | `professional_specialties`, `professional_education`, `schedule_rules` |
| 2FN | ✅ | Tabla puente sin atributos no clave |
| 3FN | ✅ | Separación por rol, catálogos, sin dependencias transitivas |
| Denormalización controlada | ✅ justificada | FHIR JSONB, cadena de hash, webhook raw |
