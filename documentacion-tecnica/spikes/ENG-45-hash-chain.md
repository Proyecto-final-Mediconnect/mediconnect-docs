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
| 19 tests unitarios | `src/common/hash-chain/hash-chain.spec.ts` |
| 14 tests de integración contra Postgres real | `test/hash-chain.integration.spec.ts` |

El SQL vive **fuera de `prisma/migrations`** a propósito: crea
`spike_hash_chain_entries`, una tabla de prueba, y no debe correr en producción.
El módulo TypeScript no se registra en `AppModule` y no toca
`clinical_record_entries`. ENG-57 se lleva el diseño, no los archivos.

## Qué entra al hash

```
preimagen = patient_id        \n
            professional_id   \n
            sequence_number   \n
            entry_type        \n
            fhir_resource_type\n
            canonical_json(content) \n
            consultation_id   \n      (cadena vacía si no viene de una consulta)
            corrects_entry_id \n      (cadena vacía si no es una corrección)
            created_at        \n      (ISO-8601 UTC)
            previous_hash

content_hash = sha256_hex(preimagen)
```

La primera entrada de cada paciente encadena contra el **hash génesis**: 64 ceros.

La lista vive en `PREIMAGE_COLUMNS` (`hash-chain.ts`) y **es contrato, no
detalle**: cambiarla obliga a rehashear todo lo ya escrito, y en una tabla
append-only eso significa migrar la cadena entera.

Tres cosas que no son obvias:

- **Lo que no está en la preimagen no está protegido**, y eso incluye columnas
  que la tabla real *ya tiene*. `professional_id` está en la preimagen porque es
  la autoría del asiento clínico: la Ley 26.529 art. 15 exige que el registro
  identifique al profesional actuante, y es lo que un ataque realista tocaría
  antes que el contenido — no hace falta falsificar el diagnóstico si alcanza con
  cambiar quién lo firmó. Las únicas columnas fuera del hash son `id` (lo genera
  la base; la identidad ya está dada por `patient_id` + `sequence_number`) y
  `content_hash`, que es el resultado y no puede ser su propia entrada.
- Para que esto no derive, un test de integración compara las columnas reales de
  la tabla contra `PREIMAGE_COLUMNS ∪ NON_HASHED_COLUMNS` y **falla si aparece una
  columna nueva**. Sin ese test, agregar un campo y olvidarse de decidir si entra
  al hash no produce ningún síntoma hasta que alguien lo aprovecha.
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

Los 5 escenarios de ataque se detectan, todos con la fila exacta donde se rompe:

| Manipulación | Detectado como | Dónde corre |
|---|---|---|
| Contenido reescrito por SQL directo | `CONTENT_TAMPERED` en la entrada tocada | Postgres real |
| Profesional firmante reasignado | `CONTENT_TAMPERED` en la entrada tocada | Postgres real |
| Entrada borrada del medio | `BROKEN_LINK` en la siguiente | Postgres real |
| Contenido reescrito **y hash recalculado** | `BROKEN_LINK` en la entrada siguiente | en memoria |
| Cadena que no arranca en el génesis | `GENESIS_MISMATCH` | en memoria |

El cuarto es el que justifica la cadena: recalcular el hash de la entrada que se
manipuló no alcanza, porque la siguiente sigue apuntando al hash viejo. Para que
la manipulación pase inadvertida hay que **reescribir toda la cadena hacia
adelante**.

Los tres primeros corren contra Postgres: simulan al atacante con privilegios,
que deshabilita el trigger append-only, hace el `UPDATE` o el `DELETE` y lo vuelve
a habilitar. Los dos últimos son tests unitarios sobre cadenas en memoria — la
lógica de detección es la misma (`verifyChain` no sabe de dónde salieron las
entradas), pero **conviene que ENG-57 sume el del hash recalculado contra base
real**, porque es el escenario que sostiene el argumento entero y hoy no está
probado de punta a punta.

## Lo que la cadena NO resuelve

Conviene decirlo antes de que lo pregunte el jurado. Hay **dos** agujeros, y el
segundo es más barato de explotar que el primero.

### 1. Reescritura completa hacia adelante

**Un atacante con acceso de superusuario a la base puede reescribir la cadena
entera hacia adelante y quedar consistente.** Ninguna cadena de hash guardada en
la misma base que protege puede evitar eso. Lo que la cadena garantiza es que la
manipulación no puede ser *quirúrgica* ni *silenciosa*: hay que reescribir todo lo
posterior.

