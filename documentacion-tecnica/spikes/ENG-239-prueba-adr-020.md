# ENG-239 — Spike: prueba de la arquitectura de IA y cifrado (ADR-020)

**Épica:** EP-07 (IA clínica) · **Tipo:** Spike · **Revisión técnica**
**Autor:** Magris

## Objetivo

Confirmar, antes de escribir el código definitivo (ENG-216, ENG-215 y ENG-214),
que las piezas del [ADR-020](../adr/ADR-020-arquitectura-ia-cifrado.md) funcionan
como se diseñaron. Si algo no funciona, el ADR se corrige antes.

El ticket pide cinco pruebas. Este informe registra las dos que **no necesitan
claves externas**:

| # | Prueba | Estado |
| --- | --- | --- |
| 1 | Cifrado de sobre | **Hecha (22/11)** |
| 2 | Seudonimización en tres capas | **Hecha (22/11)** |
| 3 | Captura de las dos pistas de audio en Daily | Pendiente: necesita una sala de prueba con dos personas |
| 4 | Pipeline con OpenAI y Claude | Pendiente: faltan las API keys |
| 5 | Evaluación de Haiku 5.5 | Pendiente: faltan las API keys |

Todo es **ficticio**: ningún dato es de una persona real, y nada toca la base de
producción. Los scripts están en [`ENG-239/`](./ENG-239/) y se corren con Node 24:

```bash
cd documentacion-tecnica/spikes/ENG-239
npm install
node envelope.mjs
node pseudonymize.mjs
node --expose-gc memoria.mjs
node largo.mjs
node cuantizacion.mjs q8
```

---

## 1. Cifrado de sobre (ADR-020, punto 8)

`envelope.mjs` implementa el esquema del ADR con `node:crypto`:
- AES-256-GCM;
- una **DEK por paciente** envuelta con una **KEK versionada** (`kid`);
- los datos de la fila (paciente, tabla, id y campo) como **AAD**;
- el valor en una sola columna, como `v1.<nonce>.<etiqueta>.<texto>`.

| Lo que se prueba | Resultado |
| --- | --- |
| Cifrar y descifrar una entrada con la DEK del paciente; el texto no queda legible | OK |
| La base nunca tiene una DEK en claro (solo la envuelta, con su `kid`) | OK |
| El mismo texto cifrado dos veces da valores distintos (nonce aleatorio) | OK |
| **Rotar la KEK** re-envuelve solo las DEK: los datos no se re-cifran y se siguen leyendo; la KEK vieja se puede retirar | OK |
| **Un valor copiado a otra fila no se descifra**: otra entrada, otro campo u otro paciente | OK |
| Un valor alterado no se descifra (la etiqueta de GCM lo detecta) | OK |
| Con otra KEK no se abre ninguna DEK | OK |
| Borrar la DEK de un paciente vuelve ilegible todo lo suyo (para lo que la ley deja borrar) | OK |

**Costo:**
- **~25 µs** para cifrar y descifrar una entrada típica, incluido desenvolver la DEK: 10.000 entradas en 248 ms.
- Una entrada de 130 caracteres ocupa 219 guardada (+89: versión, nonce, etiqueta y base64).

**Conclusión:** el esquema del ADR funciona como se diseñó. No hay nada que corregir.

---

## 2. Seudonimización en tres capas (ADR-020, punto 4)

`pseudonymize.mjs` pasa una transcripción ficticia de una consulta por las tres capas:
1. **Diccionario exacto:** nombre, DNI, teléfono, mail y dirección del paciente y del profesional.
2. **Patrones:** mail, URL, CUIL, número de afiliado, fechas, DNI y teléfono.
3. **Reconocimiento de entidades local:** `Xenova/distilbert-base-multilingual-cased-ner-hrl`, cuantizado q8, con transformers.js 3.8, en Node, sin GPU ni servicios externos.

Después **reidentifica**. La transcripción tiene trampas a propósito: una negación ("no soy alérgica a la penicilina"), dosis, antecedentes y familiares nombrados.

**Lo que viajaría al modelo de lenguaje:**

```text
[PROFESIONAL]: Buenas tardes [PACIENTE], ¿cómo anduvo la semana?
Paciente: Bien doctor, aunque me siguen los dolores de cabeza. Le recuerdo que mi DNI es [DNI_1] y mi celular el [TELEFONO_1], por si me tiene que llamar.
[PROFESIONAL]: Perfecto. ¿Seguís con el enalapril de 10 mg cada 12 horas?
Paciente: Sí, todos los días. Ah, no soy alérgica a la penicilina, eso lo había dicho mal la vez pasada.
[PROFESIONAL]: Bien que lo aclares. ¿Antecedentes en la familia?
Paciente: Mi hermana [PERSONA_1] tuvo un ACV a los 50 y mi papá, [PERSONA_2], es diabético. Yo vivo en [LUGAR_1] desde marzo, me mudé de [DIRECCION_1].
[PROFESIONAL]: Te mando la receta a [MAIL_1]. Mi colega, la doctora [PERSONA_3] del [ORGANIZACION_1], te puede ver por la presión.
Paciente: Gracias. Mi obra social es [ORGANIZACION_2], afiliado [AFILIADO_1], y nací el [FECHA_1].
[PROFESIONAL]: Listo. Ibuprofeno 400 mg solo si duele, y control en 30 días.
```

