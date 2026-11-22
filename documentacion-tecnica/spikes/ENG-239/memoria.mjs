// ENG-239, punto 2 — ¿Libera la memoria el modelo de entidades al descartarlo?
//   node --expose-gc memoria.mjs
import { pipeline } from '@huggingface/transformers';

const mb = () => `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`;
const MODELO = 'Xenova/distilbert-base-multilingual-cased-ner-hrl';
const TEXTO = 'Mi hermana Laura vive en Tandil y mi papá Roberto en Córdoba.';

console.log(`Al arrancar: ${mb()}`);
for (let vuelta = 1; vuelta <= 3; vuelta++) {
  const t = performance.now();
  const ner = await pipeline('token-classification', MODELO, { dtype: 'q8' });
  const carga = ((performance.now() - t) / 1000).toFixed(1);
  await ner(TEXTO);
  const conModelo = mb();
  await ner.dispose();
  globalThis.gc?.();
  await new Promise((r) => setTimeout(r, 500));
  console.log(`Vuelta ${vuelta}: carga desde la caché ${carga} s · con el modelo ${conModelo} · después de descartarlo ${mb()}`);
}
