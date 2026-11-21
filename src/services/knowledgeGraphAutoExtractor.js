/**
 * knowledgeGraphAutoExtractor.js - Extractor autonomo post-conversacion para Knowledge Graph
 *
 * Analiza de forma asincrona los turnos de conversacion (usuario y asistente),
 * extrae entidades y relaciones semanticas multidimensionales, y las persiste
 * con aislamiento estricto por tenant_id en SQLite o en memoria.
 *
 * Strict Policy: Zero Emojis.
 */

import { normalizarId } from './graphMemoryService.js';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../core/tenancy.js';

export const PATRONES_RELACION = Object.freeze([
  // Familia / Parentesco
  {
    regex: /\b(?:mi\s+)?(madre|mama|padre|papa|hermano|hermana|hijo|hija|abuelo|abuela|primo|prima|tio|tia|pareja|novio|novia|esposo|esposa|marido|mujer)\s+(?:se\s+llama|es)\s+([A-Za-zÁ-ÿ]+)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: normalizarRelacion(m[1]),
      destino: m[2],
      tipoDestino: 'persona'
    })
  },
  {
    regex: /\b([A-Za-zÁ-ÿ]+)\s+es\s+(?:mi\s+|el\s+|la\s+)?(madre|mama|padre|papa|hermano|hermana|hijo|hija|abuelo|abuela|primo|prima|tio|tia|pareja|novio|novia|esposo|esposa|marido|mujer|amigo|amiga|jefe|jefa)\b/gi,
    mapear: (m) => ({
      origen: m[1],
      tipoOrigen: 'persona',
      relacion: `es_${normalizarRelacion(m[2])}_de`,
      destino: 'usuario',
      tipoDestino: 'persona'
    })
  },
  // Trabajo y Profesion
  {
    regex: /\b([A-Za-zÁ-ÿ]+)\s+trabaja\s+en\s+([A-Za-zÁ-ÿ0-9\-]+)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: m[1],
      tipoOrigen: 'persona',
      relacion: 'trabaja_en',
      destino: m[2].trim(),
      tipoDestino: 'organizacion'
    })
  },
  {
    regex: /\b([A-Za-zÁ-ÿ]+)\s+es\s+(medico|medica|doctor|doctora|abogado|abogada|profesor|profesora|ingeniero|ingeniera|programador|programadora|disenador|disenadora|camarero|camarera|arquitecto|arquitecta|dentista|veterinario|veterinaria)\b/gi,
    mapear: (m) => ({
      origen: m[1],
      tipoOrigen: 'persona',
      relacion: 'tiene_profesion',
      destino: m[2].toLowerCase(),
      tipoDestino: 'concepto'
    })
  },
  // Residencia y Localizacion
  {
    regex: /\b([A-Za-zÁ-ÿ]+)\s+vive\s+en\s+([A-Za-zÁ-ÿ]+)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: m[1],
      tipoOrigen: 'persona',
      relacion: 'vive_en',
      destino: m[2].trim(),
      tipoDestino: 'lugar'
    })
  },
  {
    regex: /\b(?:viaj(?:o|ar|amos|a|e)(?:\s+a)?|vuelo\s+a)\s+([A-Za-zÁ-ÿ]+)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: 'viaja_a',
      destino: m[1].trim(),
      tipoDestino: 'lugar'
    })
  },
  // Gustos y Preferencias
  {
    regex: /\b(?:a\s+([A-Za-zÁ-ÿ]+)\s+)?le\s+gusta\s+([A-Za-zÁ-ÿ0-9\s\-]+?)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: m[1] || 'usuario',
      tipoOrigen: 'persona',
      relacion: 'interesado_en',
      destino: m[2].trim(),
      tipoDestino: 'concepto'
    })
  },
  // Contacto y Telefono
  {
    regex: /\b(?:el\s+)?telefono\s+de\s+([A-Za-zÁ-ÿ]+)\s+es\s+(\+?[0-9\s\-]{8,20})/gi,
    mapear: (m) => ({
      origen: m[1],
      tipoOrigen: 'persona',
      relacion: 'tiene_telefono',
      destino: m[2].replace(/\s+/g, ''),
      tipoDestino: 'concepto'
    })
  }
]);

function normalizarRelacion(texto) {
  if (!texto) return 'relacionado_con';
  const t = texto.toLowerCase().trim();
  if (t === 'mama' || t === 'madre') return 'madre';
  if (t === 'papa' || t === 'padre') return 'padre';
  return t;
}

