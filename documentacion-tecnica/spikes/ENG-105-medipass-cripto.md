# ENG-105 — Spike: Validación del diseño criptográfico del código MediPass y la sesión revocable

**Épica:** EP-09 (MediPass) · **Sprint 8** · **5 SP** · **Tipo:** Spike
**Autor:** Sangenis

## Objetivo

Validar el diseño del código rotativo del MediPass y del mecanismo de sesión
revocable, y dejar por escrito qué garantiza y qué no.

El MediPass es el diferencial del proyecto y el único lugar del sistema donde se
devuelven datos de salud **sin sesión**: la autorización es un código de ocho
caracteres que vale cinco minutos. Eso lo convierte en la superficie de ataque
más expuesta del backend, así que el diseño tiene que poder defenderse con
números y no con intuiciones.

## ⚠️ Este spike corre después de la implementación

El ticket pedía que corriera **antes** de ENG-72, ENG-73 y ENG-103. No pasó: la
jornada de proyectos finales del 06/10 empujó la implementación primero, y para
cuando este análisis arrancó, `backend #68` ya estaba en `main`.

Eso cambia qué puede hacer este documento. No puede decidir un diseño que
todavía no existe, así que hace dos cosas distintas:

1. **Verificar que lo que se construyó se sostiene**, con el cálculo que debió
   hacerse antes. Dos de los hallazgos de abajo son defectos reales encontrados
   así.
2. **Decidir lo que sigue abierto**: el tratamiento de la revocación en curso y
   la ratificación de que el código no es de un solo uso.

Se deja escrito el orden real porque es la clase de cosa que una defensa
pregunta, y porque el hallazgo 1 es exactamente el que un spike previo habría
evitado.

## Qué se analizó

| Artefacto | Dónde |
|---|---|
| Generación del código y canje | `mediconnect-backend/src/medipass/medipass.service.ts` |
| Parámetros del diseño | `mediconnect-backend/src/medipass/medipass.config.ts` |
| Rate limit del endpoint público | `mediconnect-backend/src/medipass/medipass-sessions.controller.ts` |
| Validación y normalización de entrada | `mediconnect-backend/src/medipass/dto/open-emergency-session.dto.ts` |
| RLS de las tablas | `prisma/migrations/20261020230000_eng72_eng73_medipass_rls/` |
| Esquema | `prisma/schema.prisma` (`MediPassCode`, `MediPassSession`) |

El análisis es **analítico**, no empírico: son cuentas de probabilidad sobre
parámetros que ya están fijados en código, no mediciones. Donde hay un número
medible —la latencia de la revocación— se dice de dónde sale.

## El código

```
alfabeto = 23456789BCDFGHJKLMNPQRSTVWXZ   (28 caracteres)
largo    = 8
espacio  = 28^8 = 377.801.998.336 ≈ 3,78 × 10^11
entropía = 38,46 bits
ventana  = 5 minutos
```

El alfabeto excluye vocales y caracteres ambiguos, por dos razones distintas:

- **Sin vocales**, para que el azar no arme una palabra ofensiva en el QR de un
  paciente.
- **Sin `0`/`O`, `1`/`I`/`L` ni `U`/`V`**, porque el código se dicta por teléfono
  en una urgencia. Confundir un cero con una O es el error que no se puede
  permitir ahí.

Se genera con `randomInt` de `node:crypto`, no con `Math.random()`:
`Math.random()` no es criptográficamente seguro y su estado se puede reconstruir
observando salidas. Para datos de demo da igual; para el código que abre la
ficha clínica de alguien, no.

**38,46 bits es poco** para un secreto de larga vida —una contraseña con esa
entropía se considera débil— y es suficiente acá sólo por la combinación con la
ventana de 5 minutos y el rate limit. La entropía sola no alcanza para
justificar el diseño: hay que mirar las dos cosas juntas.

## Amenaza 1 — adivinar un código

