/**
 * contactRelationResolver.js - Resolutor Semantico de Contactos y Parentescos
 *
 * Resuelve destinatarios ambiguos o indirectos ("mi madre", "mama", "mi hermano",
 * "mi pareja") enlazando:
 * 1. Coincidencia directa por nombre en la agenda de contactos.
 * 2. Campo 'relacion' explicito en fichas de contactos (SQLite y JSON).
 * 3. Grafo de conocimiento (Knowledge Graph SQLite 'knowledge_graph_relaciones').
 * 4. Memorias persistidas en el Second Brain (SQLite y brain_memory.json).
 *
 * Evita fallos de suplantacion o asignacion erronea (p. ej. escribir a Paula
 * cuando se pidio escribir a la madre).
 *
 * Strict Policy: Zero Emojis.
 */

import { listarContactos, buscarContacto } from './contactsService.js';
import { TENANT_PROPIETARIO, afirmarTenantId } from '../core/tenancy.js';
import { normalizarId } from './graphMemoryService.js';

export const MAPA_PARENTESCOS = Object.freeze({
  mama: 'madre',
  mami: 'madre',
  madre: 'madre',
  papa: 'padre',
  papi: 'padre',
  padre: 'padre',
  hermano: 'hermano',
  hermana: 'hermana',
  abuelo: 'abuelo',
  abuelito: 'abuelo',
  abuela: 'abuela',
  abuelita: 'abuela',
  tio: 'tio',
  tito: 'tio',
  tia: 'tia',
  tita: 'tia',
  primo: 'primo',
  prima: 'prima',
  hijo: 'hijo',
  hija: 'hija',
  novio: 'novio',
  novia: 'novia',
  pareja: 'pareja',
  esposo: 'marido',
  marido: 'marido',
  esposa: 'mujer',
  mujer: 'mujer'
});

/**
 * Normaliza un termino de busqueda eliminando posesivos y mapeando sinonimos de parentesco.
 *
 * @param {string} termino
 * @returns {{ limpio: string, parentesco: string|null }}
 */
export function normalizarTerminoBusqueda(termino) {
  if (!termino || typeof termino !== 'string') {
    return { limpio: '', parentesco: null };
  }

  let str = termino
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Eliminar prefijos comunes en peticiones ("a mi madre", "para mi madre", "de mi madre")
  str = str.replace(/^(?:a|para|de|con|hacia)\s+/i, '');
  // Eliminar posesivos ("mi madre", "mi mama", "mis padres")
  str = str.replace(/^(?:mi|mis|el|la|los|las)\s+/i, '').trim();

  const parentescoCanonica = MAPA_PARENTESCOS[str] || null;

  return {
    limpio: str,
    parentesco: parentescoCanonica
  };
}

/**
 * Busca relaciones en el Knowledge Graph SQLite o en memoria.
 *
 * @param {string} parentesco
 * @param {object} deps
 * @returns {Array<string>} Nombres de personas encontradas
 */
export function buscarNombresEnGrafo(parentesco, deps = {}) {
  if (!parentesco) return [];
  const tenantId = deps.tenantId || TENANT_PROPIETARIO;
  const store = deps.knowledgeGraphStore || deps.store;

  const nombres = new Set();
  const relBuscada = parentesco.toLowerCase();

  if (store && typeof store.obtenerGrafo === 'function') {
    try {
      const grafo = store.obtenerGrafo(tenantId);
      const aristas = Array.isArray(grafo.aristas) ? grafo.aristas : [];
      const nodos = grafo.nodos || {};

      for (const a of aristas) {
        const oId = normalizarId(a.origen);
        const dId = normalizarId(a.destino);
        const rel = String(a.relacion || '').toLowerCase();

        // Caso 1: usuario -> madre -> Carmen
        if ((oId === 'usuario' || oId === 'david') && (rel === relBuscada || rel.includes(relBuscada))) {
          const nodoDestino = nodos[dId];
          const nombre = nodoDestino?.nombre || a.destino;
          if (nombre && nombre !== 'usuario' && nombre !== 'david') {
            nombres.add(nombre);
          }
        }

        // Caso 2: Carmen -> es_madre_de -> usuario
        if ((dId === 'usuario' || dId === 'david') && (rel === `es_${relBuscada}_de` || rel.includes(relBuscada))) {
          const nodoOrigen = nodos[oId];
          const nombre = nodoOrigen?.nombre || a.origen;
          if (nombre && nombre !== 'usuario' && nombre !== 'david') {
            nombres.add(nombre);
          }
        }
      }
    } catch (errGrafo) {
      console.warn('[ContactRelationResolver] Error consultando knowledge graph:', errGrafo.message);
    }
  }

  return Array.from(nombres);
}

/**
 * Busca parentescos en las memorias del Second Brain.
 *
 * @param {string} parentesco
 * @param {object} deps
 * @returns {Array<string>}
 */