### 2. Truncar la cola es indetectable

Si se borran las **últimas** N entradas de un paciente, las que quedan siguen
contiguas, enlazadas y arrancando en el génesis. `verifyChain` devuelve
`valid: true` y `spike_hash_chain_verify` devuelve `ok`: **la cadena no tiene
forma de saber cuál era su propia longitud.**

Y no requiere reescribir nada. Clínicamente es el caso más plausible de los dos:
para ocultar un diagnóstico reciente es mucho más simple borrarlo que falsificarlo.

Hay un test que afirma explícitamente que esto **no** se detecta
(`NO detecta el truncado de la cola`), justamente para que nadie asuma que la
cadena sola alcanza.

Esto cambia lo que ENG-85 tiene que guardar. No alcanza con recorrer las cadenas:
en cada corrida hay que **persistir por paciente el `headHash` y el
`sequence_number` de la cabeza**, y en la corrida siguiente comprobar que esa
entrada siga existiendo con ese hash. Son dos columnas, pero tienen que estar
**desde la primera corrida** o no hay contra qué comparar.

### La mitigación cubre los dos

El **anclaje externo** —publicar periódicamente el hash de cabeza de cada paciente
en un medio fuera del alcance del atacante: otra base, un log append-only de un
tercero, un correo firmado— resuelve los dos casos por el mismo mecanismo. El
ancla fija a la vez el contenido y la longitud, así que una reescritura y un
truncado se detectan igual. Con un ancla semanal, la ventana queda acotada a los
días desde el último anclaje.

No es parte de ENG-45 ni de ENG-57. Recomiendo abrirlo como tarea técnica de EP-06
y engancharlo con ENG-85 (job semanal de verificación), que ya recorre las cadenas
y es el lugar natural para emitir el ancla.

## Recomendaciones para ENG-57

1. **Cambiar `created_at` a `timestamptz(3)`** en `clinical_record_entries` y
   generarlo en la aplicación. Es bloqueante: sin esto la verificación no funciona.
2. Promover `src/common/hash-chain/` a módulo real y usarlo desde el servicio de
   HC. La lógica ya está testeada; no hay que reescribirla.
3. Portar los dos triggers (`spike_hash_chain_no_mutation`, append-only, y
   `spike_hash_chain_link`, enlace en el insert) a una migración Prisma de verdad,
   sumando las políticas RLS de la tabla.
4. **Llevar `PREIMAGE_COLUMNS` tal cual a `clinical_record_entries`**, con
   `professional_id` y `consultation_id` incluidos, y portar también el test que
   compara las columnas de la tabla contra esa lista. Es lo único que avisa cuando
   alguien agrega un campo y se olvida de decidir si entra al hash. Cambiar la
   lista después obliga a rehashear todo lo escrito.
5. `sequence_number` contiguo por paciente obliga a serializar los inserts de un
   mismo paciente. Con un profesional por consulta no es un problema; si alguna vez
   dos fuentes escriben a la vez (el pipeline de IA y el profesional), **el
   reintento no es opcional**. Ojo con confiar en el `for update` del trigger de
   enlace: bloquea la fila cabeza, pero al despertar no reevalúa el `limit 1` y
   sigue viendo la cabeza vieja. Lo que realmente impide el duplicado es la unique
   `(patient_id, sequence_number)`, así que hay que manejar la colisión y reintentar.
6. Abrir la tarea técnica de anclaje externo, y **sumar a ENG-85 las dos columnas
   de cabeza** (`headHash` + `sequence_number` por paciente) para detectar el
   truncado de la cola. Tienen que existir desde la primera corrida.
7. Dejar escrito el supuesto del round-trip: el hash se calcula sobre el objeto en
   memoria y lo que se guarda es `jsonb`. Verifica porque el viaje
   Node → `jsonb` → Node es exacto **para los valores que usamos**, no porque lo
   sea en general (`jsonb` guarda los números como `numeric`). Mientras el único
   que escriba sea Node se sostiene; si alguna vez escribe otra cosa —una
   importación, un job en otro lenguaje— hay que revalidarlo antes.

## Cómo correr

```bash
cd mediconnect-backend

pnpm test hash-chain        # 19 tests unitarios, sin base
pnpm run test:integration   # 14 tests contra Postgres 15 real (levanta Docker)
```