El error a evitar es calcular la probabilidad de adivinar **el código de un
paciente determinado**. Ese no es el ataque. Un atacante no quiere la ficha de
alguien en particular: quiere *una* ficha, de cualquiera. Entonces la
probabilidad por intento no es `1/28^8` sino `N/28^8`, donde `N` es la cantidad
de códigos vigentes al mismo tiempo. Crece linealmente con los usuarios activos.

Con el rate limit real del canje —**10 intentos por minuto por IP**
(`@Throttle({ limit: 10, ttl: 60_000 })`, con la IP real del cliente detrás de
Cloudflare por ENG-84):

| Códigos vigentes | p(acierto)/intento | p/hora con 1 IP | horas-IP para 50 % |
|---|---|---|---|
| 100 | 2,6 × 10⁻¹⁰ | 1,6 × 10⁻⁷ | 4,4 × 10⁶ (≈ 500 años) |
| 1.000 | 2,6 × 10⁻⁹ | 1,6 × 10⁻⁶ | 4,4 × 10⁵ (≈ 50 años) |
| 10.000 | 2,6 × 10⁻⁸ | 1,6 × 10⁻⁵ | 4,4 × 10⁴ (≈ 5 años) |

**Desde una sola IP el diseño aguanta de sobra**, y lo aguantaría incluso con dos
órdenes de magnitud más de usuarios que los que el proyecto va a tener.

## 🔴 Hallazgo 1 — no hay `unique` sobre el código vigente

`MediPassCode` tiene índices sobre `(code, expires_at)` y
`(patient_id, expires_at)`, pero **ninguna restricción de unicidad sobre
`code`**. La generación tampoco verifica que el código que sorteó no exista ya:

```ts
return tx.mediPassCode.create({
  data: { patient_id: patientId, code: this.generarCodigo(), ... },
});
```

Y el canje resuelve así:

```ts
const code = await this.prisma.mediPassCode.findFirst({
  where: { code: dto.codigo, expires_at: { gt: ahora } },
  orderBy: { expires_at: 'desc' },
  ...
});
```

Si dos pacientes tienen el mismo código vigente al mismo tiempo, `findFirst`
devuelve **uno** de los dos —el de vencimiento más lejano— y el médico que
escaneó el QR de un paciente recibe el bloque vital **del otro**: alergias,
medicación y grupo sanguíneo de otra persona, en una urgencia, sin ninguna señal
de que algo salió mal.

Probabilidad de que ocurra al menos una vez, por cumpleaños sobre los códigos
vigentes simultáneos:

| Códigos vigentes | p(alguna colisión) |
|---|---|
| 100 | 1,3 × 10⁻⁸ |
| 1.000 | 1,3 × 10⁻⁶ |
| 10.000 | 1,3 × 10⁻⁴ |

Es remotísimo, y a la escala del proyecto no va a pasar. **Igual hay que
arreglarlo**, y no por la probabilidad sino por la asimetría: la consecuencia es
la peor que el sistema puede producir —datos clínicos de la persona equivocada en
el momento en que más importan— y el arreglo cuesta una línea de SQL. Un riesgo
con probabilidad baja y daño ilimitado no se acepta porque el número sea chico;
se acepta cuando arreglarlo cuesta más que el daño esperado, y acá no es el caso.

La corrección propuesta es unicidad sobre el código más reintento en la
generación:

```sql
-- No se puede indexar sobre `now()`, que no es inmutable, así que la unicidad
-- va sobre el código a secas por la vida de la fila.
create unique index medipass_codes_code_key on public.medipass_codes (code);
```

Con eso, una colisión pasa de "ficha equivocada en silencio" a un `23505` que el
service reintenta: el mismo patrón de reintento sobre `P2002` que ya usa
`ClinicalRecordsService` al apendizar en la cadena de hash.

> Queda como ticket aparte. **No** se arregla en este spike: el spike es docs, y
> una migración más un reintento es cambio de backend con sus propios tests.

