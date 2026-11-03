# Normalización del Modelo de Datos

El esquema relacional de MediConnect se diseñó en **Tercera Forma Normal (3FN)**. Este documento
justifica el cumplimiento de cada forma normal con ejemplos del propio modelo y explica las
denormalizaciones deliberadas (todas justificadas).

> **Al día con `main` del 21/10/2026** (30 tablas, ENG-158). Se revisaron las tablas que entraron
> después del diseño original: ninguna rompe la 3FN, y una —`chain_head_snapshots`— es una
> denormalización deliberada que se suma a la tabla del final. También se corrigió la afirmación
> sobre el append-only: lo hacen **triggers**, no políticas de RLS.

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
- **Contexto de la aceptación legal.** `legal_acceptances.ip` y `.user_agent` **no** son datos del
  perfil sino del *evento* de aceptación: describen desde dónde se aceptó esa versión, en ese
  momento. Guardarlos en `profiles` sería la dependencia transitiva —se sobrescribirían en la
  siguiente aceptación y se perdería el contexto de la anterior—. Acá dependen de la clave de la
  constancia, que es lo correcto.
- **Recordatorios colgados del turno.** `notifications.appointment_id` y la
  `UNIQUE (appointment_id, type, channel)` no denormalizan nada: el aviso es un hecho propio
  (cuándo se mandó, por qué canal, si se leyó) y el turno es su referencia. La unique es el
  mecanismo de idempotencia del job, no una copia de datos del turno.
- **El código de MediPass.** `medipass_codes.code` es `UNIQUE` desde ENG-170. No es una decisión de
  normalización sino de corrección: sin la restricción, dos pacientes podían tener el mismo código
  vigente y el canje resolvía al paciente equivocado.

## Denormalizaciones deliberadas (justificadas)

La 3FN es el objetivo, pero en dos lugares se elige conscientemente no descomponer más, por
razones de dominio y performance:

| Caso | Decisión | Justificación |
|------|----------|---------------|
| **Datos clínicos en `content` (JSONB)** | Se guarda el recurso FHIR R5 completo como documento, en lugar de descomponerlo en decenas de tablas relacionales | ADR-015: FHIR es el modelo estándar; descomponerlo perdería interoperabilidad y la capacidad de serializar el MediPass como Bundle. PostgreSQL permite consultas estructuradas sobre JSONB. |
| **`previous_hash` en cada entrada de HC** | Se almacena el hash de la entrada anterior, dato "derivable" recorriendo la cadena | ADR-014: es el mecanismo de integridad. Recalcularlo en cada lectura sería O(N); persistirlo permite verificación incremental y es la evidencia legal de inmutabilidad. |
| **`raw_payload` en `payment_webhook_events`** | Se guarda el JSON crudo del webhook además de los campos ya parseados | Trazabilidad y reproceso ante fallos; idempotencia. Es log, no fuente de verdad transaccional. |
| **`chain_head_snapshots`** | Guarda `head_hash` y `sequence_number`, que son **derivables** recorriendo `clinical_record_entries` | ENG-123. Es el caso más claro de la tabla: el dato derivado no está para ahorrar un cálculo sino para poder comparar **contra el pasado**. Una cadena de hash no conoce su propia longitud, así que recalcular la cabeza hoy no dice nada sobre si ayer era más larga. Sin esta copia, borrar las últimas entradas de un paciente es indetectable: las que quedan siguen contiguas y enlazadas desde el génesis. |

## Integridad referencial

- Toda relación se expresa con `FOREIGN KEY` a nivel base de datos (ADR-004).
- `ON DELETE`:
  - `CASCADE` en dependencias de composición (perfil → patient/professional, conversación →
    mensajes, profesional → agenda, turno → recordatorios).
  - `RESTRICT` en datos clínicos, catálogos y constancias: no se permite borrar una especialidad
    en uso, un paciente con HC, ni un perfil con aceptaciones legales registradas.
  - El `RESTRICT` de `legal_acceptances → profiles` es el único que bloquea el borrado de una
    cuenta, y es deliberado: la constancia de consentimiento no puede desaparecer con la cuenta
    que la otorgó. El conflicto con el derecho de supresión es la **decisión D1**, abierta.

### Append-only: cuatro tablas, por trigger

Cuatro tablas no admiten `UPDATE`, `DELETE` ni `TRUNCATE`: `clinical_record_entries`,
`audit_logs`, `medipass_access_logs` y `legal_acceptances`.

**Lo hacen triggers, no políticas de RLS.** La versión anterior de este documento afirmaba lo
segundo y es importante corregirlo, porque son garantías de alcance distinto:

- Una política de RLS decide si una fila es visible o escribible **para un rol**, y no se le
  aplica al dueño de la tabla salvo con `FORCE`. No existe forma de expresar "insertar sí,
  modificar nunca" con una política.
- Los triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` levantan `42501`
  (`insufficient_privilege`) **sin importar quién lo intente**, incluido el dueño.
- `TRUNCATE` necesita su propio trigger: no dispara los de `DELETE` ni lo frena RLS. Sin él, una
  sola sentencia vaciaba la tabla con los triggers de mutación intactos (lo detectó ENG-126).

El detalle, con los códigos de error de cada condición y hasta dónde llega la garantía, está en
[`esquema.md`](./esquema.md#integridad-e-inmutabilidad-triggers-y-códigos-de-error).

## Resumen

| Forma normal | Estado | Evidencia principal |
|--------------|--------|---------------------|
| 1FN | ✅ | `professional_specialties`, `professional_education`, `schedule_rules` |
| 2FN | ✅ | Tabla puente sin atributos no clave |
| 3FN | ✅ | Separación por rol, catálogos, sin dependencias transitivas |
| Denormalización controlada | ✅ justificada | FHIR JSONB, cadena de hash, webhook raw, ancla de cabeza |
| Inmutabilidad | ✅ por trigger | 4 tablas append-only con `42501`; la cadena de hash detecta lo que el trigger no previene |
