/**
 * ocr.js - Modulo de extraccion OCR estructurada de tickets y facturas.
 *
 * Extrae de forma determinista:
 *   - cif: Codigo de Identificacion Fiscal / NIF / NIE espanol
 *   - base: Base imponible antes de impuestos
 *   - iva: Cuota de impuesto sobre el valor anadido
 *   - total: Importe total del ticket/factura
 *   - fecha: Fecha de expedicion (YYYY-MM-DD)
 *   - comercio: Nombre o razon social del establecimiento
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';

const CIF_REGEX = /\b([A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[TRWAGMYFPDXBNJZSQVHLCKE]|[XYZ]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE])\b/i;
const TOTAL_REGEX = /(?:total(?:\s+a\s+pagar|\s+factura|\s+ticket)?|importe\s+total|a\s+pagar)[\s:=]*([0-9]+[.,][0-9]{2})/i;
const BASE_REGEX = /(?:base(?:\s+imponible|\s+imp\.?)?|subtotal)[\s:=]*([0-9]+[.,][0-9]{2})/i;
const IVA_REGEX = /(?:cuota\s+iva|i\.?v\.?a\.?(?:\s*\(\d+%\))?)[\s:=]*([0-9]+[.,][0-9]{2})/i;
const IVA_PORCENTAJE_REGEX = /(?:iva|i\.?v\.?a\.?)\s*(\d+)%/i;
const FECHA_REGEX = /\b(\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})\b/;
const COMERCIO_REGEX = /(?:comercio|establecimiento|razon\s+social|empresa)[\s:=]*([^\n\r]+)/i;

/**
 * Normaliza una cadena numerica con coma o punto a float redondeado a 2 decimales.
 */
function parseMonto(str) {
  if (!str) return null;
  const normalizado = str.replace(',', '.');
  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Normaliza una fecha encontrada a formato YYYY-MM-DD.
 */
function parseFecha(str) {
  if (!str) return null;
  const limpio = str.replace(/[./]/g, '-');
  const partes = limpio.split('-');
  if (partes.length !== 3) return null;

  if (partes[0].length === 4) {
    // YYYY-MM-DD
    return `${partes[0]}-${partes[1].padStart(2, '0')}-${partes[2].padStart(2, '0')}`;
  }
  // DD-MM-YYYY
  return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
}

/**
 * Procesa una cadena de texto para extraer los campos estructurados del ticket.
 */
export function extraerCamposDeTexto(textoBruto) {
  if (!textoBruto || typeof textoBruto !== 'string') {
    return {
      cif: null,
      base: null,
      iva: null,
      total: null,
      fecha: null,
      comercio: null
    };
  }

  const texto = textoBruto.trim();

  // 1. CIF / NIF
  const matchCif = texto.match(CIF_REGEX);
  const cif = matchCif ? matchCif[1].toUpperCase() : null;

  // 2. Importe Total
  const matchTotal = texto.match(TOTAL_REGEX);
  let total = matchTotal ? parseMonto(matchTotal[1]) : null;

  // 3. Base Imponible
  const matchBase = texto.match(BASE_REGEX);
  let base = matchBase ? parseMonto(matchBase[1]) : null;

  // 4. IVA
  const matchIva = texto.match(IVA_REGEX);
  let iva = matchIva ? parseMonto(matchIva[1]) : null;

  // Reconciliacion matematica de importes
  if (total !== null && base !== null && iva === null) {
    iva = Math.round((total - base) * 100) / 100;
  } else if (total !== null && iva !== null && base === null) {
    base = Math.round((total - iva) * 100) / 100;
  } else if (base !== null && iva !== null && total === null) {
    total = Math.round((base + iva) * 100) / 100;
  } else if (total !== null && base === null && iva === null) {
    // Estimacion estandar de desglose IVA general al 21%
    base = Math.round((total / 1.21) * 100) / 100;
    iva = Math.round((total - base) * 100) / 100;
  }

  // 5. Fecha
  const matchFecha = texto.match(FECHA_REGEX);
  const fecha = matchFecha ? parseFecha(matchFecha[1]) : null;

  // 6. Comercio
  const matchComercio = texto.match(COMERCIO_REGEX);
  let comercio = null;
  if (matchComercio) {
    comercio = matchComercio[1].trim();
  } else {
    // Si no hay etiqueta explicita, toma la primera linea con texto
    const lineas = texto.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    if (lineas.length > 0 && !CIF_REGEX.test(lineas[0]) && !TOTAL_REGEX.test(lineas[0])) {
      comercio = lineas[0].slice(0, 80);
    }
  }

  return {
    cif,
    base,
    iva,
    total,
    fecha,
    comercio
  };
}

/**
 * Extrae datos estructurados de un ticket a partir de imagen, ruta o texto.
 */
export async function extraerTicketVision({
  imagen_base64,
  ruta_imagen,
  texto,
  ocrFn
} = {}) {
  let textoParaProcesar = '';

  if (texto && typeof texto === 'string' && texto.trim()) {
    textoParaProcesar = texto.trim();
  } else if (ruta_imagen && typeof ruta_imagen === 'string') {
    if (!fs.existsSync(ruta_imagen)) {
      throw new Error(`Archivo de imagen no encontrado: ${ruta_imagen}`);
    }
    const buf = fs.readFileSync(ruta_imagen);
    if (typeof ocrFn === 'function') {
      textoParaProcesar = await ocrFn(buf);
    } else {
      // Intenta decodificar como texto plano en entornos de prueba o fallback
      const posibleTexto = buf.toString('utf-8');
      if (CIF_REGEX.test(posibleTexto) || TOTAL_REGEX.test(posibleTexto)) {
        textoParaProcesar = posibleTexto;
      } else {
        throw new Error('Motor de vision local no configurado para archivo de imagen binario');
      }
    }
  } else if (imagen_base64 && typeof imagen_base64 === 'string') {
    const buf = Buffer.from(imagen_base64, 'base64');
    if (typeof ocrFn === 'function') {
      textoParaProcesar = await ocrFn(buf);
    } else {
      const posibleTexto = buf.toString('utf-8');
      if (CIF_REGEX.test(posibleTexto) || TOTAL_REGEX.test(posibleTexto)) {
        textoParaProcesar = posibleTexto;
      } else {
        throw new Error('Motor de vision local no configurado para imagen en base64');
      }
    }
  } else {
    throw new Error('Debe proporcionar al menos uno de: texto, ruta_imagen o imagen_base64');
  }

  const campos = extraerCamposDeTexto(textoParaProcesar);

  return {
    ok: true,
    cif: campos.cif,
    base: campos.base,
    iva: campos.iva,
    total: campos.total,
    fecha: campos.fecha,
    comercio: campos.comercio,
    texto_detectado: textoParaProcesar.slice(0, 1000)
  };
}