## 🔴 Hallazgo 2 — el límite es por IP, y el ataque que importa es distribuido

El rate limit de 10/min es **por IP**. La tabla de la amenaza 1 dice que una IP
sola necesitaría décadas; un atacante con muchas IPs multiplica por la cantidad
de IPs, y eso cambia el resultado por completo.

Con 1.000 códigos vigentes y una botnet de 10.000 IPs —alquilable por poca plata—:

```
intentos/minuto   = 10 × 10.000 = 100.000
p(acierto)/minuto = 2,6 × 10⁻⁴
tiempo para 50 %  ≈ 2.620 minutos ≈ 1,8 días
```

**Menos de dos días para obtener el bloque vital de un paciente al azar.** No es
un ataque dirigido —no se elige a quién— pero es una filtración de datos de salud
igual, y el límite por IP no lo frena en absoluto porque nunca se alcanza en
ninguna IP.

Tres mitigaciones posibles, de menor a mayor costo:

| Mitigación | Costo | Efecto |
|---|---|---|
| **Límite global** al endpoint, además del límite por IP | Bajo | Corta el ataque distribuido de raíz: el techo deja de depender de cuántas IPs tenga el atacante |
| **Alerta sobre la tasa de 404** del canje | Bajo | No previene, pero lo vuelve visible. Un canje legítimo casi nunca falla: el código viene de un QR |
| Código más largo (10 caracteres → 28¹⁰, ×784) | Alto | Rompe el contrato con web y mobile, el `varchar(8)` y el seed. **No se recomienda** |

La recomendada es la primera, y el número tiene que salir del uso real esperado:
el canje legítimo es un evento raro —un médico de guardia escaneando un QR— así
que un techo global de decenas por minuto no molesta a nadie y vuelve el ataque
inviable. El tercero se descarta a propósito: cambiar el largo del código a esta
altura toca tres repos y el contrato ya está en producción, y la plata está mucho
mejor puesta en el límite global.

## Qué se guarda: el código en claro

`medipass_codes.code` es un `varchar(8)` **en texto plano**. La pregunta del
ticket era si debía ser un hash, y la respuesta es que **no puede serlo**, por
una razón de producto y no de criptografía:

`GET /medipass/me` le devuelve al paciente su código vigente para que la pantalla
arme el QR. El servidor tiene que poder **producir** el código, no sólo
verificarlo. Con un hash, el único que podría mostrarlo sería quien ya lo tenga,
y la pantalla del paciente dejaría de funcionar.

Y aunque se pudiera, el hash compraría poco. Para que el canje pueda buscar por
código, el hash tendría que ser determinístico y sin sal por fila; un espacio de
38 bits con un hash así se revierte por fuerza bruta offline en segundos. La
defensa real de este dato no es su representación: son la ventana de 5 minutos y
que la tabla esté cerrada.

Lo que sostiene el dato hoy:

- **RLS habilitada y sin políticas** en `medipass_codes` y `medipass_sessions`
  (ENG-72/73): denegado por defecto para `authenticated` y `anon`. Importa porque
  la `anon key` de Supabase viaja en el bundle de la web y no es un secreto: sin
  RLS, cualquiera con esa clave leía la tabla entera y abría el MediPass de
  cualquier paciente sin escanear nada.
- Todo el acceso pasa por el backend, que entra con el rol dueño de las tablas y
  filtra por `patient_id` en cada consulta.
- `TTL` de 5 minutos: una filtración de la base expone, como máximo, los códigos
  vigentes en ese momento.

**Consecuencia asumida y explícita:** un volcado de la base entrega códigos
usables durante hasta cinco minutos. Se acepta porque quien tiene un volcado de
la base ya tiene las fichas clínicas directamente, y los códigos son el menor de
los problemas en ese escenario.

> Cuando entre ENG-138 —que saca al backend del rol dueño y lo pasa a un rol de
> aplicación sin `BYPASSRLS`— estas dos tablas van a necesitar un GRANT explícito
> o políticas propias.

