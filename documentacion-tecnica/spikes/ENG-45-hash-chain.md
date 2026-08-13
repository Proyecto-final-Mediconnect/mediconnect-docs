# ENG-45 — Spike: Validación del prototipo de cadena de hash SHA-256

**Épica:** EP-06 (Historia Clínica) · **Sprint 4** (planificado en el Sprint 2) · **3 SP** · **Tipo:** Spike
**Autor:** Sangenis

## Objetivo

Validar —antes de modelar la Historia Clínica real— que la cadena de hash SHA-256
que propone el [ADR-014/015](../../README.md) es implementable, verificable en
tiempo razonable y capaz de detectar manipulación, y dejar decidido el diseño que
ENG-57 va a implementar sobre `clinical_record_entries`.

Es el mecanismo que sostiene el requisito de inalterabilidad del registro clínico
de la **Ley 26.529** (art. 15) y uno de los diferenciales del proyecto, así que
conviene equivocarse en una tabla de juguete y no en la tabla real.

La validación es **empírica**: tabla en Postgres 15, tests automatizados, y
mediciones sobre cadenas de 100 a 10.000 entradas.

## Qué se construyó

| Artefacto | Dónde |
|---|---|
| Lógica pura (canonicalización, sellado, verificación) | `mediconnect-backend/src/common/hash-chain/hash-chain.ts` |
| Tabla de prueba, triggers y verificador SQL | `mediconnect-backend/prisma/spikes/eng45_hash_chain.sql` |
| 17 tests unitarios | `src/common/hash-chain/hash-chain.spec.ts` |
| 10 tests de integración contra Postgres real | `test/hash-chain.integration.spec.ts` |

El SQL vive **fuera de `prisma/migrations`** a propósito: crea
`spike_hash_chain_entries`, una tabla de prueba, y no debe correr en producción.
El módulo TypeScript no se registra en `AppModule` y no toca
`clinical_record_entries`. ENG-57 se lleva el diseño, no los archivos.

## Qué entra al hash

```
preimagen = patient_id        \n
            sequence_number   \n
            entry_type        \n
            fhir_resource_type\n
            canonical_json(content) \n
            corrects_entry_id \n      (cadena vacía si no es una corrección)
            created_at        \n      (ISO-8601 UTC)
            previous_hash

content_hash = sha256_hex(preimagen)
```

La primera entrada de cada paciente encadena contra el **hash génesis**: 64 ceros.

Dos cosas que no son obvias:

- **Lo que no está en la preimagen no está protegido.** El `id` de la fila queda
  afuera a propósito (lo genera la base y no aporta), pero cualquier campo que
  ENG-57 agregue a la tabla y no agregue acá es modificable sin romper la cadena.
