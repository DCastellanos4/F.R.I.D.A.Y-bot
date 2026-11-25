/**
 * graphMemoryService.js - Motor de Grafo de Conocimiento y Entity Linking
 *
 * Mapea relaciones semanticas multidimensionales entre entidades
 * (Personas, Lugares, Fechas, Gastos, Tareas, Proyectos) para enriquecer
 * la toma de decisiones del asistente D.A.V.I.S.
 *
 * Strict Policy: Zero Emojis en todo el codigo, logs y representaciones.
 */

import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const TIPOS_ENTIDAD = Object.freeze([
  'persona',
  'lugar',
  'fecha',
  'gasto',
  'tarea',
  'proyecto',
  'concepto'
]);

function rutaGrafo(deps = {}) {
  return deps.rutaArchivo || path.join(deps.dataDir || DATA_DIR, 'knowledge_graph.json');
}

/**
 * Normaliza nombres o identificadores de entidad.
 */
export function normalizarId(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();
}

/**
 * Carga el grafo desde disco o inicializa uno vacio.
 */
export function cargarGrafo(deps = {}) {
  const ruta = rutaGrafo(deps);
  try {
    if (!fs.existsSync(ruta)) {
      return { nodos: {}, aristas: [] };
    }
    const raw = fs.readFileSync(ruta, 'utf-8');
    const data = JSON.parse(raw);
    return {
      nodos: data && typeof data.nodos === 'object' ? data.nodos : {},
      aristas: Array.isArray(data && data.aristas) ? data.aristas : []
    };
  } catch {
    return { nodos: {}, aristas: [] };
  }
}

/**
 * Guarda el grafo en disco con escritura atomica.
 */
