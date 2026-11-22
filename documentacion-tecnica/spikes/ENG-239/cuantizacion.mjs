// ENG-239 — ¿Cuánto baja la memoria con otras cuantizaciones del mismo modelo?
import { pipeline } from '@huggingface/transformers';
const dtype = process.argv[2];
const ner = await pipeline('token-classification', 'Xenova/distilbert-base-multilingual-cased-ner-hrl', { dtype });
const texto = 'Mi hermana Laura tuvo un ACV y mi papá, Roberto, es diabético. Yo vivo en Tandil. La doctora Sofía Ibarra del Hospital Italiano me atiende. No soy alérgica a la penicilina.';
const r = await ner(texto, { ignore_labels: ['O'] });
console.log(`${dtype}: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB · ${[...new Set(r.map((t) => `${t.entity}:${t.word}`))].join(' ')}`);
