// ENG-239, punto 2 — Seudonimización en tres capas (ADR-020, punto 4), sin claves externas.
//
//   node pseudonymize.mjs [modelo]
//
// Pasa una transcripción FICTICIA por las tres capas (diccionario, patrones y
// reconocimiento de entidades local), reidentifica y mide:
//   - qué identificadores quedaron afuera (tiene que ser ninguno);
//   - qué datos clínicos se taparon por error (tiene que ser ninguno);
//   - la memoria del proceso con el modelo cargado (Render free: 512 MB);
//   - el tiempo de cada capa.
//
// Ningún dato es de una persona real. El modelo se baja de Hugging Face la
// primera vez y queda en la caché local.

import { pipeline, env } from '@huggingface/transformers';
import assert from 'node:assert/strict';

env.allowLocalModels = false;

const MODELO = process.argv[2] ?? 'Xenova/distilbert-base-multilingual-cased-ner-hrl';
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const rssInicial = process.memoryUsage().rss;

// --- Lo que el sistema ya sabe (capa 1) -------------------------------------------

const CONOCIDO = {
  PACIENTE: ['Lucía Fernández', 'Lucía', 'Fernández'],
  PROFESIONAL: ['Martín Gómez', 'doctor Gómez', 'Gómez', 'Martín'],
  DNI_PACIENTE: ['30.123.456', '30123456'],
  TELEFONO_PACIENTE: ['351 555-0199', '3515550199'],
  MAIL_PACIENTE: ['lucia.fernandez@example.com'],
  DIRECCION_PACIENTE: ['Avenida Colón 1234'],
};

// --- La transcripción ficticia ------------------------------------------------------

const TRANSCRIPCION = `Doctor Gómez: Buenas tardes Lucía, ¿cómo anduvo la semana?
Paciente: Bien doctor, aunque me siguen los dolores de cabeza. Le recuerdo que mi DNI es 30.123.456 y mi celular el 351 555-0199, por si me tiene que llamar.
Doctor Gómez: Perfecto. ¿Seguís con el enalapril de 10 mg cada 12 horas?
Paciente: Sí, todos los días. Ah, no soy alérgica a la penicilina, eso lo había dicho mal la vez pasada.
Doctor Gómez: Bien que lo aclares. ¿Antecedentes en la familia?
Paciente: Mi hermana Laura tuvo un ACV a los 50 y mi papá, Roberto, es diabético. Yo vivo en Tandil desde marzo, me mudé de Avenida Colón 1234.
Doctor Gómez: Te mando la receta a lucia.fernandez@example.com. Mi colega, la doctora Sofía Ibarra del Hospital Italiano, te puede ver por la presión.
Paciente: Gracias. Mi obra social es OSDE, afiliado 61 234567 8, y nací el 14/02/1983.
Doctor Gómez: Listo. Ibuprofeno 400 mg solo si duele, y control en 30 días.`;

/** Lo que tiene que desaparecer: identificadores directos o indirectos. */
const DEBE_SALIR = [
  'Lucía', 'Gómez', '30.123.456', '351 555-0199', 'lucia.fernandez@example.com',
  'Avenida Colón 1234', 'Laura', 'Roberto', 'Tandil', 'Sofía Ibarra',
  '61 234567 8', '14/02/1983',
];

/** Lo que el resumen necesita: nunca se tapa. */
const DEBE_QUEDAR = [
  'enalapril de 10 mg cada 12 horas', 'no soy alérgica a la penicilina', 'ACV a los 50',
  'diabético', 'Ibuprofeno 400 mg', 'control en 30 días', 'dolores de cabeza',
];

// --- El reemplazo con marcadores consistentes ----------------------------------------

/** Valor original → marcador. Nunca sale del backend; se descarta al reidentificar. */
const tabla = new Map();
const contadores = new Map();