/**
 * Extrae entidades y relaciones semanticas de un texto conversacional.
 *
 * @param {string} texto
 * @param {object} [opciones]
 * @returns {Array<object>}
 */
export function extraerRelacionesDeTexto(texto, { sujetoDefecto = 'usuario' } = {}) {
  if (!texto || typeof texto !== 'string') return [];
  const tripletas = [];

  for (const regla of PATRONES_RELACION) {
    const matches = Array.from(texto.matchAll(new RegExp(regla.regex.source, regla.regex.flags)));
    for (const match of matches) {
      try {
        const t = regla.mapear(match);
        if (t && t.origen && t.destino && t.relacion) {
          if (t.origen === 'usuario' && sujetoDefecto !== 'usuario') {
            t.origen = sujetoDefecto;
          }
          tripletas.push({
            origen: {
              id: normalizarId(t.origen),
              nombre: t.origen,
              tipo: t.tipoOrigen || 'persona'
            },
            relacion: t.relacion,
            destino: {
              id: normalizarId(t.destino),
              nombre: t.destino,
              tipo: t.tipoDestino || 'concepto'
            },
            peso: 1.0,
            metadata: { origenTexto: match[0] }
          });
        }
      } catch {
        // Ignorar fallo de mapeo puntual
      }
    }
  }

  return tripletas;
}

/**
 * Persiste las tripletas extraidas en el store de Knowledge Graph (SQLite o fallback).
 *
 * @param {Array<object>} tripletas
 * @param {object} [deps]
 * @returns {number} cantidad de relaciones guardadas
 */
export function persistirTripletasEnGrafo(tripletas, { store = null, tenantId = TENANT_PROPIETARIO } = {}) {
  if (!Array.isArray(tripletas) || tripletas.length === 0) return 0;
  afirmarTenantId(tenantId);

  let guardadas = 0;
  for (const t of tripletas) {
    if (!t.origen?.id || !t.destino?.id || !t.relacion) continue;

    if (store && typeof store.guardarRelacion === 'function') {
      try {
        store.guardarEntidad({
          id: t.origen.id,
          nombre: t.origen.nombre,
          tipo: t.origen.tipo
        }, tenantId);

        store.guardarEntidad({
          id: t.destino.id,
          nombre: t.destino.nombre,
          tipo: t.destino.tipo
        }, tenantId);

        store.guardarRelacion({
          origen: t.origen.id,
          destino: t.destino.id,
          relacion: t.relacion,
          peso: t.peso || 1.0,
          metadata: t.metadata || {}
        }, tenantId);

        guardadas++;
      } catch (err) {
        console.warn('[KnowledgeGraphAutoExtractor] Fallo guardando en store SQLite:', err.message);
      }
    }
  }

  return guardadas;
}

/**
 * Analiza un turno conversacional completo y extrae conocimiento relacional.
 *
 * @param {string} textoUsuario
 * @param {string} [respuestaAsistente]
 * @param {object} [deps]
 * @returns {Promise<{ ok: boolean, tripletas: Array<object>, guardadas: number }>}
 */
export async function procesarTurnoConversacionParaGrafo(textoUsuario, respuestaAsistente = '', deps = {}) {
  try {
    const tripletasUsuario = extraerRelacionesDeTexto(textoUsuario, deps);
    const tripletasAsistente = extraerRelacionesDeTexto(respuestaAsistente, deps);
    const todas = [...tripletasUsuario, ...tripletasAsistente];

    if (todas.length === 0) {
      return { ok: true, tripletas: [], guardadas: 0 };
    }

    const guardadas = persistirTripletasEnGrafo(todas, deps);
    return { ok: true, tripletas: todas, guardadas };
  } catch (err) {
    console.warn('[KnowledgeGraphAutoExtractor] Error en extraccion de turno:', err.message);
    return { ok: false, error: err.message, tripletas: [], guardadas: 0 };
  }
}

/**
 * Disparador no bloqueante (fire-and-forget) para no demorar la respuesta de chat.
 *
 * @param {string} textoUsuario
 * @param {string} respuestaAsistente
 * @param {object} deps
 */
export function dispararExtraccionGrafoAsincrona(textoUsuario, respuestaAsistente, deps = {}) {
  setImmediate(() => {
    procesarTurnoConversacionParaGrafo(textoUsuario, respuestaAsistente, deps).catch((err) => {
      console.warn('[KnowledgeGraphAutoExtractor] Excepcion en tarea asincrona:', err.message);
    });
  });
}