export function buscarNombresEnMemorias(parentesco, deps = {}) {
  if (!parentesco) return [];
  const nombres = new Set();
  const relBuscada = parentesco.toLowerCase();

  let memorias = [];
  const memoryStore = deps.memoryStore || deps.storeMemorias;

  if (memoryStore) {
    try {
      if (typeof memoryStore.leer === 'function') {
        memorias = memoryStore.leer(deps.tenantId);
      } else if (typeof memoryStore.listar === 'function') {
        memorias = memoryStore.listar(deps.tenantId);
      }
    } catch {}
  }

  if (Array.isArray(memorias)) {
    const rx1 = new RegExp(`\\b(?:mi\\s+)?(?:${relBuscada}|mama|papa)\\s+(?:se\\s+llama|es)\\s+([A-Za-zÁ-ÿ]+)`, 'i');
    const rx2 = new RegExp(`\\b([A-Za-zÁ-ÿ]+)\\s+es\\s+(?:mi\\s+)?(?:${relBuscada}|mama|papa)`, 'i');

    for (const m of memorias) {
      const texto = `${m.sujeto || ''} ${m.dato || ''} ${m.contenido || ''}`;
      const m1 = texto.match(rx1);
      if (m1 && m1[1]) nombres.add(m1[1]);
      const m2 = texto.match(rx2);
      if (m2 && m2[1]) nombres.add(m2[1]);
    }
  }

  return Array.from(nombres);
}

/**
 * Resuelve de forma inteligente un destinatario a su ficha de contacto verificada.
 *
 * @param {string} termino - Nombre, parentesco o frase (ej. "mi madre", "Paula", "Carmen")
 * @param {object} [deps]
 * @returns {{ ok: boolean, contacto?: object, telefono?: string, nombre?: string, origen?: string, error?: string }}
 */
export function resolverContactoInteligente(termino, deps = {}) {
  if (!termino || typeof termino !== 'string' || !termino.trim()) {
    return { ok: false, error: 'Termino de busqueda no proporcionado' };
  }

  const raw = termino.trim();
  const { limpio, parentesco } = normalizarTerminoBusqueda(raw);

  const contactos = listarContactos(deps);
  if (!Array.isArray(contactos) || contactos.length === 0) {
    return { ok: false, error: 'No hay contactos registrados en la agenda' };
  }

  // 1. Coincidencia por nombre exacto en contactos (ej. "Paula")
  const exactosPorNombre = contactos.filter(
    (c) => c.nombre && c.nombre.trim().toLowerCase() === limpio
  );
  if (exactosPorNombre.length === 1 && !parentesco) {
    const ct = exactosPorNombre[0];
    return {
      ok: true,
      contacto: ct,
      telefono: ct.telefono || null,
      nombre: ct.nombre,
      origen: 'contacto_nombre_exacto'
    };
  }

  // 2. Si el termino indica un parentesco (ej. "madre", "mi madre", "mama", "hermano")
  if (parentesco) {
    // 2a. Buscar en el campo 'relacion' explicito de las fichas de contacto
    const porRelacionContacto = contactos.filter((c) => {
      const rel = (c.relacion || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return rel === parentesco || rel.includes(parentesco);
    });

    if (porRelacionContacto.length === 1) {
      const ct = porRelacionContacto[0];
      return {
        ok: true,
        contacto: ct,
        telefono: ct.telefono || null,
        nombre: ct.nombre,
        origen: 'contacto_campo_relacion'
      };
    }

    if (porRelacionContacto.length > 1) {
      return {
        ok: false,
        error: `Hay ${porRelacionContacto.length} contactos registrados con relacion "${parentesco}". Especifica el nombre de la persona.`
      };
    }

    // 2b. Buscar en Knowledge Graph SQLite (relaciones semanticas)
    const nombresGrafo = buscarNombresEnGrafo(parentesco, deps);
    for (const nombrePersona of nombresGrafo) {
      const nNorm = nombrePersona.toLowerCase();
      const candidato = contactos.find(
        (c) => c.nombre && (c.nombre.toLowerCase() === nNorm || c.nombre.toLowerCase().includes(nNorm))
      );
      if (candidato) {
        return {
          ok: true,
          contacto: candidato,
          telefono: candidato.telefono || null,
          nombre: candidato.nombre,
          origen: 'knowledge_graph'
        };
      }
    }

    // 2c. Buscar en Memorias del Second Brain
    const nombresMemorias = buscarNombresEnMemorias(parentesco, deps);
    for (const nombrePersona of nombresMemorias) {
      const nNorm = nombrePersona.toLowerCase();
      const candidato = contactos.find(
        (c) => c.nombre && (c.nombre.toLowerCase() === nNorm || c.nombre.toLowerCase().includes(nNorm))
      );
      if (candidato) {
        return {
          ok: true,
          contacto: candidato,
          telefono: candidato.telefono || null,
          nombre: candidato.nombre,
          origen: 'second_brain_memory'
        };
      }
    }

    // Si es parentesco y no se encontro ninguna asociacion valida, NO asignar a otro contacto arbitrario
    return {
      ok: false,
      error: `No tienes ningun contacto registrado como tu "${parentesco}". Por favor, indica su nombre o registra el contacto primero.`
    };
  }

  // 3. Coincidencia parcial por nombre (solo si no era parentesco)
  const parciales = contactos.filter(
    (c) => c.nombre && c.nombre.toLowerCase().includes(limpio)
  );

  if (parciales.length === 1) {
    const ct = parciales[0];
    return {
      ok: true,
      contacto: ct,
      telefono: ct.telefono || null,
      nombre: ct.nombre,
      origen: 'contacto_nombre_parcial'
    };
  }

  if (parciales.length > 1) {
    return {
      ok: false,
      error: `Varios contactos coinciden con "${raw}": ${parciales.map((c) => c.nombre).join(', ')}. Especifica el nombre exacto.`
    };
  }

  return {
    ok: false,
    error: `No se encontro ningun contacto que coincida con "${raw}".`
  };
}
