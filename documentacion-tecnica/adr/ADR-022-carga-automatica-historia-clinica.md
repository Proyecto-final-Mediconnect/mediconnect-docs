# ADR-022 — Qué es la "carga automática" de la historia clínica y cómo se hace

- **Estado:** Propuesto
- **Fecha:** 2026-11-24
- **Issue:** [ENG-219](https://linear.app/summercamp-pasantes/issue/ENG-219) (spike) · Épicas EP-06 (Historia Clínica) y EP-07 (IA Clínica)
- **Autor:** Santino Magris
- **Aceptado por:** _pendiente — requiere un segundo desarrollador (Sprint 0 §1.7.4)_
- **Relacionado:**
  - ADR-013: FHIR, Sprint 0.
  - ADR-020: IA y cifrado.
  - ENG-164: documentos del paciente.
  - ENG-214: IA de la consulta.
  - ENG-136: datos de emergencia del MediPass.
  - ENG-246: implementación.

## Contexto y planteo del problema

En la regularidad del 16/11/2026 quedó anotado "definir cómo se carga automáticamente
la historia clínica". La frase admite tres lecturas distintas, con riesgos y
costos muy diferentes:

1. **Lo que pasa en la consulta** entra a la historia clínica sin que el profesional
   lo tipee.
2. **Los antecedentes que el paciente trae de otro sistema** (otro hospital, otra
   obra social) aparecen sin cargarlos a mano.
3. **Los PDF y fotos de estudios** que sube el paciente (ENG-164) se "leen" y sus
   datos se cargan solos.

### Qué hay hoy (relevado en `main` el 24/11)

| Pieza | Estado |
| --- | --- |
| Historia clínica | `clinical_record_entries`: cada entrada es un recurso FHIR R5 (`ClinicalImpression`), **tiene autor (`professional_id`, obligatorio)** y queda sellada en una cadena de hash (ENG-45). Las correcciones son entradas nuevas (ENG-100). |
| MediPass | Alergias, medicación, condiciones, grupo sanguíneo y contacto, en `patients` (ENG-134 y ENG-136). Los carga el paciente a mano. |
| Documentos del paciente | PDF e imágenes en Storage (ENG-164), con tipo, fecha e institución. No se leen. |
| IA de la consulta | Diseñada en el ADR-020 y probada (ENG-239). La implementación está en ENG-214. |

## Definición del alcance

| Lectura | ¿Entra? | Cómo |
| --- | --- | --- |
| 1. Lo que pasa en la consulta | **Sí, ya cubierto** | ENG-214, con el ADR-020: transcripción, resumen sugerido, revisión del profesional y entrada a la historia clínica marcada como asistida por IA. No hace falta nada nuevo. |
| 2. Antecedentes de otro sistema | **Sí, nuevo** | El paciente importa su **resumen de salud IPS de Argentina** (FHIR). Ver la decisión. |
| 3. Leer los PDF de estudios | **No, por ahora** | Ver "Alternativas". |

## Fuentes investigadas

- **Red Nacional de Salud Digital.** Es un bus de interoperabilidad del Ministerio de
  Salud. Los datos clínicos viven en cada institución y el bus los pone en contacto.
  Conectarse exige ser un establecimiento registrado (REFES) y pasar el proceso de
  integración del Ministerio. MediConnect hoy no cumple esas condiciones.
  ([Estándares de salud digital](https://www.argentina.gob.ar/salud/digital/estandares))
- **IPS de Argentina (IPS-AR).** Es el resumen de paciente basado en el estándar
  internacional IPS sobre FHIR R4: un `Bundle` de tipo `document`, con `Composition` y
  las secciones del piloto (problemas, medicamentos, alergias y vacunas), codificadas
  con SNOMED CT edición argentina. La guía nacional contempla el **intercambio
  mediado por el paciente**: el paciente lleva su documento de un sistema a otro.
  ([grupo de trabajo IPS, SALUD-AR](https://github.com/SALUD-AR/IPS-Argentina);
  [guía IPS-AR del Conectatón](https://conectaton.msal.gob.ar/))
- El sitio de la guía tenía el certificado vencido el 24/11. La estructura se
  verificó con el **ejemplo oficial** del grupo de trabajo, en
  `spikes/ENG-219/ips-argentina-ejemplo.json` (Apache 2.0).

## Prueba de concepto

`spikes/ENG-219/ips-a-medipass.mjs` lee un documento IPS-AR y propone lo que se
cargaría en el MediPass. No usa dependencias y no guarda nada:

```text
$ node ips-a-medipass.mjs ips-argentina-ejemplo.json
allergies:   alergia a la penicilina (Grave)
medications: salbutamol 200 mcg, 1 disparo
conditions:  asma (SNOMED 195967001)
soloLectura: vacuna antigripal, 2017-05-22
```

Lo que mostró:

- **El nombre de SNOMED del producto es ilegible** en una ficha de emergencia:
  "producto que contiene exactamente salbutamol 200 microgramos/disparo en polvo de
  liberación convencional…". Se muestra el principio activo con su concentración,
  que viene en `Medication.ingredient`.
- Las **etiquetas semánticas** de SNOMED ("asma (trastorno)") se sacan para mostrar.
  El código se conserva en `codigo`.
- **Las referencias del ejemplo son absolutas** (`http://hapi.fhir.org/baseR4/...`).
  Se resuelven dentro del mismo documento, por tipo e id.
- **El DNI viene como identificador** con el sistema `http://www.renaper.gob.ar/dni`.
  Sirve para avisar si el documento es de otra persona.
- **Un archivo que no es `Bundle` de tipo `document` se rechaza** con un mensaje claro.

## Principios

1. **La historia clínica la escribe un profesional.** Cada entrada tiene autor y queda
   sellada (Ley 26.529). Lo que viene de afuera no lo escribió nadie de MediConnect:
   **no entra a la cadena**. Se muestra aparte, con su origen.
2. **Lo que aporta el paciente es parte de lo que ve el médico.** El resumen va
   junto a sus estudios, ordenado, para que el profesional conozca sus antecedentes
   (lo marcó el equipo el 24/11: el destino del resumen es la historia, no solo la
   ficha de emergencia).
3. **El paciente controla sus datos.** Él trae el documento y decide si suma algo a
   su MediPass, ítem por ítem. Nada se carga solo.
4. **Integridad:** lo que se sube es lo que se muestra. Se guarda con su SHA-256 y se
   compara antes de leerlo.
5. **Un estándar, no un formato propio.** Se importa IPS-AR porque es el que define el
   Ministerio. Si mañana MediConnect se conecta al bus nacional, recibe el mismo
   documento por otra vía y el lector no cambia.
6. **Ningún dato clínico sale de la plataforma** para importar. La lectura es local,
   sin IA ni servicios externos.

## Decisión

### 1. El resumen es un documento más de los que aporta el paciente (ENG-246)

1. El paciente lo sube donde sube sus estudios: "Mis documentos", en su historia
   clínica (web y app), con la opción "Resumen de salud (IPS)".
2. El backend lo valida antes de guardarlo, con una función pura `readIps()`: la de
   la prueba de concepto llevada a TypeScript con tests. Si no es un resumen IPS, o
   pasa de 1 MB, no entra.
3. **Si el DNI del resumen no es el del paciente, no entra.** El médico lo leería
   como si fuera suyo. Solo se compara si los dos tienen DNI.
4. Se guarda como cualquier documento de ENG-164:
   - bucket privado;
   - cifrado con la clave del paciente (ENG-216);
   - SHA-256 del original;
   - cuota;
   - auditoría;
   - no se borra (se retira).

   Su tipo es `application/fhir+json`, que el bucket acepta desde la migración de
   ENG-246.

### 2. Se ve ordenado, por el paciente y por sus profesionales

- `GET /patient-documents/:id/ips` devuelve problemas, alergias, medicación y
  vacunas. Tiene los mismos permisos que abrir el archivo: el paciente, o un
  profesional que puede leer su historia.
- La lectura queda auditada (`PATIENT_DOCUMENT_VIEW`). Para el profesional falla
  cerrado: si no se puede registrar el acceso, no se muestra nada.
- Antes de mostrarlo se compara con el SHA-256 guardado: si el archivo no es el que
  se subió, no se muestra.
- En pantalla va en "Documentación aportada por el paciente", marcado **No
  validado**, aparte de las entradas firmadas. Si el profesional quiere dejar algo
  asentado, lo escribe él en su evolución.

### 2 bis. Sumarlo al MediPass, si el paciente quiere

Desde el resumen, "Sumar a mi MediPass" muestra las alergias, la medicación y las
condiciones con una casilla por ítem. Lo elegido se **suma** a los datos de
emergencia, sin borrar ni repetir, y se guarda con el `PUT /patients/me/vital` de
siempre.

### 3. La consulta (ENG-214)

Sigue el ADR-020 tal como está.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Escribir lo importado como entradas de la historia clínica** | Una entrada necesita autor. Poner al paciente o a un "sistema" como autor desnaturaliza la historia clínica, y sellar en la cadena datos que nadie de la plataforma validó les da una autoridad que no tienen. |
| **Conectarse al bus de interoperabilidad nacional** | Exige ser un establecimiento registrado y el proceso de integración del Ministerio. Queda como evolución natural: el formato del documento es el mismo. |
| **Leer los PDF de estudios con IA u OCR** | Los PDF traen nombre, DNI y membrete en el texto. Seudonimizar un PDF es mucho más difícil que un texto de consulta, y el ADR-020 no permite mandar datos identificables a un proveedor. Además, un valor de laboratorio mal leído es un error clínico. Se reconsidera con un modelo local y la revisión del profesional. |
| **Formato propio (CSV o JSON de MediConnect)** | Nadie lo genera fuera de la plataforma, así que no carga nada "automáticamente". |
| **Cargar lo importado sin confirmación** | Una alergia equivocada en la ficha de emergencia es tan peligrosa como una que falta (ENG-136). Decide el paciente. |

## Riesgos residuales

- **Pocos documentos IPS-AR en la práctica.** La guía está en piloto. La función
  igual sirve para la demo con el ejemplo oficial, y queda lista para cuando el
  formato se use.
- **Documentos FHIR "casi IPS".** Otros sistemas pueden mandar recursos o códigos
  distintos. El lector ignora lo que no conoce y lo informa ("Se ignora un X"), sin
  fallar.
- **Un documento de otra persona.** Si trae DNI y no es el del paciente, no entra.
  Si no trae DNI, depende de que el paciente suba lo suyo, como con un PDF.

## Consecuencias

- **Positivas:**
  - Hay una respuesta clara a "carga automática", apoyada en el estándar nacional.
  - El profesional ve los antecedentes de afuera, ordenados y auditados, sin que se
    mezclen con lo que se asentó en MediConnect.
  - El MediPass se completa en segundos, si el paciente quiere.
- **Negativas:**
  - Hay que mantener un lector FHIR R4 al lado de las entradas R5.
  - Una migración chica: el bucket de documentos acepta `application/fhir+json`. No
    toca datos ni políticas.

## Implementación

| Orden | Ticket | Qué |
| --- | --- | --- |
| — | [ENG-214](https://linear.app/summercamp-pasantes/issue/ENG-214) | La consulta con IA, ya planificada (ADR-020). |
| 1 | [ENG-246](https://linear.app/summercamp-pasantes/issue/ENG-246) | Subir el resumen como documento, verlo ordenado (paciente y profesional) y sumarlo al MediPass. Incluye lo que era ENG-247. |