## La sesión revocable

Canjear el código crea una fila en `medipass_sessions` con `expires_at` a 30
minutos, y devuelve un `sesionId` que es el que la ficha de emergencia usa para
seguir leyendo. Revocar (ENG-75) escribe `revoked_at` y `revoked_by`.

Las dos condiciones se evalúan **en cada lectura, contra el reloj del servidor**:

```ts
if (session.revoked_at || session.expires_at.getTime() <= ahora.getTime()) {
  throw new GoneException('El acceso venció o fue revocado.');
}
```

Esto es deliberado y vale la pena dejarlo escrito: **no hace falta ningún job**
para que la revocación o el vencimiento tengan efecto. El job de ENG-104
materializa el estado para poder consultarlo, pero ninguna lectura depende de que
haya corrido. Si se confiara en una columna marcada por un job, un job atrasado
dejaría accesos vivos que deberían estar cerrados — y es el mismo criterio que
ENG-101 usa para liberar turnos impagos.

El **410** tampoco es un detalle de estilo. Es lo único que le permite a la ficha
distinguir "el acceso se terminó" de "se cayó la red". Con un 404 genérico ante
cualquier problema, la ficha se cerraría sola cada vez que el celular del médico
pasa por un túnel, justo en el momento en que necesita la información.

## 🟡 Hallazgo 3 — "inmediata" tiene dos límites que hay que decir en voz alta

El ticket de ENG-75 pide que la revocación sea inmediata y que el siguiente `GET`
dé 410. **Eso se cumple a nivel de API.** Pero la promesa que el proyecto hace en
la presentación —"el paciente corta el acceso"— tiene dos límites reales:

1. **La pantalla del consultante tarda hasta 60 segundos en enterarse.** La ficha
   hace polling cada minuto, así que entre que el paciente aprieta "cortar" y que
   al médico se le cierre la pantalla pasa, en el peor caso, un minuto. Bajar el
   intervalo lo acorta pero no lo elimina; eliminarlo requiere empujar desde el
   servidor (WebSocket o SSE), que es más maquinaria de la que esto justifica.
2. **Lo que ya se leyó no se puede des-ver.** El bloque vital viaja en la
   respuesta del canje: desde ese momento está en el navegador del consultante, y
   podría estar en una captura de pantalla o en un papel. La revocación corta el
   acceso **futuro**, no el conocimiento ya adquirido.

Ninguna de las dos es un defecto a arreglar: son el límite de lo que cualquier
sistema puede prometer. Están acá porque la diferencia entre un proyecto que las
tiene escritas y uno que no es, exactamente, si la respuesta en la defensa es
"eso ya lo pensamos y está documentado" o un silencio.

Lo que la revocación **sí** garantiza, y es demostrable en vivo:

- A partir del `DELETE`, ninguna lectura nueva de esa sesión devuelve datos.
- Cortar un acceso **no corta los demás**: cada canje abre su propia sesión, así
  que en una guardia con dos médicos mirando, el paciente le saca el acceso a uno
  sin dejar al otro afuera.
- Queda registrado en `audit_logs` con `MEDIPASS_ACCESS_REVOKED`, el consultante
  y los minutos que le quedaban.

## El código no es de un solo uso — y el esquema dice lo contrario

`openSession` permite **varios canjes del mismo código** mientras esté vigente.
Cada canje abre su propia sesión; `used_at` se escribe en el primero y no se
vuelve a tocar, como dato de cuándo se usó por primera vez y no como traba.

Las razones son operativas y son buenas: un médico que recarga la página no puede
quedar afuera teniendo que pedirle otro código a un paciente que quizá no está en
condiciones de mostrarlo, y en una guardia puede haber más de una persona que
necesita ver la ficha. Y es lo que hace posible la revocación selectiva: si un
código abriera una sola sesión, cortarla sería indistinguible de esperar a que
venza.

**Pero el esquema dice otra cosa.** `prisma/schema.prisma` documenta el modelo
como:

```prisma
/// Código rotatorio de un solo uso, vigente 5 minutos.
model MediPassCode {
```

Es la descripción de un diseño que no se implementó. Hay que corregir el
comentario, no el código: el comportamiento de `#68` es el correcto, y el costo
de dejar la contradicción es que el próximo que lea el esquema asuma una garantía
que el sistema no da.

Esto corresponde a la **decisión D7** del plan de cierre ("MediPass de uso
único"), que el plan marca como resuelta de facto y pendiente de ratificar. Este
spike recomienda **ratificarla**: multi-canje con sesiones independientes y
revocación por sesión. El costo de seguridad es acotado —el código vive cinco
minutos y cada sesión queda registrada y es revocable por separado— y el beneficio
es que el mecanismo funciona en el escenario para el que existe.

## Lo que este diseño NO resuelve

1. **El consultante no está autenticado.** `nombre` y `matricula` los declara él
   y **nadie los verifica**: no hay validación contra un registro de matrículas.
   Quien tenga el código puede decir que es cualquiera. Lo que el sistema
   garantiza es que *alguien con el código* entró, y que quedó registrado lo que
   dijo ser — no que sea quien dice.
2. **Un QR fotografiado sirve cinco minutos.** Es la ventana, y es el tradeoff
   buscado.
3. **El paciente inconsciente no revoca.** El MediPass existe justamente para el
   escenario en que el paciente no puede intervenir, así que la revocación es una
   garantía para *después*, y el vencimiento a 30 minutos es lo que lo cubre
   mientras no puede.
4. **El bloque vital se entrega completo a cualquier canje.** No hay recorte por
   tipo de consultante. El recorte por scope aparece en la fase siguiente del
   plan; hoy, quien entra ve todo el bloque vital.

## Recomendaciones

| # | Qué | Prioridad | Dónde |
|---|---|---|---|
| 1 | `unique` sobre `medipass_codes.code` + reintento en la generación | **Alta** | backend, migración + service |
| 2 | Límite global al canje, además del límite por IP | **Alta** | backend, `medipass-sessions.controller.ts` |
| 3 | Corregir el comentario `/// Código rotatorio de un solo uso` del esquema | Media | backend, `schema.prisma` |
| 4 | Ratificar D7 (multi-canje con sesiones independientes) en la próxima reunión | Media | equipo |
| 5 | Alerta sobre la tasa de 404 del canje | Baja | infra |
| 6 | Documentar los dos límites del hallazgo 3 en el guion de la defensa | Baja | docs |

Las dos primeras son tickets de backend y **no se hacen en este PR**, que es de
documentación. Las de prioridad alta conviene que entren antes de la defensa: la
1 porque el modo de falla es el peor posible, y la 2 porque es la única que un
docente con conocimiento de seguridad va a buscar.

## Cómo verificar los números

Las cuentas de este documento son reproducibles:

```python
import math
A, L = 28, 8
space = A**L                      # 377.801.998.336
print(math.log2(space))           # 38,46 bits

# Fuerza bruta: p de pegarle a CUALQUIER codigo vigente, N vigentes
N = 1000
p = N / space                     # 2,65e-9 por intento

# Una IP, 10 intentos/min
por_hora = 10 * 60
p_hora = 1 - (1 - p) ** por_hora  # 1,59e-6
print(math.log(0.5) / math.log(1 - p_hora))   # 4,4e5 horas-IP

# Botnet de 10.000 IPs
p_min = 1 - (1 - p) ** (10 * 10_000)
print(math.log(0.5) / math.log(1 - p_min) / 1440)   # 1,8 dias

# Colision entre codigos vigentes (cumpleanos)
print(1 - math.exp(-N * (N - 1) / (2 * space)))     # 1,32e-6
```

Los parámetros del diseño están todos en
`mediconnect-backend/src/medipass/medipass.config.ts`; si alguno cambia, estas
cuentas hay que rehacerlas.