| Lo que se mide | Resultado |
| --- | --- |
| Identificadores que quedaron a la vista (12 esperados: nombres, DNI, teléfono, mail, dirección, familiares, ciudad, colega, afiliado y fecha de nacimiento) | **Ninguno** |
| Datos clínicos tapados por error (medicación y dosis, la negación, antecedentes y el plan) | **Ninguno** |
| Tiempo | Diccionario 5 ms, patrones 0,5 ms, entidades ~170 ms. La carga del modelo desde la caché tarda 0,3 s; la primera vez lo descarga |

### Hallazgos que corrigen o completan el ADR

1. **Organizaciones.** El modelo también detecta instituciones ("Hospital Italiano") y obras sociales ("OSDE"). El ADR solo hablaba de personas y lugares. Conviene taparlas (`[ORGANIZACION_n]`): una institución o una obra social, junto con otros datos, ayudan a identificar a alguien. Al resumen no le hacen falta.
2. **Reidentificación canónica.** `[PACIENTE]` y `[PROFESIONAL]` vuelven con el nombre completo, no con la forma en que se dijo: "Doctor Gómez" vuelve como "Martín Gómez". Para un resumen es lo correcto, pero el texto reidentificado no es idéntico al original, y el ADR tiene que decirlo.
3. **Texto largo: hay que partirlo.** Una consulta de 30 minutos son ~4.500 palabras, y el modelo lee 512 tokens por vez.
   - **Con el texto entero, el modelo no encontró ningún nombre** (`largo.mjs`).
   - Partido en pedazos de hasta ~300 palabras, por oración, encontró todos los nombres: 16 pedazos en ~1,3 s.
   - Hay que partirlo siempre, y procesar los pedazos **de a uno**, no en paralelo, por la memoria.
4. **El modelo se carga una vez y se mantiene.** Descartarlo (`dispose()`) no devuelve la memoria, y volver a cargarlo la hace crecer: 333, 479 y 366 MB en tres vueltas (`memoria.mjs`). Hay que cargarlo una sola vez, la primera vez que hace falta, y no liberarlo.
5. **Memoria: la tercera capa no entra cómoda en Render free.**

| | Memoria (RSS) |
| --- | --- |
| Backend NestJS en reposo (medido localmente) | ~171 MB |
| Node solo, sin el modelo | ~68 MB |
| Node con el modelo cargado (q8) | ~325 a 333 MB |
| Node con el modelo, procesando una consulta de 30 minutos en pedazos | ~377 MB |
| **Estimado del backend con la tercera capa** | **~430 a 480 MB, de 512 MB** |

Otras cuantizaciones no ayudan (`cuantizacion.mjs`): int8 y uint8 dan ~325 MB, y q4 y fp16, ~565 MB. Las cinco detectan lo mismo.

**Conclusión:** las tres capas funcionan como se diseñaron, con los ajustes 1 a 4. El punto 5 es una **decisión pendiente**: así como está en el ADR, la tercera capa dejaría al backend a ~30-80 MB del límite de Render free, con riesgo de que el proceso se caiga por memoria bajo carga.

### Opciones para la memoria (a decidir antes de ENG-215)

| Opción | Ventajas | Costos |
| --- | --- | --- |
| **A. El pipeline de IA corre en GitHub Actions**, como la verificación de integridad semanal (ENG-85), disparado por el scheduler (ENG-228) | El backend queda liviano (~171 MB). Los runners de GitHub tienen al menos 7 GB. Sin costo | La KEK y las API keys también van como secrets de GitHub. El resumen tarda unos minutos más (el profesional lo revisa después) |
| **B. Plan pago de Render** (Standard, 2 GB) | Sin cambios de arquitectura | Costo mensual |
| **C. Solo las capas 1 y 2 en Render** | Sin costo ni cambios | Los nombres de terceros ("mi hermana Laura", "vivo en Tandil") no se tapan. Quedan cubiertos solo por el proveedor que no entrena con los datos |

---

## Próximos pasos

1. **ENG-216 (cifrado) puede empezar ya:** la prueba 1 no dejó nada que corregir.
2. Decidir la opción de memoria y registrar en el ADR-020 los hallazgos 1 a 5. Con eso, ENG-215 (seudonimización).
3. Con las API keys: las pruebas 4 y 5. Con una sala de Daily y dos personas: la prueba 3. Después, ENG-214 (pipeline).
