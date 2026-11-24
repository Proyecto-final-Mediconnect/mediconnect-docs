# ADR-021 — Validación de la matrícula de los profesionales contra el REFEPS

- **Estado:** Propuesto
- **Fecha:** 2026-11-24
- **Issue:** [ENG-218](https://linear.app/summercamp-pasantes/issue/ENG-218) (spike) · Épica EP-01 (Identidad y acceso)
- **Autor:** Santino Magris
- **Aceptado por:** _pendiente — requiere un segundo desarrollador (Sprint 0 §1.7.4)_
- **Relacionado:**
  - ENG-109: procedimiento manual.
  - ENG-192: validación desde el panel.
  - ENG-240: rol ADMINISTRADOR.
  - ENG-241: suspensión.
  - ENG-243, ENG-244 y ENG-245: implementación.

## Contexto y planteo del problema

En la regularidad del 16/11/2026 quedó pendiente definir **cómo se valida automáticamente
la matrícula** de un profesional. Un paciente reserva y paga una consulta, y
la historia clínica que escribe ese profesional es un documento legal (Ley 26.529).
Que el profesional esté habilitado para ejercer no es un detalle.

### Qué hay hoy (relevado en `main` el 24/11)

| Aspecto | Comportamiento actual |
| --- | --- |
| Registro profesional | Pide nombre, apellido, especialidad y **número de matrícula**. No pide DNI ni jurisdicción. |
| Estado inicial | `PENDIENTE_VALIDACION_MATRICULA` (`professional_status`). |
| Mientras está pendiente | Puede completar su perfil, su agenda y su política de cancelación. **No aparece en el catálogo y no se le puede reservar**: `catalog.service.ts` y `appointments.service.ts` filtran por `VALIDADO`. |
| Quién decide | El ADMINISTRADOR (ENG-240), desde `/admin/matriculas` (ENG-192). La decisión es `VALIDADO` o `RECHAZADO`, queda en `audit_logs` y se le avisa al profesional por mail. |
| Cómo decide | A mano, con el procedimiento de ENG-109. |
| Después | El administrador puede suspender y reactivar (ENG-241). Al suspender se cancelan los turnos futuros con reembolso del 100 %. |

La pregunta "¿qué hacemos con ENG-192 y el rol de moderador?" ya está resuelta.
El moderador se reemplazó por el ADMINISTRADOR (ENG-240), y ENG-192 está
implementado. Este ADR decide **qué fuente oficial se consulta y cuánto se
automatiza** sobre ese flujo.

## Fuentes investigadas

### 1. REFEPS / SISA (Ministerio de Salud de la Nación)

La [Red Federal de Registros de Profesionales de la Salud](https://www.argentina.gob.ar/normativa/nacional/norma-255408/texto)
(Res. 2081/2015) es parte del SISA. Reúne lo que informa cada jurisdicción. Las
autoridades sanitarias provinciales y los colegios con matrícula delegada son
responsables de cargar y actualizar sus datos. La matrícula digital de
Mi Argentina sale de ahí (Res. 3320/2024).

| Acceso | Qué es | ¿Sirve para automatizar? |
| --- | --- | --- |
| **WS020, consulta nominal** | REST `GET https://sisa.msal.gov.ar/sisa/services/rest/profesional/obtener` (también SOAP `getProfesional`). Busca por `nrodoc`, `apellido`, `nombre` o `codigo`. Devuelve las matrículas con profesión, jurisdicción, **estado (habilitada o no)** y fechas. | **Sí.** Es la fuente correcta. |
| **WS021, consulta múltiple** | REST `.../profesional/buscar` por apellido, matrícula, provincia y profesión. Devuelve hasta 20 resultados. | Sí, como alternativa si no hay DNI. |
| **Buscador público** | En [sisa.msal.gov.ar](https://sisa.msal.gov.ar), "Buscador de establecimientos y profesionales", solapa REFEPS. Busca por documento, matrícula o apellido y nombre, y muestra si está matriculado y habilitado. | Para personas. Ver "Alternativas". |

**Acceso a los servicios web:** los dos piden `usuario` y `clave` de una cuenta
SISA con permiso para el servicio ([WS020](https://sisa.msal.gov.ar/sisadoc/docs/050102/refeps_ws_020.jsp),
[WS021](https://sisa.msal.gov.ar/sisadoc/docs/050102/refeps_ws_021.jsp)). La
documentación no describe cómo se tramita el permiso. Indica el contacto
soporte@sisa.msal.gov.ar. Las plataformas de receta electrónica inscriptas en el
ReNaPDiS ya tienen que verificar a los prescriptores contra el REFEPS, así que
existe un camino para que una plataforma privada consulte.

### 2. Colegios y consejos provinciales

Cada jurisdicción tiene su registro: un colegio con matrícula delegada o el
ministerio provincial. Algunos tienen buscadores web para personas, por ejemplo el
Consejo de Médicos de Córdoba. **Ninguno de los relevados ofrece una API.** Integrar
uno por uno serían hasta 25 integraciones distintas, y además el REFEPS ya reúne
lo que esas entidades informan.

### 3. Prueba de concepto (24/11)

Consulta real al servicio, sin credenciales:

```text
GET https://sisa.msal.gov.ar/sisa/services/rest/profesional/buscar?apellido=perez
HTTP 200
<ProfesionalSearchResponse><resultado>ERROR_AUTENTICACION</resultado><cantidadDeResultados>0</cantidadDeResultados></ProfesionalSearchResponse>

GET https://sisa.msal.gov.ar/sisa/services/rest/profesional/obtener?nrodoc=1
HTTP 200
<Profesional><resultado>ERROR_AUTENTICACION</resultado></Profesional>
```

Lo que confirma:

- El servicio está en línea y responde en el formato documentado.
- **No se puede usar sin una cuenta SISA.**
- Los errores vienen con **HTTP 200** y el resultado en el cuerpo (`resultado`).
  El cliente no puede confiar en el status HTTP: tiene que leer `resultado`.

Sin cuenta no se pudo probar una consulta con datos reales. La prueba completa
queda como primer paso de ENG-244, cuando llegue el permiso.

## Principios

1. **Un dato oficial informa, una persona decide.** Una coincidencia en el REFEPS
   prueba que la matrícula existe y está habilitada. **No prueba que quien se
   registró sea esa persona.** Validar solo con eso permitiría que alguien se
   registre con el DNI y la matrícula de un médico real.
2. **Que SISA no responda no frena a nadie.** Una caída del servicio, la cuota
   agotada o la falta de credenciales dejan el flujo como hoy, el manual. Nunca
   bloquean un registro ni lo rechazan.
3. **Nada automático saca a un profesional de la plataforma.** Suspender cancela
   turnos y devuelve pagos (ENG-241): eso lo decide una persona.
4. **El DNI del profesional es un dato personal** (Ley 25.326). Se usa para
   validar y no sale en ningún endpoint público.

## Decisión

### 1. Fuente: REFEPS por su servicio web (WS020), detrás de un puerto

El backend consulta el REFEPS con el WS020, por DNI, a través de un puerto
`LicenseRegistry` con dos implementaciones:

- `RefepsLicenseRegistry`: llama al servicio con `SISA_USER` y `SISA_PASSWORD` del
  entorno. Las credenciales nunca van a logs ni a Sentry.
- `UnavailableLicenseRegistry`: se usa cuando faltan las credenciales y responde
  "no disponible". **Es la que corre hasta que el Ministerio dé el acceso.**

El puerto deja cambiar de fuente (WS021, la API nueva `apisalud.msal.gob.ar` o un
colegio) sin tocar el flujo.

### 2. Datos que faltan en el registro (ENG-243)

Para consultar hacen falta el **DNI** y la **jurisdicción de la matrícula**
(Nación o una de las 24). El mismo número de matrícula existe en varias provincias.
Se agregan al registro profesional con una migración aditiva, nullable para los
profesionales que ya existen. Este paso ya mejora la validación manual: la cola
muestra los dos datos con un enlace al buscador público del REFEPS.

### 3. Resultado de la consulta

| `resultado` de SISA | Qué muestra la cola | Efecto |
| --- | --- | --- |
| `OK`, con una matrícula de la misma jurisdicción y número, habilitada, y el mismo apellido | **Coincide en el REFEPS** | Ninguno. El administrador decide con ese dato. |
| `OK` pero algo no coincide (otra jurisdicción, no habilitada, otro apellido) | **No coincide:** con el detalle | Ninguno. |
| `REGISTRO NO ENCONTRADO` | **No figura en el REFEPS** | Ninguno. Puede ser una jurisdicción que no informa. |
| `ERROR_AUTENTICACION`, `NO_TIENE_QUOTA_DISPONIBLE`, `ERROR`, timeout | **No se pudo consultar** | Ninguno. Se puede reintentar. |

Cada consulta deja una fila en `audit_logs` (`LICENSE_REGISTRY_CHECK`) con el
resumen (resultado y qué coincidió) y la fecha. No se guarda la respuesta entera
de SISA.

### 4. Flujo y estados

No se agregan estados: el resultado del REFEPS es **evidencia**, no un estado.

```text
registro ──► PENDIENTE_VALIDACION_MATRICULA ──(consulta REFEPS en segundo plano)──► evidencia en la cola
                 │                     │
     administrador valida      administrador rechaza
                 ▼                     ▼
             VALIDADO              RECHAZADO
                 │  ▲
     suspende    │  │ reactiva            (ENG-241)
                 ▼  │
             SUSPENDIDO
```

- **Mientras está pendiente**, igual que hoy: arma su perfil y su agenda, pero no
  aparece en el catálogo ni recibe turnos.
- **Al registrarse** se consulta el REFEPS sin bloquear la respuesta del registro
  (ENG-244).
- **En la cola**, el administrador ve el resultado y puede volver a consultar.
  Valida o rechaza como hoy (`PATCH /admin/professionals/:id/license`).
- **Para los ya validados**, un job semanal vuelve a consultar. Si una matrícula
  deja de estar habilitada, la marca para revisar. **No suspende sola** (ENG-245).

### 5. El acceso a SISA

Pedir la cuenta SISA con permiso para el WS020 es un trámite fuera del código. Se
pide a soporte@sisa.msal.gov.ar, contando qué es MediConnect, para qué se usa la
consulta y qué volumen se espera. Mientras no llegue, el sistema funciona completo
con la verificación manual asistida del punto 2.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Aprobar sola una coincidencia exacta en el REFEPS** | Habilita la suplantación: el REFEPS confirma la matrícula, no la identidad de quien se registra. Se podría reconsiderar si se agrega una validación de identidad (RENAPER con foto, o Mi Argentina), que hoy no tenemos. |
| **Leer el buscador público de SISA de forma automática** (scraping) | Es una interfaz pensada para personas. Es frágil (cualquier cambio de la página lo rompe), no tiene contrato y no es defendible frente al organismo. El servicio web existe justamente para esto. |
| **Integrar cada colegio provincial** | No tienen API. Serían hasta 25 integraciones distintas, y el REFEPS ya reúne lo que informan. |
| **Verificar la matrícula digital de Mi Argentina** | No encontramos un servicio público para que un tercero la verifique. |
| **Quedarse solo con la validación manual** | Es lo que hay hoy y sigue siendo el respaldo, pero no responde lo que pidió la regularidad y obliga a buscar cada profesional a mano. |
| **Suspender sola una matrícula que deja de estar habilitada** | Cancela turnos y devuelve pagos. Un dato desactualizado o un error de SISA no puede disparar eso. |

## Riesgos residuales

- **Suplantación:** alguien con el DNI y la matrícula de otro profesional pasa la
  consulta. Lo mitiga la decisión humana. Lo
  cerraría una validación de identidad, que queda fuera de este alcance.
- **Cobertura del REFEPS:** depende de que cada jurisdicción informe. "No figura"
  no significa "no matriculado", y por eso no rechaza solo.
- **Acceso:** si el Ministerio no da la cuenta, la validación queda manual
  asistida (ENG-243). El diseño no cambia.
- **Cuota:** `NO_TIENE_QUOTA_DISPONIBLE` existe y el límite no está publicado. El job
  semanal consulta de a uno, con pausa entre llamadas.

## Consecuencias

- **Positivas:**
  - La validación se apoya en el registro oficial.
  - El administrador decide con evidencia y no busca a mano.
  - Se detectan las matrículas que se dan de baja después de validar.
- **Negativas:**
  - Depende de un trámite con el Ministerio que no controlamos.
  - Se agregan el DNI y la jurisdicción al registro profesional, con una migración.
  - Hay que mantener un cliente de un servicio que responde errores con HTTP 200.

## Implementación

| Orden | Ticket | Qué |
| --- | --- | --- |
| 1 | [ENG-243](https://linear.app/summercamp-pasantes/issue/ENG-243) | DNI y jurisdicción en el registro, y verificación manual asistida en la cola. Lleva migración. |
| 2 | [ENG-244](https://linear.app/summercamp-pasantes/issue/ENG-244) | `LicenseRegistry`, consulta al registrarse y resultado en la cola. |
| 3 | [ENG-245](https://linear.app/summercamp-pasantes/issue/ENG-245) | Nueva verificación semanal de los validados. |

Fuera del código: pedir la cuenta SISA con permiso para el WS020.
