/**
 * knowledgeGraphAutoExtractor.js - Extractor autonomo post-conversacion para Knowledge Graph
 *
 * Analiza de forma asincrona los turnos de conversacion (usuario y asistente),
 * extrae entidades y relaciones semanticas multidimensionales, y las persiste
 * con aislamiento estricto por tenant_id en SQLite o en memoria.
 *
 * Strict Policy: Zero Emojis.
 */

import { normalizarId, cargarGrafo, guardarGrafo, agregarNodo, agregarArista } from './graphMemoryService.js';
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
  },
  // Proyectos y Tecnologia
  {
    regex: /\b(?:trabajo|trabajando|desarrollo|programo)\s+en\s+(?:el\s+)?(?:proyecto|repo|repositorio|bot)\s+([A-Za-zÁ-ÿ0-9_\-\.]+)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: 'trabaja_en_proyecto',
      destino: m[1].trim(),
      tipoDestino: 'proyecto'
    })
  },
  {
    regex: /\b(?:el\s+)?(?:proyecto|repo|repositorio|bot)\s+([A-Za-zÁ-ÿ0-9_\-\.]+)\s+usa\s+([A-Za-zÁ-ÿ0-9_\-\.\s]+?)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: m[1].trim(),
      tipoOrigen: 'proyecto',
      relacion: 'usa_tecnologia',
      destino: m[2].trim(),
      tipoDestino: 'concepto'
    })
  },
  // Estudios, Examenes y Entregas
  {
    regex: /\b(?:estudio|cursando|tengo\s+la\s+asignatura)\s+([A-Za-zÁ-ÿ0-9\s\-]+?)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: 'estudia',
      destino: m[1].trim(),
      tipoDestino: 'concepto'
    })
  },
  {
    regex: /\b(?:el\s+)?(examen|entrega|practica)\s+de\s+([A-Za-zÁ-ÿ0-9\s\-]+?)\s+(?:es\s+el|el\s+dia)\s+([0-9]{1,2}\s+de\s+[A-Za-zÁ-ÿ]+|[0-9]{4}-[0-9]{2}-[0-9]{2})/gi,
    mapear: (m) => ({
      origen: m[2].trim(),
      tipoOrigen: 'concepto',
      relacion: `tiene_${m[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`,
      destino: m[3].trim(),
      tipoDestino: 'fecha'
    })
  },
  // Empleo y Candidaturas
  {
    regex: /\b(?:tengo\s+)?(?:una\s+)?(entrevista|candidatura|oferta)\s+(?:en|con|de)\s+([A-Za-zÁ-ÿ0-9_\-\.]+)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: `${m[1].toLowerCase()}_en`,
      destino: m[2].trim(),
      tipoDestino: 'concepto'
    })
  },
  // Suscripciones y Finanzas
  {
    regex: /\b(?:estoy\s+)?suscrito\s+a\s+([A-Za-zÁ-ÿ0-9_\-\.\s]+?)(?=[.,;]|\s+y\b|\s+pero\b|$)/gi,
    mapear: (m) => ({
      origen: 'usuario',
      tipoOrigen: 'persona',
      relacion: 'suscrito_a',
      destino: m[1].trim(),
      tipoDestino: 'gasto'
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
export function persistirTripletasEnGrafo(tripletas, { store = null, rutaArchivo = null, tenantId = TENANT_PROPIETARIO } = {}) {
  if (!Array.isArray(tripletas) || tripletas.length === 0) return 0;
  afirmarTenantId(tenantId);

  let guardadas = 0;
  if (store && typeof store.guardarRelacion === 'function') {
    for (const t of tripletas) {
      if (!t.origen?.id || !t.destino?.id || !t.relacion) continue;
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
    return guardadas;
  }

  if (rutaArchivo) {
    try {
      const grafo = cargarGrafo({ rutaArchivo });
      for (const t of tripletas) {
        if (!t.origen?.id || !t.destino?.id || !t.relacion) continue;
        agregarNodo(grafo, { id: t.origen.id, nombre: t.origen.nombre, tipo: t.origen.tipo });
        agregarNodo(grafo, { id: t.destino.id, nombre: t.destino.nombre, tipo: t.destino.tipo });
        agregarArista(grafo, {
          origen: t.origen.id,
          destino: t.destino.id,
          relacion: t.relacion,
          peso: t.peso || 1.0,
          metadata: t.metadata || {}
        });
        guardadas++;
      }
      if (guardadas > 0) {
        guardarGrafo(grafo, { rutaArchivo });
      }
    } catch (err) {
      console.warn('[KnowledgeGraphAutoExtractor] Fallo guardando en JSON:', err.message);
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
