/**
 * visionService.js - Servicio Multimodal para D.A.V.I.S.
 * Permite la interpretacion de imagenes, capturas de pantalla de terminales/errores,
 * tickets y extraccion de texto de documentos PDF.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extraerTextoPDF } from './pdfReaderService.js';

export function getVisionApiKey(deps = {}) {
  if (deps.apiKey !== undefined) return deps.apiKey;
  return process.env.VISION_API_KEY || process.env.GROQ_API_KEY || null;
}

export function getVisionBaseUrl(deps = {}) {
  return deps.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1';
}

export function getVisionModel(deps = {}) {
  return deps.model || process.env.VISION_MODEL || 'llama-3.2-11b-vision-preview';
}

/**
 * Convierte un buffer o archivo a base64 Data URI
 */
export function imagenABase64DataUri(bufferOPath, mimeType = 'image/jpeg') {
  let buf;
  if (Buffer.isBuffer(bufferOPath)) {
    buf = bufferOPath;
  } else if (typeof bufferOPath === 'string' && fs.existsSync(bufferOPath)) {
    buf = fs.readFileSync(bufferOPath);
    if (bufferOPath.endsWith('.png')) mimeType = 'image/png';
    else if (bufferOPath.endsWith('.webp')) mimeType = 'image/webp';
  } else {
    throw new Error('Entrada invalida para conversion a base64');
  }
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

/**
 * Analiza una imagen (captura de terminal, error de codigo, esquema o foto) con modelo de vision.
 */
export async function analizarImagen({ bufferOPath, prompt, mimeType } = {}, deps = {}) {
  const p = String(prompt || 'Describe y analiza esta imagen tecnicamente, extrayendo cualquier error o texto relevante. Responde en espanol, sin emojis.').trim();
  const apiKey = getVisionApiKey(deps);

  if (!apiKey) {
    return {
      ok: false,
      error: 'Requiere OPENAI_API_KEY o GROQ_API_KEY configurada para vision multimodal.'
    };
  }

  let dataUri;
  try {
    dataUri = imagenABase64DataUri(bufferOPath, mimeType);
  } catch (err) {
    return { ok: false, error: `Error procesando buffer de imagen: ${err.message}` };
  }

  const baseUrl = getVisionBaseUrl(deps);
  const model = getVisionModel(deps);
  const fetchFn = deps.fetchFn || globalThis.fetch;

  try {
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'DAVIS-Vision-Agent'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Eres D.A.V.I.S., asistente tactico de inteligencia. Analiza la imagen con precision tecnica. Si es un error de codigo o consola, explica la causa exacta y la solucion directa. En espanol, tono sobrio, estrictamente sin emojis.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: p },
              { type: 'image_url', image_url: { url: dataUri } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 1500
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    }

    const analisis = data.choices?.[0]?.message?.content?.trim() || '';
    return {
      ok: true,
      analisis,
      modelo: model
    };
  } catch (err) {
    return { ok: false, error: `Fallo en el servicio de vision: ${err.message}` };
  }
}

/**
 * Procesa un documento PDF recibido, extrayendo su texto estructurado y generando resumen o respuestas.
 */
export async function procesarDocumentoPDF({ bufferOPath, pregunta } = {}, deps = {}) {
  try {
    const texto = extraerTextoPDF(bufferOPath);
    if (!texto || texto.length < 20) {
      return { ok: false, error: 'No se pudo extraer texto legible del documento PDF.' };
    }

    if (pregunta) {
      const { consultarSeccionPDF } = await import('./pdfReaderService.js');
      const resultado = consultarSeccionPDF(pregunta, texto);
      return {
        ok: true,
        tipo: 'consulta',
        pregunta,
        respuesta: resultado.answer,
        longitudTexto: texto.length
      };
    }

    const { resumirDocumento } = await import('./pdfReaderService.js');
    const resumen = resumirDocumento(texto);
    return {
      ok: true,
      tipo: 'resumen',
      resumen,
      longitudTexto: texto.length
    };
  } catch (err) {
    return { ok: false, error: `Error procesando archivo PDF: ${err.message}` };
  }
}
