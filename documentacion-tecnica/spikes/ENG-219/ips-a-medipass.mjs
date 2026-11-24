// Prueba de concepto de ENG-219: leer un resumen de paciente IPS de Argentina
// (FHIR R4, Bundle de tipo `document`) y proponer lo que cargaría el MediPass.
//
// Uso:  node ips-a-medipass.mjs ips-argentina-ejemplo.json
//
// No guarda nada: imprime lo que se le mostraría al paciente para confirmar.
// `ips-argentina-ejemplo.json` es el ejemplo oficial del grupo de trabajo IPS
// del Ministerio de Salud (github.com/SALUD-AR/IPS-Argentina, Apache 2.0).

import { readFileSync } from 'node:fs';

/** Los mismos topes que `UpdateVitalInfoDto` del backend. */
const MAX = { que: 120, gravedad: 60, droga: 120, dosis: 60, nombre: 120, codigo: 30 };
const SNOMED = /^https?:\/\/snomed\.info\/sct/;

/** Lo que se muestra de un concepto: el texto o el primer `display`, sin la
 *  etiqueta semántica de SNOMED ("asma (trastorno)" → "asma"). */
function texto(concepto) {
  const crudo = concepto?.text ?? concepto?.coding?.find((c) => c.display)?.display ?? '';
  return crudo.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function snomed(concepto) {
  const c = concepto?.coding?.find((x) => SNOMED.test(x.system ?? ''));
  return c?.code ? `SNOMED ${c.code}` : undefined;
}

const recortar = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function leerIps(bundle) {
  const problemas = [];
  if (bundle?.resourceType !== 'Bundle' || bundle.type !== 'document') {
    throw new Error('No es un documento FHIR: se espera un Bundle de tipo "document".');
  }
  const recursos = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean);
  const composicion = recursos.find((r) => r.resourceType === 'Composition');
  if (!composicion) throw new Error('El documento no tiene Composition: no es un resumen IPS.');

  // Las referencias pueden ser absolutas (el ejemplo usa http://hapi.fhir.org/...):
  // se resuelven por el id del final.
  const porId = new Map(recursos.map((r) => [`${r.resourceType}/${r.id}`, r]));
  const resolver = (ref) => {
    const m = /([A-Za-z]+\/[^/]+)$/.exec(ref?.reference ?? '');
    return m ? porId.get(m[1]) : undefined;
  };

  const paciente = recursos.find((r) => r.resourceType === 'Patient');
  const dni = paciente?.identifier?.find((i) => /renaper\.gob\.ar\/dni/.test(i.system ?? ''))?.value;

  const alergias = recursos
    .filter((r) => r.resourceType === 'AllergyIntolerance')
    .filter((r) => !/inactive|resolved/.test(r.clinicalStatus?.coding?.[0]?.code ?? ''))
    .map((r) => ({
      que: recortar(texto(r.code), MAX.que),
      gravedad: r.criticality === 'high' ? 'Grave' : r.criticality === 'low' ? 'Leve' : undefined,
    }))
    .filter((a) => a.que);

  const medicacion = recursos
    .filter((r) => r.resourceType === 'MedicationStatement')
    .filter((r) => (r.status ?? 'active') === 'active')
    .map((r) => {
      const medicamento = resolver(r.medicationReference);
      const concepto = r.medicationCodeableConcept ?? medicamento?.code;
      // El nombre de SNOMED del producto es larguísimo ("producto que contiene
      // exactamente salbutamol 200 microgramos/disparo en polvo…"): si el
      // Medication trae los principios activos, se muestran esos con su concentración.
      const activos = (medicamento?.ingredient ?? [])
        .filter((i) => i.isActive !== false)
        .map((i) => {
          const nombre = texto(i.itemCodeableConcept ?? i.code);
          const n = i.strength?.numerator;
          return n ? `${nombre} ${n.value} ${n.unit}` : nombre;
        })
        .filter(Boolean);
      const dosis = r.dosage?.[0];
      const cantidad = dosis?.doseAndRate?.[0]?.doseQuantity;
      return {
        droga: recortar(activos.length ? activos.join(' + ') : texto(concepto), MAX.droga),
        dosis: cantidad ? recortar(`${cantidad.value} ${texto({ text: cantidad.unit })}`, MAX.dosis) : undefined,
      };
    })
    .filter((m) => m.droga);

  const condiciones = recursos
    .filter((r) => r.resourceType === 'Condition')
    .filter((r) => !/inactive|resolved|remission/.test(r.clinicalStatus?.coding?.[0]?.code ?? ''))
    .map((r) => ({ nombre: recortar(texto(r.code), MAX.nombre), codigo: snomed(r.code) }))
    .filter((c) => c.nombre);

  // Las vacunas no tienen lugar en el MediPass: quedan en el resumen importado.
  const vacunas = recursos
    .filter((r) => r.resourceType === 'Immunization')
    .map((r) => ({ vacuna: texto(r.vaccineCode), fecha: r.occurrenceDateTime }));

  for (const r of recursos) {
    if (!['Composition', 'Patient', 'AllergyIntolerance', 'MedicationStatement', 'Medication', 'Condition', 'Immunization', 'Organization', 'Device', 'Practitioner'].includes(r.resourceType)) {
      problemas.push(`Se ignora un ${r.resourceType}: el MediPass no lo usa.`);
    }
  }

  return {
    documento: { titulo: composicion.title, fecha: composicion.date, dni },
    propuesta: { allergies: alergias, medications: medicacion, conditions: condiciones },
    soloLectura: { vacunas },
    problemas,
  };
}

if (process.argv[2]) {
  const bundle = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(leerIps(bundle), null, 2));
}