function marcador(tipo, valor) {
  const clave = `${tipo}|${valor.toLowerCase()}`;
  if (!tabla.has(clave)) {
    const fijo = ['PACIENTE', 'PROFESIONAL'].includes(tipo);
    const n = (contadores.get(tipo) ?? 0) + 1;
    contadores.set(tipo, n);
    tabla.set(clave, { marcador: fijo ? `[${tipo}]` : `[${tipo}_${n}]`, valor });
  }
  return tabla.get(clave).marcador;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Capa 1: diccionario exacto, de lo más largo a lo más corto ("Lucía Fernández" antes que "Lucía").
function capaDiccionario(texto) {
  const pares = Object.entries(CONOCIDO)
    .flatMap(([tipo, valores]) => valores.map((v) => [tipo, v]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [tipo, valor] of pares) {
    const tipoMarcador = tipo.startsWith('PACIENTE') || tipo === 'PROFESIONAL'
      ? tipo
      : tipo.split('_')[0];
    const re = new RegExp(`(?<![\\p{L}\\d])${escapar(valor)}(?![\\p{L}\\d])`, 'giu');
    texto = texto.replace(re, (m) =>
      ['PACIENTE', 'PROFESIONAL'].includes(tipoMarcador) ? `[${tipoMarcador}]` : marcador(tipoMarcador, m),
    );
  }
  return texto;
}

// Capa 2: patrones de identificadores que el sistema no conoce de antemano.
const PATRONES = [
  ['MAIL', /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ['URL', /https?:\/\/\S+/g],
  ['CUIL', /\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b/g],
  ['AFILIADO', /(?<=afiliad[oa]\s+(?:n(?:ú|u)mero\s+)?)\d[\d\s/-]{5,}\d/giu],
  ['FECHA', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g],
  ['DNI', /\b\d{1,2}\.\d{3}\.\d{3}\b/g],
  ['TELEFONO', /(?:\+?54\s?)?(?:9\s?)?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g],
];

function capaPatrones(texto) {
  for (const [tipo, re] of PATRONES) {
    texto = texto.replace(re, (m) => (m.startsWith('[') ? m : marcador(tipo, m)));
  }
  return texto;
}

// Capa 3: entidades con el modelo local (personas y lugares que nadie cargó).
async function capaEntidades(ner, texto) {
  const tokens = await ner(texto, { ignore_labels: ['O'] });
  // Junta los subtokens ("Tan" + "##dil") y los B-/I- de una misma entidad.
  const entidades = [];
  for (const t of tokens) {
    const tipo = t.entity.replace(/^[BI]-/, '');
    const palabra = t.word.startsWith('##') ? t.word.slice(2) : t.word;
    const ultima = entidades.at(-1);
    const continua = ultima && ultima.tipo === tipo && (t.word.startsWith('##') || t.entity.startsWith('I-')) && t.index === ultima.fin + 1;
    if (continua) {
      ultima.texto += t.word.startsWith('##') ? palabra : ` ${palabra}`;
      ultima.fin = t.index;
    } else {
      entidades.push({ tipo, texto: palabra, fin: t.index, score: t.score });
    }
  }
  const TIPOS = { PER: 'PERSONA', LOC: 'LUGAR', ORG: 'ORGANIZACION' };
  for (const e of entidades) {
    const tipo = TIPOS[e.tipo];
    // Lo ya reemplazado ("[PACIENTE]") vuelve como entidad: se ignora.
    if (!tipo || e.texto.includes('[') || e.texto.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\d\\[])${escapar(e.texto)}(?![\\p{L}\\d])`, 'gu');
    texto = texto.replace(re, (m) => marcador(tipo, m));
  }
  return { texto, entidades };
}

function reidentificar(texto) {
  let resultado = texto;
  for (const { marcador: m, valor } of tabla.values()) {
    resultado = resultado.split(m).join(valor);
  }
  return resultado
    .replaceAll('[PACIENTE]', 'Lucía Fernández')
    .replaceAll('[PROFESIONAL]', 'Martín Gómez');
}

// --- Correr y medir --------------------------------------------------------------------

const t0 = performance.now();
let texto = capaDiccionario(TRANSCRIPCION);
const t1 = performance.now();
texto = capaPatrones(texto);
const t2 = performance.now();

const tCarga = performance.now();
const ner = await pipeline('token-classification', MODELO, { dtype: 'q8' });
const msCarga = performance.now() - tCarga;
const rssConModelo = process.memoryUsage().rss;

const t3 = performance.now();
const { texto: seudonimizado, entidades } = await capaEntidades(ner, texto);
const t4 = performance.now();
const rssPico = process.memoryUsage().rss;

console.log('--- Seudonimizado (lo que viajaría al modelo de lenguaje) ---\n');
console.log(seudonimizado);
console.log('\n--- Entidades que encontró el modelo ---');
console.log(entidades.map((e) => `${e.tipo} "${e.texto}" (${e.score.toFixed(2)})`).join('\n'));

const quedaron = DEBE_SALIR.filter((v) => seudonimizado.includes(v));
const tapados = DEBE_QUEDAR.filter((v) => !seudonimizado.toLowerCase().includes(v.toLowerCase()));
const vuelta = reidentificar(seudonimizado);

console.log('\n--- Resultado ---');
console.log(`Identificadores que quedaron a la vista: ${quedaron.length ? quedaron.join(', ') : 'ninguno'}`);
console.log(`Datos clínicos tapados por error: ${tapados.length ? tapados.join(', ') : 'ninguno'}`);
console.log(`Reidentificado igual al original: ${vuelta === TRANSCRIPCION ? 'sí' : 'no'}`);
console.log(`Marcadores en la tabla: ${tabla.size}`);
console.log('\n--- Costo ---');
console.log(`Modelo: ${MODELO} (q8)`);
console.log(`Memoria del proceso: ${mb(rssInicial)} al arrancar, ${mb(rssConModelo)} con el modelo cargado, ${mb(rssPico)} después de usarlo (Render free: 512 MB).`);
console.log(`Tiempo: diccionario ${(t1 - t0).toFixed(1)} ms, patrones ${(t2 - t1).toFixed(1)} ms, carga del modelo ${(msCarga / 1000).toFixed(1)} s, entidades ${(t4 - t3).toFixed(0)} ms.`);

if (vuelta !== TRANSCRIPCION) {
  console.log('\n--- Diferencias al reidentificar ---');
  const a = TRANSCRIPCION.split('\n');
  const b = vuelta.split('\n');
  a.forEach((linea, i) => {
    if (linea !== b[i]) console.log(`- ${linea}\n+ ${b[i]}`);
  });
}

assert.ok(true);
