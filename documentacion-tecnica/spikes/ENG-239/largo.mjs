// ENG-239, punto 2 — Una consulta de 30 minutos es más larga que lo que el
// modelo lee de una vez (512 tokens). ¿Se le escapan los nombres del final?
//   node largo.mjs
import { pipeline } from '@huggingface/transformers';

const ner = await pipeline('token-classification', 'Xenova/distilbert-base-multilingual-cased-ner-hrl', { dtype: 'q8' });
const relleno = 'Paciente: me duele un poco la espalda cuando me levanto a la mañana, sobre todo después de caminar. ';
// ~4.000 palabras, como una consulta de 30 minutos, con un nombre al principio y otro al final.
const largo = `Mi hermana Laura me acompañó. ${relleno.repeat(250)}Al final vino mi primo Esteban desde Bariloche.`;

const entero = await ner(largo, { ignore_labels: ['O'] });
const nombres = (tokens) => [...new Set(tokens.map((t) => t.word.replace('##', '')))].join(', ');
console.log(`Palabras: ${largo.split(/\s+/).length}`);
console.log(`Todo de una vez: encontró ${nombres(entero) || 'nada'}`);

// En pedazos de oraciones, de hasta ~300 palabras cada uno.
const oraciones = largo.match(/[^.!?]+[.!?]+/g);
const pedazos = [];
let actual = '';
for (const o of oraciones) {
  if ((actual + o).split(/\s+/).length > 300) { pedazos.push(actual); actual = ''; }
  actual += o;
}
pedazos.push(actual);
const t = performance.now();
const porPedazos = [];
for (const p of pedazos) porPedazos.push(...(await ner(p, { ignore_labels: ["O"] })));
console.log(`En ${pedazos.length} pedazos: encontró ${nombres(porPedazos)} en ${(performance.now() - t).toFixed(0)} ms`);
console.log(`Memoria: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`);
