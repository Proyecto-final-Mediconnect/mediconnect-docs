// ENG-239, punto 1 — Cifrado de sobre (ADR-020, punto 8), sin claves externas.
//
//   node envelope.mjs
//
// Qué prueba, con asserts que cortan si algo no da:
//   1. Cifrar y descifrar con una DEK por paciente envuelta con una KEK versionada.
//   2. Rotar la KEK re-envolviendo solo las DEK: los datos no se tocan y se siguen leyendo.
//   3. Un valor copiado a otra fila (otro paciente, otra entrada u otro campo) no se descifra.
//   4. Un valor alterado, una KEK equivocada o una DEK de otro paciente no descifran.
//   5. El costo: cuánto tarda cifrar y descifrar una entrada típica de historia clínica.
//
// Todo es ficticio y en memoria: no toca ninguna base.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const ALG = 'aes-256-gcm';
const NONCE_BYTES = 12;

// --- Primitivas ---------------------------------------------------------------

/** Cifra con AES-256-GCM. `aad` ata el valor a su lugar: no se descifra en otro. */
function seal(key, plaintext, aad) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALG, key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, tag: cipher.getAuthTag(), ciphertext };
}

function open(key, sealed, aad) {
  const decipher = createDecipheriv(ALG, key, sealed.nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

// --- KEK versionadas (en prod: variable de entorno de Render) -------------------

/** `kid` → KEK. La activa es la última; las viejas quedan para leer lo ya envuelto. */
const keks = new Map([['k1', randomBytes(32)]]);
let activeKid = 'k1';

// --- Las DEK, una por paciente, guardadas envueltas -----------------------------

/** Tabla `patient_keys`: la base nunca tiene una DEK en claro. */
const patientKeys = new Map(); // patientId -> { kid, wrapped }

function wrapDek(dek, patientId, kid) {
  return { kid, wrapped: seal(keks.get(kid), dek, `dek:${patientId}:${kid}`) };
}

function unwrapDek(patientId) {
  const row = patientKeys.get(patientId);
  assert.ok(row, `sin DEK para ${patientId}`);
  return open(keks.get(row.kid), row.wrapped, `dek:${patientId}:${row.kid}`);
}

function dekFor(patientId) {
  if (!patientKeys.has(patientId)) {
    patientKeys.set(patientId, wrapDek(randomBytes(32), patientId, activeKid));
  }
  return unwrapDek(patientId);
}

// --- Un valor cifrado: versión, nonce, tag y texto, en una sola columna ----------

/** `v1.<nonce>.<tag>.<ciphertext>` en base64url. La versión 0 es texto en claro (lo viejo). */
function encryptField(patientId, location, value) {
  const sealed = seal(dekFor(patientId), Buffer.from(value, 'utf8'), aadOf(patientId, location));
  return ['v1', sealed.nonce, sealed.tag, sealed.ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

function decryptField(patientId, location, stored) {
  const [version, nonce, tag, ciphertext] = stored.split('.');
  assert.equal(version, 'v1');
  const sealed = {
    nonce: Buffer.from(nonce, 'base64url'),
    tag: Buffer.from(tag, 'base64url'),
    ciphertext: Buffer.from(ciphertext, 'base64url'),
  };
  return open(unwrapDek(patientId), sealed, aadOf(patientId, location)).toString('utf8');
}

/** Lo que ata el valor a su fila: paciente, tabla, id y campo. */
function aadOf(patientId, { table, id, field }) {
  return `${table}:${id}:${field}:${patientId}`;
}

// --- Las pruebas ---------------------------------------------------------------

const resultados = [];
function prueba(nombre, fn) {
  fn();
  resultados.push(`OK  ${nombre}`);
}

const PACIENTE_A = 'paciente-a';
const PACIENTE_B = 'paciente-b';
const ENTRADA = { table: 'clinical_record_entries', id: 'entrada-1', field: 'content' };
const CONTENIDO = JSON.stringify({
  motivo: 'Control de hipertensión',
  indicaciones: 'Enalapril 10 mg cada 12 horas. Control en 30 días.',
  alergias: ['penicilina'],
});

let guardado;

prueba('cifrar y descifrar una entrada con la DEK del paciente', () => {
  guardado = encryptField(PACIENTE_A, ENTRADA, CONTENIDO);
  assert.ok(!guardado.includes('Enalapril'), 'el texto no puede quedar legible');
  assert.equal(decryptField(PACIENTE_A, ENTRADA, guardado), CONTENIDO);
});

prueba('la base nunca tiene una DEK en claro', () => {
  const fila = patientKeys.get(PACIENTE_A);
  assert.equal(fila.kid, 'k1');
  assert.equal(fila.wrapped.ciphertext.length, 32);
  assert.notDeepEqual(fila.wrapped.ciphertext, unwrapDek(PACIENTE_A));
});

prueba('el mismo texto cifrado dos veces da valores distintos (nonce aleatorio)', () => {
  assert.notEqual(encryptField(PACIENTE_A, ENTRADA, CONTENIDO), guardado);
});

prueba('rotar la KEK re-envuelve solo las DEK y lo cifrado se sigue leyendo', () => {
  const antes = guardado;
  keks.set('k2', randomBytes(32));
  activeKid = 'k2';
  for (const [patientId] of patientKeys) {
    const dek = unwrapDek(patientId);
    patientKeys.set(patientId, wrapDek(dek, patientId, 'k2'));
  }
  // La KEK vieja se puede retirar: ninguna DEK la usa.
  keks.delete('k1');
  assert.equal(patientKeys.get(PACIENTE_A).kid, 'k2');
  assert.equal(guardado, antes, 'los datos no se re-cifran');
  assert.equal(decryptField(PACIENTE_A, ENTRADA, guardado), CONTENIDO);
});

prueba('un valor copiado a otra fila no se descifra', () => {
  dekFor(PACIENTE_B);
  const otraEntrada = { ...ENTRADA, id: 'entrada-2' };
  const otroCampo = { ...ENTRADA, field: 'summary' };
  assert.throws(() => decryptField(PACIENTE_A, otraEntrada, guardado));
  assert.throws(() => decryptField(PACIENTE_A, otroCampo, guardado));
  // Ni pegado en la historia de otro paciente (otra DEK y otro AAD).
  assert.throws(() => decryptField(PACIENTE_B, ENTRADA, guardado));
});

prueba('un valor alterado no se descifra (la etiqueta de GCM lo detecta)', () => {
  const partes = guardado.split('.');
  const texto = Buffer.from(partes[3], 'base64url');
  texto[0] ^= 0x01;
  partes[3] = texto.toString('base64url');
  assert.throws(() => decryptField(PACIENTE_A, ENTRADA, partes.join('.')));
});

prueba('con otra KEK no se abre ninguna DEK', () => {
  const real = keks.get('k2');
  keks.set('k2', randomBytes(32));
  assert.throws(() => unwrapDek(PACIENTE_A));
  keks.set('k2', real);
});

prueba('borrar la DEK de un paciente vuelve ilegible todo lo suyo', () => {
  const copia = patientKeys.get(PACIENTE_B);
  const suyo = encryptField(PACIENTE_B, ENTRADA, 'Audio y transcripción de la consulta');
  patientKeys.delete(PACIENTE_B);
  assert.throws(() => decryptField(PACIENTE_B, ENTRADA, suyo));
  patientKeys.set(PACIENTE_B, copia);
});

// --- Costo -------------------------------------------------------------------------

const VUELTAS = 10_000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < VUELTAS; i++) {
  decryptField(PACIENTE_A, ENTRADA, encryptField(PACIENTE_A, ENTRADA, CONTENIDO));
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log(resultados.join('\n'));
console.log(
  `\nCosto: ${VUELTAS} entradas cifradas y descifradas en ${ms.toFixed(0)} ms ` +
    `(${((ms / VUELTAS) * 1000).toFixed(1)} µs por entrada, con el desenvolver de la DEK incluido).`,
);
console.log(
  `Tamaño: una entrada de ${CONTENIDO.length} caracteres ocupa ${guardado.length} guardada ` +
    `(+${guardado.length - CONTENIDO.length}: versión, nonce, etiqueta y base64).`,
);
