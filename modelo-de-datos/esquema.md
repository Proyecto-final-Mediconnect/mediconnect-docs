# Esquema de Base de Datos — Detalle por tabla

PostgreSQL 15 (Supabase), schema `public`. Especificación de cada tabla, agrupada por épica.
Ver el diagrama en [`der.md`](./der.md) y la justificación de normalización en
[`normalizacion.md`](./normalizacion.md).

Convenciones: PK `id UUID DEFAULT gen_random_uuid()` salvo indicación; `created_at TIMESTAMPTZ
DEFAULT now()`; RLS habilitado (`ENABLE ROW LEVEL SECURITY`) en toda tabla con PII o datos
clínicos, con política por defecto *deny-all*.

---

## Tipos ENUM

| Tipo | Valores |
|------|---------|
| `user_role` | `PACIENTE`, `PROFESIONAL`, `MODERADOR` |
| `professional_status` | `PENDIENTE_VALIDACION_MATRICULA`, `ACTIVO`, `SUSPENDIDO` |
| `appointment_status` | `RESERVADO_SIN_PAGAR`, `CONFIRMADO`, `CANCELADO`, `COMPLETADO`, `NO_ASISTIO`, `LIBERADO` |
| `video_session_status` | `CREADA`, `EN_CURSO`, `FINALIZADA` |
| `payment_status` | `PENDIENTE`, `APROBADO`, `RECHAZADO`, `REEMBOLSADO` |
| `refund_status` | `PENDIENTE`, `PROCESADO`, `RECHAZADO` |
| `entry_type` | `CONSULTA`, `DIAGNOSTICO`, `PRESCRIPCION`, `ESTUDIO`, `CORRECCION` |
| `summary_status` | `PENDIENTE_VALIDACION`, `VALIDADO`, `DESCARTADO` |
| `review_status` | `PENDIENTE_MODERACION`, `APROBADA`, `RECHAZADA` |
| `notification_type` | `TURNO_RESERVADO`, `RECORDATORIO_24H`, `RECORDATORIO_1H`, `NUEVO_MENSAJE`, `PAGO_CONFIRMADO`, `RESENA_MODERADA` |
| `notification_channel` | `IN_APP`, `PUSH`, `EMAIL` |

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

**RLS:** datos públicos (nombre, bio, especialidades, precio) legibles sin auth solo para
`status = ACTIVO`; el resto solo el propio profesional.

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

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `professional_id` | uuid | FK → `professionals.profile_id` ON DELETE CASCADE |
| `block_date` | date | NOT NULL |
| `reason` | text | |
| `created_at` | timestamptz | |

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

**Cadena de hash:**
```
previous_hash = content_hash de la entrada anterior del mismo paciente
                (genesis = 64 ceros para la primera entrada)
content_hash  = SHA256( patient_id ‖ sequence_number ‖ entry_type ‖ content::text ‖ previous_hash )
```
Modificar una entrada invalida el hash de todas las siguientes → detectable por el job de
verificación (`integrity_checks`).

**Append-only (RLS):** las políticas de PostgreSQL **niegan `UPDATE` y `DELETE`** a todos los
roles operativos; solo permiten `INSERT`. Las correcciones son entradas nuevas de tipo
`CORRECCION` que apuntan a la original vía `corrects_entry_id`.

**Lectura (RLS):** el paciente titular; el profesional con relación vigente; y sesiones MediPass
activas no revocadas (EP-09). Todo acceso se registra en `audit_logs`.

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

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `profiles.id` |
| `type` | notification_type | NOT NULL |
| `channel` | notification_channel | NOT NULL |
| `payload` | jsonb | |
| `sent_at` / `read_at` / `created_at` | timestamptz | |

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

| Columna | Tipo | Restricciones |
|---------|------|---------------|
| `id` | uuid | PK |
| `status` | text | `OK` / `INCONSISTENT` |
| `inconsistencies_found` | integer | DEFAULT 0 |
| `details` | jsonb | Pacientes/entradas afectadas |
| `run_at` | timestamptz | NOT NULL |

---

## Índices recomendados (además de PK/UK/FK)

| Tabla | Índice | Motivo |
|-------|--------|--------|
| `professionals` | GIN `pg_trgm` sobre `first_name`, `last_name` | Búsqueda fuzzy del catálogo |
| `professionals` | `(status)` | Filtrar solo `ACTIVO` en catálogo público |
| `appointments` | `(professional_id, scheduled_at)` | Agenda y detección de solapamiento |
| `appointments` | `(patient_id, scheduled_at)` | "Mis turnos" |
| `clinical_record_entries` | `(patient_id, sequence_number)` | Recorrer/verificar cadena de hash |
| `messages` | `(conversation_id, created_at)` | Paginar chat |
| `medipass_sessions` | `(patient_id, expires_at)` | Sesiones activas |
| `payment_webhook_events` | `(mercadopago_payment_id)` | Idempotencia de webhooks |