export function guardarGrafo(grafo, deps = {}) {
  const ruta = rutaGrafo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(grafo, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

/**
 * Agrega o actualiza un nodo en el grafo.
 */
export function agregarNodo(grafo, { id, nombre, tipo = 'concepto', metadata = {} }) {
  const idNorm = normalizarId(id || nombre);
  if (!idNorm) return null;
  const existente = grafo.nodos[idNorm] || {};
  grafo.nodos[idNorm] = {
    id: idNorm,
    nombre: nombre || existente.nombre || idNorm,
    tipo: TIPOS_ENTIDAD.includes(tipo) ? tipo : 'concepto',
    metadata: { ...existente.metadata, ...metadata },
    actualizadoEn: new Date().toISOString()
  };
  return grafo.nodos[idNorm];
}

/**
 * Agrega una arista dirigida entre dos nodos.
 */
export function agregarArista(grafo, { origen, destino, relacion, peso = 1.0, metadata = {} }) {
  const oNorm = normalizarId(origen);
  const dNorm = normalizarId(destino);
  const relNorm = String(relacion || 'relacionado_con').trim().toLowerCase();
  if (!oNorm || !dNorm || oNorm === dNorm) return null;

  // Asegurar que existen ambos nodos
  if (!grafo.nodos[oNorm]) agregarNodo(grafo, { id: oNorm, nombre: origen, tipo: 'concepto' });
  if (!grafo.nodos[dNorm]) agregarNodo(grafo, { id: dNorm, nombre: destino, tipo: 'concepto' });

  // Buscar arista existente
  const idx = grafo.aristas.findIndex(
    (a) => a.origen === oNorm && a.destino === dNorm && a.relacion === relNorm
  );

  const arista = {
    id: crypto.randomBytes(6).toString('hex'),
    origen: oNorm,
    destino: dNorm,
    relacion: relNorm,
    peso: Number(peso) || 1.0,
    metadata,
    actualizadoEn: new Date().toISOString()
  };

  if (idx >= 0) {
    grafo.aristas[idx] = { ...grafo.aristas[idx], ...arista, peso: grafo.aristas[idx].peso + 0.1 };
  } else {
    grafo.aristas.push(arista);
  }
  return arista;
}

/**
 * Extrae entidades heurísticas a partir de un texto en lenguaje natural.
 */
export function extraerEntidadesDeTexto(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const entidades = [];
  const t = texto.toLowerCase();

  // Patrones de Personas conocidas / familiares
  const personas = ['david', 'mama', 'papa', 'hermano', 'ana', 'carlos', 'lucia', 'jefe'];
  for (const p of personas) {
    const rx = new RegExp(`\\b${p}\\b`, 'i');
    if (rx.test(t)) {
      entidades.push({ nombre: p, tipo: 'persona' });
    }
  }

  // Patrones de Lugares
  const lugares = ['madrid', 'aranjuez', 'atocha', 'chamartin', 'oficina', 'casa', 'hospital', 'zaragoza'];
  for (const lug of lugares) {
    const rx = new RegExp(`\\b${lug}\\b`, 'i');
    if (rx.test(t)) {
      entidades.push({ nombre: lug, tipo: 'lugar' });
    }
  }

  // Patrones de Gastos
  const matchGasto = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:euros?|eur|€)/i);
  if (matchGasto) {
    entidades.push({
      nombre: `gasto_${matchGasto[1].replace(',', '.')}_eur`,
      tipo: 'gasto',
      metadata: { cantidad: parseFloat(matchGasto[1].replace(',', '.')) }
    });
  }

  // Patrones de Fechas relativas o expresas
  const fechas = ['hoy', 'manana', 'ayer', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  for (const f of fechas) {
    const rx = new RegExp(`\\b${f}\\b`, 'i');
    if (rx.test(t)) {
      entidades.push({ nombre: f, tipo: 'fecha' });
    }
  }

  return entidades;
}

/**
 * Busca las conexiones y vecindario de una entidad hasta maxProfundidad saltos.
 */
export function buscarVecindadGrafo(grafo, entidadId, maxProfundidad = 2) {
  const inicioNorm = normalizarId(entidadId);
  if (!inicioNorm || !grafo.nodos[inicioNorm]) return { entidad: null, conexiones: [] };

  const visitados = new Set([inicioNorm]);
  const frontera = [{ id: inicioNorm, nivel: 0 }];
  const conexiones = [];

  while (frontera.length > 0) {
    const actual = frontera.shift();
    if (actual.nivel >= maxProfundidad) continue;

    for (const arista of grafo.aristas) {
      if (arista.origen === actual.id && !visitados.has(arista.destino)) {
        visitados.add(arista.destino);
        frontera.push({ id: arista.destino, nivel: actual.nivel + 1 });
        conexiones.push({
          direccion: 'saliente',
          desde: grafo.nodos[arista.origen],
          hacia: grafo.nodos[arista.destino],
          relacion: arista.relacion,
          peso: arista.peso
        });
      } else if (arista.destino === actual.id && !visitados.has(arista.origen)) {
        visitados.add(arista.origen);
        frontera.push({ id: arista.origen, nivel: actual.nivel + 1 });
        conexiones.push({
          direccion: 'entrante',
          desde: grafo.nodos[arista.origen],
          hacia: grafo.nodos[arista.destino],
          relacion: arista.relacion,
          peso: arista.peso
        });
      }
    }
  }

  return {
    entidad: grafo.nodos[inicioNorm],
    conexiones
  };
}

let storeGrafoPorDefecto = null;

export function registrarStoreGrafoPorDefecto(store) {
  storeGrafoPorDefecto = store || null;
}

export function registrarStoreKnowledgeGraphPorDefecto(store) {
  storeGrafoPorDefecto = store || null;
}

export function obtenerStoreGrafoPorDefecto() {
  return storeGrafoPorDefecto;
}

/**
 * Recupera un subgrafo contextual acotado hasta `maxHops` saltos combinando
 * entidades heuristicas del texto y coincidencia directa con nodos existentes.
 */
export function recuperarSubgrafoContextual(consulta, deps = {}) {
  if (!consulta || typeof consulta !== 'string') {
    return { texto: '', conexiones: [] };
  }

  const store = deps.knowledgeGraphStore || deps.store || storeGrafoPorDefecto;
  const tenantId = deps.tenantId || 'propietario';
  const maxHops = Number.isInteger(deps.maxHops) && deps.maxHops > 0 ? deps.maxHops : 2;
  const maxAristas = Number.isInteger(deps.maxAristas) && deps.maxAristas > 0 ? deps.maxAristas : 15;

  let grafo = null;
  if (store && typeof store.obtenerGrafo === 'function' && !deps.rutaArchivo) {
    try {
      grafo = store.obtenerGrafo(tenantId);
    } catch {
      grafo = null;
    }
  } else if (deps.rutaArchivo || process.env.NODE_ENV !== 'test' || process.env.DAVIS_DATA_DIR) {
    grafo = cargarGrafo(deps);
  }

  // Fallback si solo hay store con buscarVecinos sin obtenerGrafo
  if (!grafo && store && typeof store.buscarVecinos === 'function' && !deps.rutaArchivo) {
    const entidades = extraerEntidadesDeTexto(consulta);
    if (entidades.length === 0) return { texto: '', conexiones: [] };

    const lineas = [];
    const conexiones = [];
    const aristasVistas = new Set();
    const entidadesProcesadas = new Set();

    for (const ent of entidades) {
      const idNorm = normalizarId(ent.nombre);
      if (!idNorm || entidadesProcesadas.has(idNorm)) continue;
      entidadesProcesadas.add(idNorm);

      const vecindad = store.buscarVecinos(idNorm, maxHops, tenantId);
      if (vecindad && Array.isArray(vecindad.conexiones)) {
        for (const con of vecindad.conexiones) {
          if (lineas.length >= maxAristas) break;
          const clave = `${con.desde.id}|${con.relacion}|${con.hacia.id}`;
          if (aristasVistas.has(clave)) continue;
          aristasVistas.add(clave);
          conexiones.push(con);
          if (con.direccion === 'saliente') {
            lineas.push(`- Entidad [${con.desde.nombre}] -> (${con.relacion}) -> [${con.hacia.nombre}] (${con.hacia.tipo})`);
          } else {
            lineas.push(`- Entidad [${con.hacia.nombre}] <- (${con.relacion}) <- [${con.desde.nombre}] (${con.desde.tipo})`);
          }
        }
      }
    }

    return {
      texto: lineas.length > 0 ? `Conocimiento Relacional en Grafo:\n${lineas.join('\n')}` : '',
      conexiones
    };
  }

  if (!grafo || !grafo.nodos || Object.keys(grafo.nodos).length === 0) {
    return { texto: '', conexiones: [] };
  }

  const seeds = new Set();
  for (const ent of extraerEntidadesDeTexto(consulta)) {
    const idNorm = normalizarId(ent.nombre);
    if (idNorm && grafo.nodos[idNorm]) seeds.add(idNorm);
  }

  const consultaNorm = consulta
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_\-\s]/g, ' ');
  const tokensConsulta = new Set(consultaNorm.split(/\s+/).filter((w) => w.length >= 3));

  for (const nodo of Object.values(grafo.nodos)) {
    const idStr = String(nodo.id || '');
    const nombreNorm = normalizarId(nodo.nombre || idStr);
    if (idStr.length >= 3 && (tokensConsulta.has(idStr) || tokensConsulta.has(nombreNorm))) {
      seeds.add(idStr);
    } else if (nombreNorm.includes('_')) {
      const frase = nombreNorm.replace(/_/g, ' ');
      if (frase.length >= 5 && consultaNorm.includes(frase)) {
        seeds.add(idStr);
      }
    }
  }

  if (seeds.size === 0 && grafo.nodos.usuario && /\b(mi|mis|tengo|estudio|trabajo|candidatura|entrevista|suscrito)\b/i.test(consultaNorm)) {
    seeds.add('usuario');
  }

  if (seeds.size === 0) return { texto: '', conexiones: [] };

  const lineas = [];
  const conexiones = [];
  const aristasVistas = new Set();

  for (const seedId of seeds) {
    if (lineas.length >= maxAristas) break;
    const vecindad = buscarVecindadGrafo(grafo, seedId, maxHops);
    for (const con of vecindad.conexiones) {
      if (lineas.length >= maxAristas) break;
      const clave = `${con.desde.id}|${con.relacion}|${con.hacia.id}`;
      if (aristasVistas.has(clave)) continue;
      aristasVistas.add(clave);
      conexiones.push(con);
      if (con.direccion === 'saliente') {
        lineas.push(`- Entidad [${con.desde.nombre}] -> (${con.relacion}) -> [${con.hacia.nombre}] (${con.hacia.tipo})`);
      } else {
        lineas.push(`- Entidad [${con.hacia.nombre}] <- (${con.relacion}) <- [${con.desde.nombre}] (${con.desde.tipo})`);
      }
    }
  }

  return {
    texto: lineas.length > 0 ? `Conocimiento Relacional en Grafo:\n${lineas.join('\n')}` : '',
    conexiones
  };
}

/**
 * Extrae entidades de una consulta y devuelve un resumen contextual para inyectar al LLM.
 */
export function obtenerContextoGrafo(consulta, deps = {}) {
  return recuperarSubgrafoContextual(consulta, deps).texto;
}