- El separador `\n` es seguro: el único campo de forma libre es `content`, y al
  pasar por la serialización canónica cualquier salto de línea real queda escapado
  como los dos caracteres `\` + `n`. Ningún campo puede inyectar un separador.

## Decisión 1 — el hash lo calcula la aplicación, no la base

Se evaluaron las dos opciones:

| | Hash en trigger de Postgres (`pgcrypto`) | Hash en la aplicación |
|---|---|---|
| El backend no puede falsear el hash | ✅ | ❌ |
| Forma canónica del JSON | atada a `jsonb::text` | definida por nosotros |
| Verificable fuera de Postgres | ❌ | ✅ |
| Portabilidad del registro (MediPass, HL7 FHIR) | ❌ | ✅ |

**Se eligió calcularlo en la aplicación.** El motivo decisivo no es la comodidad:
el hash de una entrada de HC tiene que poder verificarse **fuera de nuestra base**
—es lo que hace creíble el pasaporte médico portable— y si la forma canónica es
`jsonb::text`, verificar exige un Postgres con el mismo criterio de ordenamiento
de claves. `jsonb` ordena por (longitud, bytes); RFC 8785 ordena por code unit
UTF-16. Son órdenes distintos y elegir el de Postgres nos ata a Postgres para
siempre.

Lo que **sí** hace la base es negarse a guardar una entrada mal encadenada
(trigger `BEFORE INSERT`): verifica que `sequence_number` sea contiguo y que
`previous_hash` sea la cabeza real de la cadena del paciente. Sin eso, un bug del
backend podría insertar una cadena rota y nos enteraríamos recién en la
verificación semanal (ENG-85).

## Decisión 2 — serialización canónica obligatoria

`JSON.stringify` preserva el orden de inserción de las claves. El mismo recurso
FHIR llegando por dos caminos distintos —el formulario web y el pipeline de IA,
por ejemplo— produciría dos hashes distintos, y la cadena daría por manipulada una
entrada sana.

Se implementó **JCS (RFC 8785)** acotado a lo que usamos: claves ordenadas por
code unit UTF-16, sin espacios, `undefined` descartado, y error explícito ante
`NaN`/`Infinity`/funciones (valores que no sobreviven un round-trip JSON y
romperían la verificación en silencio).

## 🔴 Hallazgo principal — `timestamptz(6)` rompe la verificación

`clinical_record_entries.created_at` está hoy declarado como `timestamptz(6)`
(microsegundos) con `default now()`. **Con ese tipo, la cadena no se puede
verificar desde Node**, y el síntoma es el peor posible: entradas intactas
reportadas como manipuladas.

Por qué: el `created_at` entra al hash. Postgres guarda microsegundos, pero el
`Date` de JavaScript solo tiene milisegundos. Al leer la entrada para verificarla,
los microsegundos se pierden, el hash recalculado no coincide, y la verificación
marca `CONTENT_TAMPERED` sobre una fila que nadie tocó.

Es traicionero porque **no aparece en los tests que sellan y verifican en
memoria** —ahí el `Date` nunca pasa por la base— y porque un `default now()` da
siempre microsegundos distintos de cero, así que fallaría de forma intermitente
según el redondeo.

**Dos correcciones, las dos necesarias:**

1. `created_at` pasa a **`timestamptz(3)`** en `clinical_record_entries`.
2. El timestamp lo **genera la aplicación**, no `default now()`: hay que tener el
   valor exacto en memoria en el momento de calcular el hash.

El test `round-trip de precisión` del spike existe justamente para que esto no se
vuelva a colar.

## Append-only y flujo de corrección

La tabla rechaza `UPDATE` y `DELETE` con un trigger `BEFORE ... FOR EACH ROW` que
lanza `42501`. Esto frena incluso al dueño de la tabla, que es más de lo que da
RLS (el owner la saltea salvo `FORCE`).

**Una corrección no modifica nada.** Se registra como una entrada nueva al final
de la cadena, con `corrects_entry_id` apuntando a la entrada errónea, que queda en
la historia. Es lo que pide la Ley 26.529 y lo que hace auditable el registro: se
puede reconstruir qué decía la HC en cualquier momento del pasado, y también que
alguien se equivocó y cuándo lo corrigió.

Para la UI, ENG-57 tendrá que decidir cómo se muestra una entrada corregida
(tachada, colapsada, con un badge). No es parte de este spike, pero el dato está
en la tabla.

## Resultados

**Criterio de aceptación: verificar 1.000 entradas en menos de 1 segundo.**

Verificación completa en TypeScript (recalcula los 1.000 SHA-256 y valida los
enlaces), mediana de 5 corridas, Node 22.12 en una notebook de desarrollo:

| Entradas | Mediana | Contra el criterio |
|---|---|---|
| 100 | 2,45 ms | — |
| **1.000** | **13,7 ms** | **73× por debajo del límite** |
| 10.000 | 117,5 ms | escala lineal |

El costo es lineal y despreciable frente al I/O. Medido de punta a punta en CI
(GitHub Actions, Postgres 15 como service container), leyendo las entradas de la
base en vez de generarlas en memoria:

```
[ENG-45] 1.000 entradas — lectura 21,1 ms · verificación 25,9 ms · total 47,0 ms
```

Leer las filas cuesta casi lo mismo que verificarlas. Para el job semanal de
verificación (ENG-85) esto significa que se puede recalcular la cadena completa
de todos los pacientes sin pensar en optimizaciones.

También hay un verificador **en SQL** (`spike_hash_chain_verify`) que chequea solo
la estructura —génesis, contigüidad, enlace— sin recalcular hashes. Es el chequeo
barato para correr seguido; el caro, que recalcula, corre en Node.

### Tests de detección de manipulación

Los 4 escenarios de ataque se detectan, todos con la fila exacta donde se rompe:

| Manipulación | Detectado como |
|---|---|
| Contenido reescrito por SQL directo | `CONTENT_TAMPERED` en la entrada tocada |
| Contenido reescrito **y hash recalculado** | `BROKEN_LINK` en la entrada siguiente |
| Entrada borrada del medio | `BROKEN_LINK` en la siguiente |
| Cadena que no arranca en el génesis | `GENESIS_MISMATCH` |

El segundo es el que justifica la cadena: recalcular el hash de la entrada que se
manipuló no alcanza, porque la siguiente sigue apuntando al hash viejo. Para que
la manipulación pase inadvertida hay que **reescribir toda la cadena hacia
adelante**.

Los tests simulan al atacante con privilegios: deshabilitan el trigger
append-only, hacen el `UPDATE` y lo vuelven a habilitar.

## Lo que la cadena NO resuelve

Conviene decirlo antes de que lo pregunte el jurado: **un atacante con acceso de
superusuario a la base puede reescribir la cadena entera hacia adelante y quedar
consistente.** Ninguna cadena de hash guardada en la misma base que protege puede
evitar eso. Lo que la cadena garantiza es que la manipulación no puede ser
*quirúrgica* ni *silenciosa*: hay que reescribir todo lo posterior.

La mitigación estándar es el **anclaje externo**: publicar periódicamente el hash
de cabeza de cada paciente en un medio fuera del alcance de ese atacante (otra
base, un log append-only de un tercero, un correo firmado). Con un ancla semanal,
la ventana de reescritura queda acotada a los días desde el último anclaje.

No es parte de ENG-45 ni de ENG-57. Recomiendo abrirlo como tarea técnica de EP-06
y engancharlo con ENG-85 (job semanal de verificación), que ya recorre las cadenas
y es el lugar natural para emitir el ancla.

## Recomendaciones para ENG-57

1. **Cambiar `created_at` a `timestamptz(3)`** en `clinical_record_entries` y
   generarlo en la aplicación. Es bloqueante: sin esto la verificación no funciona.
2. Promover `src/common/hash-chain/` a módulo real y usarlo desde el servicio de
   HC. La lógica ya está testeada; no hay que reescribirla.
3. Portar los tres triggers (append-only, enlace en el insert) a una migración
   Prisma de verdad, sumando las políticas RLS de la tabla.
4. Congelar por escrito la lista de campos de la preimagen. Agregar un campo a la
   tabla sin agregarlo al hash deja ese campo sin proteger, y no hay nada que avise.
5. `sequence_number` contiguo por paciente obliga a serializar los inserts de un
   mismo paciente. Con un profesional por consulta no es un problema; si alguna vez
   dos fuentes escriben a la vez (el pipeline de IA y el profesional), hay que
   resolver el reintento ante colisión de la unique `(patient_id, sequence_number)`.
6. Abrir la tarea técnica de anclaje externo.

## Cómo correr

```bash
cd mediconnect-backend

pnpm test hash-chain        # 17 tests unitarios, sin base
pnpm run test:integration   # 10 tests contra Postgres 15 real (levanta Docker)
```
