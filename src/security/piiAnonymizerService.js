/**
 * Anonimizacion de PII antes de enviar texto a proveedores LLM (RNF-04
 * del ERS de proximo nivel).
 *
 * Detecta y enmascara IBAN, DNI/NIE, tarjetas (con Luhn), telefonos
 * personales y emails. El mapa token -> valor original NUNCA sale del
 * proceso: las herramientas que necesitan el dato real (p. ej. un
 * telefono autorizado para un envio programado) lo recuperan con
 * restaurar() sobre los argumentos devueltos por el modelo.
 *
 * Lista blanca: los identificadores autorizados pasados en `permitir`
 * no se enmascaran, para no romper herramientas que operan con ellos.
 *
 * Limite declarado: deteccion por patrones (regex + checksums); no es un
 * NER y no garantiza cobertura total de PII libre (nombres, direcciones).
 *
 * Strict Policy: Zero Emojis.
 */

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

function luhnValido(digitos) {
  if (digitos.length < 13 || new Set(digitos).size < 2) return false;
  let suma = 0;
  let doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

function ibanValido(iban) {
  const limpio = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(limpio)) return false;
  // mod-97 (ISO 13616)
  const reordenado = limpio.slice(4) + limpio.slice(0, 4);
  let resto = 0;
  for (const c of reordenado) {
    const s = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const d of s) resto = (resto * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return resto === 1;
}

function dniValido(txt) {
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(txt);
  if (!m) return false;
  const num = (m[1] ? String('XYZ'.indexOf(m[1])) : '') + m[2];
  return LETRAS_DNI[Number(num) % 23] === m[3];
}

// Orden de mayor a menor prioridad: los patrones mas especificos y con
// checksum van primero; se ignoran solapes con tramos ya enmascarados.
const PATRONES = [
  { tipo: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7} ?[A-Z0-9]{0,3}\b/g, valida: ibanValido },
  { tipo: 'TARJETA', re: /\b(?:\d[ -]?){13,19}\b/g, valida: (t) => luhnValido(t.replace(/[ -]/g, '')) },
  { tipo: 'DNI', re: /\b(?:\d{8}|[XYZ]\d{7})[A-Z]\b/g, valida: dniValido },
  { tipo: 'TELEFONO', re: /(?<![\d+])(?:\+34[ -]?)?[6789]\d{2}[ -]?\d{2}[ -]?\d{2}[ -]?\d{2}(?![ -]?\d)/g, valida: null },
  { tipo: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, valida: null }
];

export function crearPiiAnonymizer() {
  /**
   * @param {string} texto Texto de salida hacia el proveedor LLM.
   * @param {string[]} [permitir] Identificadores autorizados que NO se enmascaran.
   * @returns {{ texto: string, mapa: Object<string,string>, detecciones: number }}
   */
  function anonimizar(texto, { permitir = [] } = {}) {
    if (typeof texto !== 'string' || !texto) return { texto: texto ?? '', mapa: {}, detecciones: 0 };
    const permitidos = new Set(permitir.map((p) => String(p).trim()).filter(Boolean));
    const ocupados = [];
    const mapa = {};
    const contadores = {};
    let resultado = texto;
    const desplazamientos = [];
    let detecciones = 0;

    const hallazgos = [];
    for (const { tipo, re, valida } of PATRONES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(texto)) !== null) {
        const valor = m[0];
        if (permitidos.has(valor.trim())) continue;
        if (valida && !valida(valor)) continue;
        hallazgos.push({ inicio: m.index, fin: m.index + valor.length, tipo, valor });
        if (valor.length === 0) re.lastIndex += 1;
      }
    }
    hallazgos.sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
    const elegidos = [];
    for (const h of hallazgos) {
      if (ocupados.some(([i, f]) => h.inicio < f && h.fin > i)) continue;
      ocupados.push([h.inicio, h.fin]);
      elegidos.push(h);
    }
    for (const h of elegidos) {
      contadores[h.tipo] = (contadores[h.tipo] || 0) + 1;
      const token = `[PII_${h.tipo}_${contadores[h.tipo]}]`;
      mapa[token] = h.valor;
      desplazamientos.push({ ...h, token });
      detecciones += 1;
    }
    let delta = 0;
    for (const d of desplazamientos.sort((a, b) => a.inicio - b.inicio)) {
      resultado = resultado.slice(0, d.inicio + delta) + d.token + resultado.slice(d.fin + delta);
      delta += d.token.length - (d.fin - d.inicio);
    }
    return { texto: resultado, mapa, detecciones };
  }

  /**
   * Restaura tokens en un texto devuelto por el modelo (p. ej. argumentos
   * de una herramienta) usando el mapa local. Tokens desconocidos se dejan
   * tal cual (nunca se inventa el valor).
   */
  function restaurar(texto, mapa) {
    if (typeof texto !== 'string' || !mapa) return texto ?? '';
    let out = texto;
    for (const [token, valor] of Object.entries(mapa)) {
      out = out.split(token).join(valor);
    }
    return out;
  }

  return Object.freeze({ anonimizar, restaurar });
}
