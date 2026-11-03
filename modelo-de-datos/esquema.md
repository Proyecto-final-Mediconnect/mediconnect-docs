# Esquema de Base de Datos — Detalle por tabla

PostgreSQL 15 (Supabase), schema `public`. Especificación de cada tabla, agrupada por épica.
Ver el diagrama en [`der.md`](./der.md) y la justificación de normalización en
[`normalizacion.md`](./normalizacion.md).

Convenciones: PK `id UUID DEFAULT gen_random_uuid()` salvo indicación; `created_at TIMESTAMPTZ
DEFAULT now()`.

> **Estado: al día con `main` del 21/10/2026** (30 tablas, 12 enums, 26 migraciones aplicadas).
>
> Este documento se escribió en ENG-89 como **diseño**, antes de implementar, y hasta ENG-158 se
> había tocado por última vez el 27/07. En el medio entraron 20 migraciones. ENG-158 lo pasó de
> describir lo que se iba a construir a describir **lo que está construido**, que no es lo mismo:
> varias decisiones cambiaron al implementarse y el documento todavía afirmaba la versión
> original.
>
> Lo que corrigió ENG-158, por si alguien venía usando la versión anterior:
>
> | Decía | Es |
> |---|---|
> | El append-only de la HC lo hacen las políticas de RLS | Lo hace un **trigger** que levanta `42501`; RLS no puede expresar "insertar sí, modificar no" sobre la misma fila |
> | `authenticated` puede `INSERT` en la HC | Tiene **solo `SELECT`**; escribe el backend como dueño de la tabla |
> | La preimagen del hash son 5 campos | Son **10**, en orden fijo, con JSON canónico (ver EP-06) |
> | `professional_status` incluye `ACTIVO` | Los valores son `PENDIENTE_VALIDACION_MATRICULA`, `VALIDADO`, `RECHAZADO`, `SUSPENDIDO` |
> | Las sesiones de MediPass leen la HC por una política propia | No existe esa política: MediPass expone el **bloque vital**, no la HC |
>
> **Cómo verificar que sigue al día:** `grep -c '^model ' mediconnect-backend/prisma/schema.prisma`
> tiene que dar la cantidad de tablas de este documento, y
> `ls mediconnect-backend/prisma/migrations | wc -l` la cantidad declarada arriba. El detalle de
> privilegios y triggers está en [Estado real de RLS](#estado-real-de-rls-y-privilegios-por-tabla)
> e [Integridad e inmutabilidad](#integridad-e-inmutabilidad-triggers-y-códigos-de-error), que se
> derivan de las migraciones y no del diseño.

---

## Tipos ENUM

| Tipo | Valores |
|------|---------|
| `user_role` | `PACIENTE`, `PROFESIONAL`, `MODERADOR` |
| `professional_status` | `PENDIENTE_VALIDACION_MATRICULA`, `VALIDADO`, `RECHAZADO`, `SUSPENDIDO` |
| `appointment_status` | `RESERVADO_SIN_PAGAR`, `CONFIRMADO`, `CANCELADO`, `COMPLETADO`, `NO_ASISTIO`, `LIBERADO` |
| `video_session_status` | `CREADA`, `EN_CURSO`, `FINALIZADA` |
| `payment_status` | `PENDIENTE`, `APROBADO`, `RECHAZADO`, `REEMBOLSADO` |
| `refund_status` | `PENDIENTE`, `PROCESADO`, `RECHAZADO` |
| `entry_type` | `CONSULTA`, `DIAGNOSTICO`, `PRESCRIPCION`, `ESTUDIO`, `CORRECCION` |
| `summary_status` | `PENDIENTE_VALIDACION`, `VALIDADO`, `DESCARTADO` |
| `review_status` | `PENDIENTE_MODERACION`, `APROBADA`, `RECHAZADA` |
| `notification_type` | `TURNO_RESERVADO`, `RECORDATORIO_24H`, `RECORDATORIO_1H`, `NUEVO_MENSAJE`, `PAGO_CONFIRMADO`, `RESENA_MODERADA` |
| `notification_channel` | `IN_APP`, `PUSH`, `EMAIL` |
| `legal_acceptance_source` | `REGISTER`, `REACCEPT` — por dónde se aceptaron los textos legales (ENG-140) |

Extensiones requeridas: `pgcrypto` (hash/uuid), `citext` (email case-insensitive), `pg_trgm`
(búsqueda fuzzy en catálogo).

---

## EP-01 — Identidad y Acceso

### `profiles`
Perfil base 1:1 con `auth.users` de Supabase. Portador del rol.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK, FK → `auth.users.id` | Misma id que Supabase Auth |
| `email` | citext | UK, NOT NULL | Espejo de `auth.users.email` |
| `role` | user_role | NOT NULL | Define de qué tabla especializada cuelga |
| `mfa_enabled` | boolean | NOT NULL, DEFAULT false | MFA TOTP (Supabase) |
| `created_at` / `updated_at` | timestamptz | NOT NULL | |

**RLS:** cada usuario lee/actualiza solo su propia fila (`id = auth.uid()`).

### `patients`
Perfil de paciente, 1:1 con `profiles` (cuando `role = PACIENTE`).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `profile_id` | uuid | PK, FK → `profiles.id` ON DELETE CASCADE | |
| `first_name` / `last_name` | text | NOT NULL | |
| `birth_date` | date | | |
| `dni` | varchar(15) | UK | Validado formato argentino en backend |
| `phone` | text | | |
| `address` | text | | |
| `created_at` / `updated_at` | timestamptz | | |

**RLS:** el propio paciente; y profesionales con relación vigente (vía `appointments`) en modo lectura.

**Ciclo de vida de la fila (ENG-47):** a diferencia de `professionals` —cuya fila la
crea el trigger `handle_new_user` en el alta—, la fila de `patients` **no existe hasta
que el paciente completa su perfil**. El registro solo pide email y contraseña, y
`first_name`/`last_name` son `NOT NULL`, así que la fila nace en la primera carga del
perfil (upsert). El backend expone `GET /patients/me` (devuelve `completed: false` si
aún no la creó) y `PUT /patients/me` (crea o reemplaza el perfil completo). La escritura
va con el cliente Supabase scopeado al JWT del paciente, de modo que RLS
(`patients_insert_own` / `patients_update_own`) garantice que solo toque su propia fila.

### `professionals`
Perfil de profesional, 1:1 con `profiles` (cuando `role = PROFESIONAL`).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `profile_id` | uuid | PK, FK → `profiles.id` ON DELETE CASCADE | |
| `first_name` / `last_name` | text | NOT NULL | |
| `license_number` | varchar(30) | NOT NULL | Matrícula; validada manualmente en MVP |
| `bio` | varchar(500) | | |
| `photo_url` | text | | Ruta en Supabase Storage |
| `consultation_price` | numeric(10,2) | CHECK (>= 0) | |
| `currency` | char(3) | DEFAULT 'ARS' | |
| `status` | professional_status | NOT NULL, DEFAULT `PENDIENTE_VALIDACION_MATRICULA` | |
| `mercadopago_account_id` | text | | Cuenta vendedora asociada |
| `created_at` / `updated_at` | timestamptz | | |

**RLS:** `FORCE ROW LEVEL SECURITY`. `authenticated` tiene `GRANT SELECT` y las políticas
`professionals_select_own` y `professionals_update_own`: **cada profesional ve y edita su propia
fila, y nada más**.

El perfil público —nombre, bio, especialidades, precio— **no sale de esta tabla por PostgREST**.
Lo sirve el backend por Prisma (`/professionals/:id` y el catálogo), que filtra por
`status = VALIDADO`. Es una decisión de diseño y no un pendiente: una política de lectura pública
sobre la tabla expondría también `mercadopago_account_id` y el resto de las columnas operativas,
porque RLS filtra filas y no columnas.

El estado que habilita el perfil público es **`VALIDADO`**. La versión anterior de este documento
decía `ACTIVO`, que no es un valor del enum.

### `legal_acceptances`
Constancia de que un perfil aceptó los términos, la política de privacidad y el consentimiento de
datos de salud, en una versión determinada (ENG-140).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `profile_id` | uuid | FK → `profiles.id` ON DELETE RESTRICT | |
| `version` | varchar(20) | NOT NULL | Versión de los textos aceptados |
| `accepted_at` | timestamptz | DEFAULT `now()` | |
| `source` | legal_acceptance_source | NOT NULL | `REGISTER` o `REACCEPT` |
| `ip` | inet | nullable | IP real del cliente (`CF-Connecting-IP`, ENG-84) |
| `user_agent` | varchar(512) | nullable | |

Restricciones: `UNIQUE (profile_id, version)` — una constancia por perfil y versión.

**Por qué `ON DELETE RESTRICT` y no `CASCADE`.** Es la única FK a `profiles` del esquema que no
cascadea, y es a propósito: si al borrar una cuenta se borrara su constancia de consentimiento,
desaparecería justo la prueba de que esa persona autorizó el tratamiento de sus datos de salud.
Esto choca de frente con el derecho de supresión, y es la **decisión D1** del plan de cierre, que
sigue abierta: hay que resolver cómo se borra una cuenta sin perder la constancia, probablemente
anonimizando el perfil en lugar de borrar la fila.

**Append-only.** Trigger `legal_acceptances_no_mutation`, que levanta `42501` ante `UPDATE` o
`DELETE`, y `legal_acceptances_no_truncate` ante `TRUNCATE`. Una constancia que se puede editar no
es una constancia: el valor probatorio depende de que nadie —ni el equipo— pueda cambiar la fecha
ni la versión después del hecho. Ver
[Integridad e inmutabilidad](#integridad-e-inmutabilidad-triggers-y-códigos-de-error).

**RLS:** habilitada **sin ninguna política**, o sea denegado por defecto para `authenticated` y
`anon`. La escribe y la lee el backend por Prisma: `JwtAuthGuard` consulta la aceptación vigente
en cada request que no esté marcada con `@SkipLegal()`.

---

## EP-02 — Catálogo, Búsqueda y Reseñas

### `specialties`
Catálogo curado de especialidades.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `name` | text | UK, NOT NULL |
| `created_at` | timestamptz | |

### `professional_specialties`
Junction N:M profesional ↔ especialidad (máx. 3 por profesional, validado en backend).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `professional_id` | uuid | PK, FK → `professionals.profile_id` ON DELETE CASCADE |
| `specialty_id` | uuid | PK, FK → `specialties.id` ON DELETE RESTRICT |

PK compuesta `(professional_id, specialty_id)`.

### `professional_education`
Formación académica (1:N). Resuelve el grupo repetitivo → 1FN.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `professional_id` | uuid | FK → `professionals.profile_id` ON DELETE CASCADE |
| `institution` | text | NOT NULL |
| `degree` | text | NOT NULL |
| `year` | smallint | |
| `created_at` | timestamptz | |

### `reviews`
Reseña de un paciente a un profesional, atada al turno atendido (1 reseña por turno).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `patient_id` | uuid | FK → `patients.profile_id` | |
| `professional_id` | uuid | FK → `professionals.profile_id` | |
| `appointment_id` | uuid | UK, FK → `appointments.id` | Evita reseñas duplicadas |
| `rating` | smallint | CHECK (1..5), NOT NULL | |
| `comment` | text | | |
| `status` | review_status | DEFAULT `PENDIENTE_MODERACION` | |
| `moderator_id` | uuid | FK → `profiles.id` | Quién moderó |
| `moderation_reason` | text | | |
| `moderated_at` / `created_at` | timestamptz | | |

### `review_responses`
Respuesta pública del profesional (1:1 con la reseña).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `review_id` | uuid | UK, FK → `reviews.id` ON DELETE CASCADE |
| `professional_id` | uuid | FK → `professionals.profile_id` |
| `content` | text | NOT NULL |
| `created_at` | timestamptz | |

---

## EP-03 — Agenda y Turnos

### `schedule_rules`
Disponibilidad semanal recurrente del profesional.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `professional_id` | uuid | FK → `professionals.profile_id` ON DELETE CASCADE | |
| `weekday` | smallint | CHECK (0..6) | 0 = domingo |
| `start_time` / `end_time` | time | CHECK (end > start) | |
| `slot_duration_minutes` | smallint | CHECK IN (15,30,45,60) | |
| `created_at` / `updated_at` | timestamptz | | |

### `schedule_blocks`
Bloqueos puntuales / feriados.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `professional_id` | uuid | FK → `professionals.profile_id` ON DELETE CASCADE | |
| `block_date` | date | NOT NULL | |
| `start_time` | time | nullable | `null` = día completo |
| `end_time` | time | nullable | `null` = día completo |
| `reason` | text | | |
| `created_at` | timestamptz | | |

Restricciones: `UNIQUE (professional_id, block_date, start_time) NULLS NOT DISTINCT`.

El modificador `NULLS NOT DISTINCT` (PostgreSQL 15+) es necesario y no cosmético: sin él,
`NULL != NULL` y un profesional podría cargar dos veces el mismo bloqueo de **día completo**,
que es justamente el caso con `start_time` en `null`. Prisma todavía no sabe expresarlo, así que
el índice se crea en la migración de ENG-53 y se declara en el schema con el mismo nombre para
que no lo vea como drift.

**RLS:** políticas `schedule_blocks_select_own` / `_insert_own` / `_delete_own`; `authenticated`
tiene `GRANT SELECT, INSERT, DELETE`. No hay `UPDATE`: un bloqueo se borra y se vuelve a crear.

### `cancellation_policies`
Política de cancelación/reembolso por profesional (1:1).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `professional_id` | uuid | PK, FK → `professionals.profile_id` ON DELETE CASCADE |
| `hours_full_refund` | smallint | Horas de antelación para reembolso total |
| `hours_partial_refund` | smallint | Horas para reembolso parcial |
| `partial_refund_percent` | smallint | CHECK (0..100) |
| `created_at` / `updated_at` | timestamptz | |

### `appointments`
Turno reservado. La relación profesional↔paciente se deriva de esta tabla.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `patient_id` | uuid | FK → `patients.profile_id` | |
| `professional_id` | uuid | FK → `professionals.profile_id` | |
| `scheduled_at` | timestamptz | NOT NULL | |
| `duration_minutes` | smallint | NOT NULL | |
| `price` | numeric(10,2) | NOT NULL | Precio congelado al reservar |
| `status` | appointment_status | DEFAULT `RESERVADO_SIN_PAGAR` | |
| `cancellation_reason` | text | | |
| `cancelled_at` | timestamptz | | |
| `created_at` / `updated_at` | timestamptz | | |

Índice: `(professional_id, scheduled_at)` para evitar solapamientos y acelerar la agenda.

**RLS:** el paciente y el profesional del turno.

---

## EP-05 — Consulta y Videoconsulta

### `consultations`
Sesión efectivamente realizada (glosario: *Consulta*), 1:1 con el turno.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `appointment_id` | uuid | UK, FK → `appointments.id` |
| `started_at` / `ended_at` | timestamptz | |
| `professional_notes` | text | Notas privadas del profesional |
| `created_at` | timestamptz | |

### `video_sessions`
Sala de Daily.co asociada a la consulta (ADR-010).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `consultation_id` | uuid | UK, FK → `consultations.id` ON DELETE CASCADE | |
| `daily_room_name` / `daily_room_url` | text | | Devueltos por la API de Daily |
| `audio_recording_url` | text | | Insumo del pipeline de transcripción |
| `status` | video_session_status | DEFAULT `CREADA` | |
| `started_at` / `ended_at` / `created_at` | timestamptz | | |

---

## EP-04 — Pagos (MercadoPago, ADR-013)

### `payments`
Pago de un turno (1:1). MediConnect **no** almacena datos de tarjeta (PCI queda en MercadoPago).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `appointment_id` | uuid | UK, FK → `appointments.id` | |
| `mercadopago_preference_id` | text | | Preferencia de pago creada |
| `mercadopago_payment_id` | text | | Id del pago confirmado |
| `amount` | numeric(10,2) | NOT NULL | |
| `currency` | char(3) | DEFAULT 'ARS' | |
| `method` | text | | Medio elegido (informativo) |
| `status` | payment_status | DEFAULT `PENDIENTE` | |
| `confirmed_at` / `created_at` | timestamptz | | |

### `payment_webhook_events`
Bitácora cruda de webhooks de MercadoPago (idempotencia + auditoría de firma).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `payment_id` | uuid | FK → `payments.id` (nullable hasta correlacionar) |
| `mercadopago_payment_id` | text | Para correlación |
| `raw_payload` | jsonb | NOT NULL |
| `signature` | text | Firma a verificar |
| `processed` | boolean | DEFAULT false |
| `received_at` / `processed_at` | timestamptz | |

### `refunds`
Reembolsos (1:N sobre un pago).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `payment_id` | uuid | FK → `payments.id` |
| `amount` | numeric(10,2) | NOT NULL |
| `status` | refund_status | DEFAULT `PENDIENTE` |
| `reason` | text | |
| `processed_at` / `created_at` | timestamptz | |

---

## EP-06 — Historia Clínica

### `clinical_record_entries`
Entrada inmutable de HC. **Append-only + cadena de hash SHA-256** (ADR-014). Los datos clínicos
se guardan como recurso **FHIR R5 en `content` (JSONB)** con codificación ICD-10 / SNOMED CT /
LOINC embebida (ADR-015).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `patient_id` | uuid | FK → `patients.profile_id` | Dueño de la HC |
| `professional_id` | uuid | FK → `professionals.profile_id` | Autor |
| `consultation_id` | uuid | FK → `consultations.id` (nullable) | Origen si aplica |
| `corrects_entry_id` | uuid | FK → `clinical_record_entries.id` (nullable) | Solo en `CORRECCION` |
| `entry_type` | entry_type | NOT NULL | |
| `fhir_resource_type` | text | NOT NULL | Ej: `Condition`, `Observation` |
| `content` | jsonb | NOT NULL | Recurso FHIR R5 |
| `sequence_number` | bigint | NOT NULL | Orden dentro de la HC del paciente |
| `content_hash` | char(64) | NOT NULL | SHA-256 de esta entrada |
| `previous_hash` | char(64) | NOT NULL | `content_hash` de la entrada previa |
| `created_at` | timestamptz | NOT NULL | |

Restricciones: `UNIQUE (patient_id, sequence_number)`.

**Cadena de hash.** La preimagen son **diez campos en orden fijo, unidos por `\n`**:

```
preimagen = patient_id         \n
            professional_id    \n
            sequence_number    \n
            entry_type         \n
            fhir_resource_type \n
            content            \n   <- JSON canónico (JCS, RFC 8785)
            consultation_id    \n   <- cadena vacía si es null
            corrects_entry_id  \n   <- cadena vacía si es null
            created_at         \n   <- ISO-8601 con milisegundos
            previous_hash

content_hash  = SHA-256( preimagen )
previous_hash = content_hash de la entrada anterior del mismo paciente
                (génesis = 64 ceros en la primera)
```

Las columnas que **no** entran son `id` y `content_hash`. Todo lo demás sí, y el orden es parte
del diseño: cambiarlo produce hashes distintos sobre los mismos datos. La lista canónica vive en
`PREIMAGE_COLUMNS` (`src/common/hash-chain/hash-chain.ts`), que es la fuente de verdad.

> La versión anterior de este documento declaraba una preimagen de cinco campos
> (`patient_id ‖ sequence_number ‖ entry_type ‖ content::text ‖ previous_hash`). No es la
> implementada, y la diferencia importa: con esa definición, cambiar el autor de una entrada o su
> fecha no alteraría el hash.

Tres detalles de los que depende que la verificación sea reproducible, y que están así por
hallazgos del spike [ENG-45](../spikes/ENG-45-hash-chain.md):

- **`content` se serializa con JSON canónico** (JCS / RFC 8785, orden de claves por unidades de
  código UTF-16). `jsonb` de PostgreSQL no preserva el orden de las claves, así que
  `content::text` da una cadena distinta según cómo se escribió la fila: el hash tiene que
  calcularse sobre una forma canónica o no es reproducible.
- **`created_at` es `timestamptz(3)`, con milisegundos.** Con la precisión por defecto de
  PostgreSQL (microsegundos) el valor que vuelve de la base no coincide con el que la aplicación
  usó para hashear, y la verificación falla sobre datos intactos. Es el hallazgo principal de
  ENG-45.
- **El hash lo calcula la aplicación, no la base.** La base solo verifica el **enlace** (génesis,
  contigüidad y `previous_hash`), no recalcula el hash. Hacerlo en SQL obligaría a reimplementar
  la serialización canónica en PL/pgSQL y a mantener las dos implementaciones de acuerdo.

Modificar una entrada invalida el hash de todas las siguientes, y lo detecta el job de
verificación (`integrity_checks`). Lo que la cadena **no** detecta por sí sola es el truncado de
la cola: si se borran las ultimas N entradas, las que quedan siguen contiguas y enlazadas desde
el génesis. Para eso existe `chain_head_snapshots` (ver EP-10).

**Append-only: lo hace un trigger, no RLS.** Es la corrección más importante de ENG-158 sobre
este documento.

`clinical_record_entries_no_mutation` es un trigger `BEFORE UPDATE OR DELETE` que levanta
**`42501`** (`insufficient_privilege`) sin importar quién lo intente, y
`clinical_record_entries_no_truncate` hace lo mismo ante `TRUNCATE`. **RLS no puede expresar
esto**: una política decide si una fila es visible o escribible para un rol, no "esta fila se
puede insertar pero nunca modificar". Y aun con una política de `UPDATE` denegada, el dueño de la
tabla la saltearía; el trigger corre igual.

`authenticated` tiene **solo `GRANT SELECT`** sobre esta tabla. No puede insertar: la escritura la
hace el backend con Prisma como dueño, tras validar el enlace de la cadena. La versión anterior de
este documento decía que las políticas "solo permiten `INSERT`", que es al revés de cómo está.

Las correcciones son entradas nuevas de tipo `CORRECCION` que apuntan a la original vía
`corrects_entry_id`, con `UNIQUE (corrects_entry_id)`: una entrada se corrige una sola vez, y para
cambiar un dato dos veces hay que corregir la corrección. Así la cadena de correcciones es lineal
y siempre hay una sola "última versión" de un dato.

**Lectura (RLS).** `FORCE ROW LEVEL SECURITY` y tres políticas de `SELECT`:

| Política | Quién |
|---|---|
| `clinical_record_entries_select_own_patient` | El paciente titular de la HC |
| `clinical_record_entries_select_assigned_professional` | El profesional con un turno en estado que habilita la atencion |
| `clinical_record_entries_select_own_authored` | El profesional que escribió la entrada, aunque ya no tenga turno vigente |

Todo acceso se registra en `audit_logs`, y la escritura de ese registro **falla cerrado**: si no
se puede auditar, no se entrega la HC (Ley 26.529, art. 15).

> No existe una política de MediPass sobre esta tabla. La versión anterior mencionaba "sesiones
> MediPass activas no revocadas", y eso no es lo que hace MediPass: expone el **bloque vital**
> —datos de urgencia del perfil del paciente— y no la historia clínica. Ver EP-09.

---

## EP-07 — Inteligencia Artificial Clínica

### `consultation_summaries`
Transcripción (Whisper) + resumen estructurado (Gemini) pendiente de validación profesional
(ADR-012). Solo al validarse se incorpora como entrada de HC.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `consultation_id` | uuid | UK, FK → `consultations.id` | |
| `transcription_text` | text | | Salida de Whisper |
| `summary_content` | jsonb | | Resumen estructurado |
| `status` | summary_status | DEFAULT `PENDIENTE_VALIDACION` | |
| `validated_by` | uuid | FK → `professionals.profile_id` (nullable) | |
| `incorporated_entry_id` | uuid | FK → `clinical_record_entries.id` (nullable) | Entrada generada al validar |
| `generated_at` / `validated_at` / `created_at` | timestamptz | | |

---

## EP-08 — Comunicación

### `conversations`
Hilo único por par paciente-profesional.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `patient_id` | uuid | FK → `patients.profile_id` |
| `professional_id` | uuid | FK → `professionals.profile_id` |
| `created_at` | timestamptz | |

Restricción: `UNIQUE (patient_id, professional_id)`.

### `messages`
Mensajes del chat (ADR-011, Supabase Realtime).

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `conversation_id` | uuid | FK → `conversations.id` ON DELETE CASCADE |
| `sender_id` | uuid | FK → `profiles.id` |
| `content` | text | |
| `attachment_url` | text | Adjunto en Storage |
| `read_at` / `created_at` | timestamptz | |

**RLS:** solo los dos participantes de la conversación (aplica también a la suscripción Realtime).

### `notifications`
Notificaciones in-app / push / email.

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `user_id` | uuid | FK → `profiles.id` | Destinatario |
| `appointment_id` | uuid | FK → `appointments.id` ON DELETE CASCADE (nullable) | Turno al que se refiere (ENG-68); `null` en los avisos que no son de un turno |
| `type` | notification_type | NOT NULL | |
| `channel` | notification_channel | NOT NULL | |
| `payload` | jsonb | | |
| `sent_at` / `read_at` / `created_at` | timestamptz | | |

Restricciones: `UNIQUE (appointment_id, type, channel)`.

Esa unique **es el mecanismo de idempotencia** de los recordatorios (ENG-68), no una validación
de forma: el job que manda los avisos corre cada pocos minutos y puede volver a ver el mismo turno
dentro de la misma ventana. La unique garantiza un aviso de cada tipo por turno y canal, así que
reintentar nunca manda dos veces el mismo email. Los avisos sin turno quedan fuera de la
restricción, porque en PostgreSQL `NULL` no es distinto de otro `NULL` para una unique común —y
acá eso es lo que se quiere.

**RLS:** sin habilitar. No tiene `GRANT` para `authenticated` ni `anon`, así que hoy es inalcanzable
por PostgREST; ver la salvedad en
[Estado real de RLS](#estado-real-de-rls-y-privilegios-por-tabla).

### `push_tokens`
Tokens de Expo Push por dispositivo.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `profiles.id` ON DELETE CASCADE |
| `token` | text | UK |
| `platform` | text | `ios` / `android` |
| `created_at` | timestamptz | |

---

## EP-09 — MediPass

### `medipass_codes`
Código rotatorio de un solo uso, vigente 5 minutos (glosario: *Código MediPass*).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `patient_id` | uuid | FK → `patients.profile_id` ON DELETE CASCADE | |
| `code` | varchar(8) | NOT NULL | Numérico |
| `expires_at` | timestamptz | NOT NULL | `created_at + 5 min` |
| `used_at` | timestamptz | | Consumido al iniciar sesión |
| `created_at` | timestamptz | | |

### `medipass_sessions`
Sesión de acceso de un consultante (por defecto 30 min, revocable).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `patient_id` | uuid | FK → `patients.profile_id` | |
| `medipass_code_id` | uuid | FK → `medipass_codes.id` | Código que la habilitó |
| `consultant_profile_id` | uuid | FK → `profiles.id` (nullable) | Si el consultante es usuario |
| `consultant_name` | text | | Si es externo sin cuenta |
| `consultant_license` | varchar(30) | | Matrícula declarada |
| `expires_at` | timestamptz | NOT NULL | `started_at + 30 min` por defecto |
| `revoked_at` | timestamptz | | Revocación por el paciente |
| `revoked_by` | uuid | FK → `profiles.id` (nullable) | |
| `started_at` | timestamptz | NOT NULL | |

Sesión **activa** = `revoked_at IS NULL AND now() < expires_at`.

### `medipass_access_logs`
Auditoría de accesos dentro de una sesión MediPass.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `session_id` | uuid | FK → `medipass_sessions.id` |
| `patient_id` | uuid | FK → `patients.profile_id` |
| `resource_accessed` | text | Qué recurso se leyó |
| `accessed_at` | timestamptz | |

---

## EP-10 — Plataforma y Auditoría

### `audit_logs`
Bitácora inmutable (append-only vía RLS) de accesos a HC y MediPass, y acciones sensibles.

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `actor_id` | uuid | FK → `profiles.id` (nullable si sistema) |
| `action` | text | NOT NULL |
| `resource_type` | text | NOT NULL |
| `resource_id` | uuid | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | NOT NULL |

### `integrity_checks`
Resultado del job semanal de verificación de la cadena de hash (TT-03 / ENG-85).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `id` | uuid | PK | |
| `status` | text | NOT NULL | `OK`, `INCONSISTENT`, `ANCHOR_REGRESSION`, `ERROR` |
| `inconsistencies_found` | integer | DEFAULT 0 | |
| `details` | jsonb | | Pacientes/entradas afectadas |
| `run_at` | timestamptz | NOT NULL | |

Índice: `(run_at)`.

Los cuatro valores de `status` importan y no son intercambiables:

| Valor | Qué pasó |
|---|---|
| `OK` | La cadena de todos los pacientes verifica y ninguna se acortó |
| `INCONSISTENT` | Un hash no coincide: alguien modificó una entrada |
| `ANCHOR_REGRESSION` | La cadena de un paciente **se acortó** respecto de la corrida anterior (ver `chain_head_snapshots`) |
| `ERROR` | El job no pudo terminar |

`ANCHOR_REGRESSION` y `ERROR` se agregaron después del diseño original, y por la misma razón en
los dos casos: colapsados dentro de `INCONSISTENT` o de `OK` dejan una racha de corridas verdes
que nadie mira. Un job que falla en silencio es peor que no tenerlo, porque produce confianza
infundada.

### `chain_head_snapshots`
Cabeza de la cadena de HC de cada paciente al cierre de la última corrida sana del job de ENG-85
(ENG-123).

| Columna | Tipo | Restricciones | Notas |
|---------|------|---------------|-------|
| `patient_id` | uuid | PK, FK → `patients.profile_id` | Una fila por paciente |
| `head_hash` | char(64) | NOT NULL | `content_hash` de la última entrada vista |
| `sequence_number` | bigint | NOT NULL | Con la cadena validada, es también la cantidad de entradas |
| `first_seen_at` | timestamptz(3) | DEFAULT `now()` | |
| `updated_at` | timestamptz(3) | DEFAULT `now()` | |

**Por qué existe: una cadena de hash no conoce su propia longitud.** Es el segundo agujero que
documenta el spike [ENG-45](../spikes/ENG-45-hash-chain.md), y el que más importa clínicamente.

Si se borran las últimas N entradas de un paciente, las que quedan **siguen siendo válidas**:
arrancan en el génesis, son contiguas y cada `previous_hash` coincide con el `content_hash`
anterior. `verifyChain` devuelve `valid: true` y el truncado pasa invisible. Y es el ataque más
plausible de los dos: para ocultar un diagnóstico reciente es mucho más simple borrarlo que
falsificar la cadena hacia adelante.

Guardando la cabeza de la corrida anterior, la siguiente puede afirmar dos cosas que la cadena
sola no puede:

1. Que la cadena **no se acortó** — `sequence_number` nunca baja.
2. Que la entrada que era la cabeza **sigue estando ahí**, con el mismo hash.

Si alguna de las dos falla, el job reporta `ANCHOR_REGRESSION`. `timestamptz(3)` y no `(6)` por el
mismo motivo que en `clinical_record_entries`: los milisegundos son la precisión con la que la
aplicación calcula los hashes.

**RLS:** sin habilitar, y sin `GRANT`. La escribe y la lee únicamente el job, por Prisma.

---

## Índices recomendados (además de PK/UK/FK)

| Tabla | Índice | Motivo |
|-------|--------|--------|
| `professionals` | GIN `pg_trgm` sobre `first_name`, `last_name` | Búsqueda fuzzy del catálogo |
| `professionals` | `(status)` | Filtrar solo `VALIDADO` en catálogo público |
| `appointments` | `(professional_id, scheduled_at)` | Agenda y detección de solapamiento |
| `appointments` | `(patient_id, scheduled_at)` | "Mis turnos" |
| `clinical_record_entries` | `(patient_id, sequence_number)` | Recorrer/verificar cadena de hash |
| `messages` | `(conversation_id, created_at)` | Paginar chat |
| `medipass_sessions` | `(patient_id, expires_at)` | Sesiones activas |
| `payment_webhook_events` | `(mercadopago_payment_id)` | Idempotencia de webhooks |

---

## Integridad e inmutabilidad: triggers y códigos de error

Esta sección es el núcleo técnico del proyecto y hasta ENG-158 vivía únicamente en los comentarios
de las migraciones. Es también lo que sostiene el requisito de inalterabilidad del registro
clínico de la **Ley 26.529, art. 15**.

### Las cuatro tablas append-only

| Tabla | Triggers | Por qué |
|---|---|---|
| `clinical_record_entries` | `_no_mutation`, `_no_truncate`, `_link` | El registro clínico es inalterable por ley |
| `audit_logs` | `_no_mutation`, `_no_truncate` | Una bitácora que se puede editar no prueba nada |
| `medipass_access_logs` | `_no_mutation`, `_no_truncate` | Es lo que le permite al paciente auditar quién vio su ficha |
| `legal_acceptances` | `_no_mutation`, `_no_truncate` | Es la constancia de un consentimiento: su valor depende de que nadie pueda cambiar la fecha |

Los triggers `_no_mutation` son `BEFORE UPDATE OR DELETE` y los `_no_truncate` son
`BEFORE TRUNCATE`. Todos levantan la misma excepción:

```
ERRCODE 42501  (insufficient_privilege)
```

El mensaje nombra la operación que se intentó (`tg_op`), así que en los logs se distingue un
`UPDATE` de un `DELETE` de un `TRUNCATE`.

### Por qué en la base y no en la aplicación

Es la pregunta que hay que poder contestar en la defensa, y tiene tres partes.

**1. RLS no puede expresarlo.** Una política decide si una fila es visible o escribible para un
rol. No existe forma de escribir "esta fila se puede insertar pero nunca modificar": sería una
política de `UPDATE` con `USING (false)`, y eso solo afecta a los roles a los que RLS se les
aplica. El dueño de la tabla la saltea. El trigger corre siempre.

**2. Una regla en el service protege solo al service.** Cualquier cosa que llegue a la base por
otro camino —una consola de SQL, un script de migración, un `psql` manual, una integración
futura— no pasa por el código de NestJS. El trigger es el único lugar donde la regla vale para
todos los caminos a la vez.

**3. `TRUNCATE` no es un `DELETE`.** Es la razón por la que los triggers `_no_truncate` existen
aparte: `TRUNCATE` no dispara triggers de `DELETE` y no lo frena una política de RLS. Sin un
trigger propio de `BEFORE TRUNCATE`, una sola sentencia vaciaba la tabla entera dejando los
triggers de mutación intactos y sin registrar nada. Lo detectó ENG-126 auditando el modelo de
ENG-57, y es el ejemplo más claro de por qué conviene escribir esta sección: la primera versión
del append-only parecía completa y no lo estaba.

### Hasta dónde llega la garantía

Esto es lo que **no** hay que afirmar de más, porque es lo que una pregunta bien hecha va a buscar:

- **Un superusuario puede `ALTER TABLE ... DISABLE TRIGGER`.** Quien tenga ese nivel de acceso a la
  base puede desactivar el trigger, modificar la fila y volverlo a activar. La inmutabilidad es
  frente a la aplicación y frente a cualquier rol operativo, **no frente a quien administra el
  motor**.
- Lo que sí queda es la **cadena de hash**: una modificación hecha por ese camino rompe el enlace
  de todas las entradas siguientes, y el job de ENG-85 lo reporta. El trigger previene; la cadena
  detecta. Son dos capas distintas y ninguna reemplaza a la otra.
- La defensa contra el truncado de la cola no es ninguna de las dos, sino
  `chain_head_snapshots`, por el motivo que explica esa tabla.

### El trigger de enlace de la cadena

`clinical_record_entries_link` (`BEFORE INSERT`) valida que la entrada nueva encaje en la cadena
del paciente. **No recalcula el hash** —eso lo hace la aplicación—, solo verifica el enlace:

| Condición que falla | ERRCODE | Significado |
|---|---|---|
| Primera entrada del paciente con `sequence_number != 1` | `23514` | La cadena tiene que arrancar en 1 |
| Primera entrada con `previous_hash` distinto de 64 ceros | `23514` | La primera entrada apunta al génesis |
| `sequence_number` no es el siguiente de la cabeza | `23514` | Hueco o repetición en la secuencia |
| `previous_hash` no coincide con el `content_hash` de la cabeza | `40001` | La cabeza se movió entre que se leyó y se insertó |
| `corrects_entry_id` apunta a una entrada inexistente | `23503` | FK lógica que la FK real no cubre |
| `corrects_entry_id` apunta a la HC de **otro paciente** | `23514` | Una corrección no puede cruzar historias clínicas |

El `40001` (`serialization_failure`) es deliberado y no un detalle: Prisma lo traduce a `P2034`, y
el service lo trata como **reintentable**. Es el caso de dos escrituras concurrentes sobre la misma
HC —hoy, el profesional y el pipeline de IA— donde la entrada es válida y solo le tocaba otro
número. Con un `23514` genérico, el reintento habría sido imposible de distinguir de un error
permanente.

El caso de la corrección cruzada lo agregó ENG-126: la FK de `corrects_entry_id` solo exige que el
id **exista**, así que sin este chequeo una entrada de la HC de A podía quedar apuntando a una
entrada de B, de forma permanente, porque la tabla es append-only y `corrects_entry_id` entra en
la preimagen del hash.

---

## Estado real de RLS y privilegios por tabla

Las 30 tablas no están todas en el mismo estado, y la diferencia es intencional. El proyecto usa
**cuatro niveles**, de más abierto a más cerrado.

### Nivel 1 — RLS con políticas (10 tablas)

El cliente llega a la tabla por PostgREST con su JWT, y **la autoridad es RLS**.

| Tabla | `GRANT` a `authenticated` | Políticas |
|---|---|---|
| `profiles` | `SELECT, UPDATE` | `profiles_select_own`, `profiles_update_own` |
| `patients` | `SELECT, INSERT, UPDATE` | `patients_select_own`, `_insert_own`, `_update_own`, `_select_related_professional` |
| `professionals` | `SELECT` | `professionals_select_own`, `_update_own` |
| `specialties` | `SELECT` (y a `anon`) | `specialties_select_all` |
| `professional_specialties` | `SELECT, INSERT, DELETE` | `pro_specialties_select_own`, `_insert_own`, `_delete_own` |
| `schedule_rules` | `SELECT, INSERT, DELETE` | `schedule_rules_select_own`, `_insert_own`, `_delete_own` |
| `schedule_blocks` | `SELECT, INSERT, DELETE` | `schedule_blocks_select_own`, `_insert_own`, `_delete_own` |
| `appointments` | `SELECT, INSERT` | `appointments_select_own`, `appointments_insert_own_patient` |
| `payments` | `SELECT` | `payments_select_own_patient` |
| `clinical_record_entries` | `SELECT` | `_select_own_patient`, `_select_assigned_professional`, `_select_own_authored` |

**`FORCE ROW LEVEL SECURITY`** está solo en `profiles`, `patients`, `professionals` y
`clinical_record_entries`. Sin `FORCE`, RLS no se le aplica al dueño de la tabla; con `FORCE`, sí.
Se usa donde el backend **no** necesita escribir por fuera de RLS. En `appointments` y `payments`
no está, y es a propósito: el webhook de MercadoPago es público, no tiene JWT de nadie y escribe
por Prisma como dueño.

> El rol `postgres` tiene `BYPASSRLS`, así que Prisma sigue funcionando incluso sobre las tablas
> con `FORCE`. Cuando entre ENG-138 —que pasa el backend a un rol de aplicación sin `BYPASSRLS`—
> estas tablas van a necesitar `GRANT` explícitos o políticas propias para el rol nuevo.

### Nivel 2 — RLS habilitada sin ninguna política (8 tablas)

`consultations`, `video_sessions`, `payment_webhook_events`, `medipass_codes`,
`medipass_sessions`, `medipass_access_logs`, `audit_logs`, `legal_acceptances`.

RLS activa con cero políticas significa **denegado por defecto**: ningún `SELECT` de
`authenticated` ni de `anon` devuelve una fila. Todo el acceso pasa por el backend, que entra como
dueño y filtra en el código.

Esto importa más de lo que parece, y el caso de MediPass lo muestra: **la `anon key` de Supabase
viaja en el bundle de la web y no es un secreto**. Sin RLS, cualquiera con esa clave leía
`medipass_codes` entera y abría el MediPass de cualquier paciente sin escanear nada.

La contracara es que, en estas tablas, el filtrado por dueño es responsabilidad del código y no de
la base, y por eso cada consulta del backend lleva el `patient_id` explícito.

### Nivel 3 — Sin RLS y sin `GRANT` (12 tablas)

`cancellation_policies`, `chain_head_snapshots`, `consultation_summaries`, `conversations`,
`integrity_checks`, `messages`, `notifications`, `professional_education`, `push_tokens`,
`refunds`, `review_responses`, `reviews`.

Estas tablas se crearon con el esquema inicial (EP-02 / EP-10) y todavía **no las estrena ninguna
ruta**, o las usa solo el backend por Prisma. Hoy son inalcanzables por PostgREST, pero por una
razón distinta de las del nivel 2: **no tienen ningún privilegio otorgado**, y PostgreSQL deniega
por ausencia de privilegio antes de llegar a evaluar RLS.

**La consecuencia hay que decirla, porque es una trampa:** la protección descansa en la *ausencia*
de un `GRANT`, no en una política. El día que alguien agregue `grant select on reviews to
authenticated` para que la web lea las reseñas, la tabla queda **completamente abierta** —todas
las filas, para cualquier usuario autenticado— porque no hay ninguna política que la limite.

La convención del proyecto es justamente evitar eso: **la historia que estrena una tabla trae sus
permisos**. Es lo que hicieron ENG-48 (`professionals`), ENG-54 (`appointments`), ENG-57
(`clinical_record_entries`), ENG-63 (`payments`) y ENG-72/73 (`medipass_*`), cada una cerrando la
tabla que empezaba a usar. Quien estrene una de las 12 que quedan tiene que hacer lo mismo en la
misma migración.

### Nivel 4 — Append-only por trigger (4 tablas)

Las de la sección anterior: `clinical_record_entries`, `audit_logs`, `medipass_access_logs` y
`legal_acceptances`. Es un nivel aparte y no una variante del 2, porque el trigger protege contra
algo distinto: los niveles 1 a 3 deciden **quién** llega a la fila, el trigger decide **qué se le
puede hacer** una vez que se llegó. Las cuatro están además en el nivel 1 o 2.

### Cómo verificar esto contra la base

```sql
-- Nivel de RLS por tabla
select c.relname,
       c.relrowsecurity  as rls_habilitada,
       c.relforcerowsecurity as rls_forzada,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- Privilegios otorgados a los roles de Supabase
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name;

-- Triggers append-only
select event_object_table, trigger_name, event_manipulation, action_timing
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```
