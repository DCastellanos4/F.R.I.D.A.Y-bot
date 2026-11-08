import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DATA_DIR } from '../config/paths.js';
import { invalidarIndiceSemantico } from './semanticMemoryService.js';

// ---------------------------------------------------------------------------
// Costura de persistencia: por defecto se usan los ficheros JSON historicos.
// La raiz de composicion puede registrar un store por defecto (p.ej. SQLite)
// que usan todas las llamadas sin deps explicitas. Una rutaArchivo explicita
// siempre gana al store por defecto (aislamiento de pruebas), y un store
// explicito en deps gana a ambos. Un store puede exponer transaccion(fn):
// las operaciones de leer-modificar-escribir se ejecutan dentro, de modo que
// la lectura y la escritura son atomicas entre escritores concurrentes.
// ---------------------------------------------------------------------------
let storeMemoriasPorDefecto = null;

export function registrarStoreMemoriasPorDefecto(store) {
  storeMemoriasPorDefecto = store || null;
}

function storeDe(deps = {}) {
  if (deps.store) return deps.store;
  if (deps.rutaArchivo) return null; // ruta explicita: fichero JSON
  return storeMemoriasPorDefecto;
}

function transaccionar(deps, fn) {
  const store = deps && deps.store;
  if (store && typeof store.transaccion === 'function') return store.transaccion(fn);
  return fn();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = process.env.DAVIS_DATA_DIR || DATA_DIR;
const ARCHIVO_MEMORIA = path.join(CARPETA_DATA, 'brain_memory.json');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

// ---------------------------------------------------------------------------
// Cifrado en reposo para la categoria "clave" (AES-256-GCM, clave scrypt)
// Las memorias de credenciales se guardan cifradas; las antiguas en texto
// plano siguen leyendose igual (compatibilidad con datos existentes).
// ---------------------------------------------------------------------------
const FORMATO_CIFRADO = 'aes-256-gcm';

// La clave de cifrado de memorias es exclusiva de este servicio: no reutiliza
// la passphrase de las copias de seguridad (BACKUP_PASSPHRASE), que tiene un
// alcance distinto.
function obtenerClaveCifrado(salt) {
  const pass = process.env.MEMORY_ENCRYPTION_KEY || '';
  if (!pass) return null;
  return crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function cifrarDato(dato) {
  const salt = crypto.randomBytes(16);
  const key = obtenerClaveCifrado(salt);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(FORMATO_CIFRADO, key, iv);
  const enc = Buffer.concat([cipher.update(dato, 'utf-8'), cipher.final()]);
  return {
    cifrado: FORMATO_CIFRADO,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    dato: enc.toString('base64')
  };
}

function descifrarDato(m) {
  try {
    const key = obtenerClaveCifrado(Buffer.from(m.salt, 'base64'));
    if (!key) return null;
    const decipher = crypto.createDecipheriv(FORMATO_CIFRADO, key, Buffer.from(m.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(m.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(m.dato, 'base64')), decipher.final()]).toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Devuelve la memoria con el dato en claro si estaba cifrada.
 */
export function descifrarMemoria(m) {
  if (!m || m.cifrado !== FORMATO_CIFRADO) return m;
  const plano = descifrarDato(m);
  if (plano === null) {
    return { ...m, dato: '[cifrado: falta la clave de descifrado en el entorno]' };
  }
  const { cifrado, salt, iv, tag, ...resto } = m;
  return { ...resto, dato: plano };
}

export function esCifrada(m) {
  return m && m.cifrado === FORMATO_CIFRADO;
}


function leerMemorias(deps = {}) {
  const store = storeDe(deps);
  if (store) {
    try {
      return store.leer();
    } catch (err) {
      console.error('Error leyendo memorias:', err.message);
      return [];
    }
  }
  const ruta = deps.rutaArchivo || ARCHIVO_MEMORIA;
  try {
    if (!fs.existsSync(ruta)) {
      return [];
    }
    const raw = fs.readFileSync(ruta, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo memorias:', err.message);
    return [];
  }
}

function guardarMemorias(lista, deps = {}) {
  const store = storeDe(deps);
  try {
    if (store) {
      store.guardar(lista);
    } else {
      const ruta = deps.rutaArchivo || ARCHIVO_MEMORIA;
      fs.writeFileSync(ruta, JSON.stringify(lista, null, 2), 'utf-8');
    }
    // El indice vectorial (RAG) queda desactualizado tras cada escritura:
    // se invalida aqui y la propia busqueda semantica lo reconstruye en el
    // siguiente uso comprobando la firma de la fuente de memorias.
    try {
      invalidarIndiceSemantico();
    } catch (errInv) {
      console.error('Error invalidando indice semantico:', errInv.message);
    }
  } catch (err) {
    console.error('Error guardando memorias:', err.message);
  }
}

/**
 * Normaliza una cadena eliminando acentos, caracteres especiales y convirtiendo a minúsculas
 */
export function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DICCIONARIO_SINONIMOS = {
  cumple: ['cumple', 'cumpleanos', 'nacimiento', 'aniversario'],
  cumpleanos: ['cumple', 'cumpleanos', 'nacimiento', 'aniversario'],
  calza: ['calza', 'calzado', 'talla', 'pie', 'zapatillas', 'zapatos', 'numero'],
  talla: ['calza', 'calzado', 'talla', 'pie', 'zapatillas', 'zapatos', 'numero'],
  pie: ['calza', 'calzado', 'talla', 'pie', 'zapatillas', 'zapatos'],
  zapatillas: ['calza', 'calzado', 'talla', 'pie', 'zapatillas', 'zapatos'],
  zapatos: ['calza', 'calzado', 'talla', 'pie', 'zapatillas', 'zapatos'],
  correo: ['correo', 'email', 'mail', 'gmail', 'contacto'],
  email: ['correo', 'email', 'mail', 'gmail', 'contacto'],
  mail: ['correo', 'email', 'mail', 'gmail', 'contacto'],
  clave: ['clave', 'codigo', 'contrasena', 'password', 'pin', 'alarma', 'acceso'],
  codigo: ['clave', 'codigo', 'contrasena', 'password', 'pin', 'alarma', 'acceso'],
  pin: ['clave', 'codigo', 'contrasena', 'password', 'pin', 'alarma'],
  contrasena: ['clave', 'codigo', 'contrasena', 'password', 'pin', 'alarma'],
  wifi: ['wifi', 'red', 'internet', 'clave', 'contrasena'],
  telefono: ['telefono', 'movil', 'celular', 'numero', 'contacto'],
  movil: ['telefono', 'movil', 'celular', 'numero', 'contacto'],
  casa: ['casa', 'piso', 'direccion', 'vive', 'ubicacion'],
  direccion: ['casa', 'piso', 'direccion', 'vive', 'ubicacion']
};

function expandirSinonimos(palabras) {
  const expandidos = new Set(palabras);
  for (const p of palabras) {
    const lista = DICCIONARIO_SINONIMOS[p];
    if (lista) {
      for (const s of lista) expandidos.add(s);
    }
  }
  return [...expandidos];
}

/**
 * Determina si dos memorias se refieren exactamente al mismo hecho (para actualizar en lugar de duplicar)
 */
function sonElMismoHecho(memoriaExistente, nuevaMemoria) {
  const s1 = normalizarTexto(memoriaExistente.sujeto);
  const s2 = normalizarTexto(nuevaMemoria.sujeto);

  // Si los sujetos son diferentes, no son el mismo hecho
  if (s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)) {
    return false;
  }

  // Si ambas tienen una categoría específica idéntica (ej: 'clave', 'contacto'), pero NO 'general' ni 'persona'
  if (memoriaExistente.categoria === nuevaMemoria.categoria &&
      memoriaExistente.categoria !== 'general' &&
      memoriaExistente.categoria !== 'persona') {
    return true;
  }

  // Comparar tags semánticos en común (excluyendo el sujeto mismo)
  const tags1 = memoriaExistente.tags.map(normalizarTexto).filter(t => t !== s1 && t.length > 2);
  const tags2 = nuevaMemoria.tags.map(normalizarTexto).filter(t => t !== s2 && t.length > 2);
  const comunes = tags1.filter(t => tags2.includes(t));

  return comunes.length >= 2;
}

/**
 * Guarda o actualiza un hecho en el Second Brain
 */
function guardarMemoriaImpl({ sujeto, dato, categoria = 'general', tags = [] }, deps) {
  const lista = leerMemorias(deps);
  const id = `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const formatoLocal = new Date().toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const palabrasSujeto = normalizarTexto(sujeto).split(' ').filter(w => w.length > 1);
  const palabrasDato = normalizarTexto(dato).split(' ').filter(w => w.length > 2);
  const palabrasTagsExtra = tags.map(normalizarTexto).filter(w => w.length > 1);

  const todasPalabras = [...palabrasSujeto, ...palabrasDato, ...palabrasTagsExtra];
  const tagsExpandidos = expandirSinonimos(todasPalabras);
  const tagsUnicos = [...new Set(tagsExpandidos)].slice(0, 15);

  const nuevaMemoria = {
    id,
    sujeto: sujeto.trim(),
    dato: dato.trim(),
    categoria: (categoria || 'general').toLowerCase(),
    tags: tagsUnicos,
    fechaRegistro: new Date().toISOString(),
    fechaLocal: formatoLocal
  };

  // Las credenciales (categoria "clave") se cifran en reposo; sin clave de
  // cifrado configurada se rechaza el guardado en vez de escribir en plano.
  let memoriaAlmacenada = nuevaMemoria;
  if (nuevaMemoria.categoria === 'clave') {
    const cifrada = cifrarDato(nuevaMemoria.dato);
    if (!cifrada) {
      return { ok: false, error: 'No se puede guardar una credencial sin cifrar: define MEMORY_ENCRYPTION_KEY en el entorno.' };
    }
    memoriaAlmacenada = { ...nuevaMemoria, ...cifrada };
  }

  const datoParaLog = nuevaMemoria.categoria === 'clave' ? '[cifrado]' : nuevaMemoria.dato;

  // Comprobar si ya existe un hecho exactamente igual para actualizarlo
  const idxExistente = lista.findIndex(m => sonElMismoHecho(m, nuevaMemoria));

  if (idxExistente !== -1) {
    const idAnterior = lista[idxExistente].id;
    lista[idxExistente] = { ...memoriaAlmacenada, id: idAnterior };
    guardarMemorias(lista, deps);
    console.log(`[Memoria] [Memoria Actualizada] "${nuevaMemoria.sujeto}": ${datoParaLog}`);
    return { ok: true, accion: 'actualizada', memoria: descifrarMemoria(lista[idxExistente]) };
  }

  lista.push(memoriaAlmacenada);
  guardarMemorias(lista, deps);
  console.log(`[Memoria] [Memoria Guardada] "${nuevaMemoria.sujeto}": ${datoParaLog}`);

  return { ok: true, accion: 'creada', memoria: nuevaMemoria };
}

/**
 * Guarda o actualiza un hecho en el Second Brain.
 * Persistencia inyectable (puerto): rutaArchivo explicita = JSON; store
 * explicito o registrado por defecto = SQLite transaccional; sin ambos,
 * el JSON historico. Con store transaccional, toda la operacion de
 * leer-modificar-escribir corre dentro de una transaccion IMMEDIATE.
 */
export function guardarMemoria({ sujeto, dato, categoria = 'general', tags = [], rutaArchivo, store } = {}) {
  if (!sujeto || !dato) {
    return { ok: false, error: 'Se requiere sujeto y dato para guardar en la memoria.' };
  }
  const deps = {};
  if (rutaArchivo) deps.rutaArchivo = rutaArchivo;
  if (store) deps.store = store;
  const storeEfectivo = storeDe(deps);
  if (storeEfectivo) deps.store = storeEfectivo;
  return transaccionar(deps, () =>
    guardarMemoriaImpl({ sujeto, dato, categoria, tags }, deps));
}

/**
 * Busca datos en el Second Brain utilizando scoring semántico y de similitud
 */
export function buscarMemorias(consulta, deps = {}) {
  const lista = leerMemorias(deps);
  if (lista.length === 0) return [];
  if (!consulta || typeof consulta !== 'string') return lista.slice(-5);

  const consultaNorm = normalizarTexto(consulta);
  const tokens = consultaNorm.split(' ').filter(w => w.length > 1);
  if (tokens.length === 0) return lista.slice(-5);

  const terminosExpandidos = expandirSinonimos(tokens);

  const resultadosConScore = lista.map(item => {
    let score = 0;
    const sujNorm = normalizarTexto(item.sujeto);
    const datoNorm = normalizarTexto(item.dato);
    const tagsNorm = item.tags.map(normalizarTexto);

    // 1. Coincidencia completa del sujeto en la consulta
    if (sujNorm.length > 2 && consultaNorm.includes(sujNorm)) {
      score += 15;
    }

    // 2. Coincidencia por términos individuales
    for (const term of terminosExpandidos) {
      if (sujNorm === term) {
        score += 10;
      } else if (sujNorm.includes(term)) {
        score += 6;
      }

      if (tagsNorm.includes(term)) {
        score += 5;
      } else if (tagsNorm.some(t => t.includes(term) || term.includes(t))) {
        score += 3;
      }

      if (datoNorm.includes(term)) {
        score += 4;
      }
    }

    // Bonus de cobertura: todos los terminos de la consulta aparecen en el registro
    const todosCubiertos = terminosExpandidos.every(term =>
      sujNorm.includes(term) || datoNorm.includes(term) || tagsNorm.some(t => t.includes(term) || term.includes(t))
    );
    if (todosCubiertos && terminosExpandidos.length > 1) {
      score += 8;
    }

    return { item, score };
  });

  return resultadosConScore
    .filter(r => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // A igualdad de relevancia, el recuerdo mas reciente primero
      return new Date(b.item.fechaRegistro) - new Date(a.item.fechaRegistro);
    })
    .map(r => descifrarMemoria(r.item))
    .slice(0, 5);
}

/**
 * Devuelve todas las memorias o las filtra por categoría
 */
export function listarMemorias(categoria = null, deps = {}) {
  const lista = leerMemorias(deps);
  if (!categoria) return lista.map(descifrarMemoria);
  return lista.filter(m => m.categoria.toLowerCase() === categoria.toLowerCase()).map(descifrarMemoria);
}

/**
 * Elimina una o todas las memorias guardadas
 */
function olvidarMemoriaImpl(criterio, opciones, deps) {
  const lista = leerMemorias(deps);
  const rawCrit = (criterio || '').toString().trim().toLowerCase();

  // Comprobación de comodín ANTES de normalizar
  if (rawCrit === '*' || rawCrit === 'todos' || rawCrit === 'todas' || rawCrit.includes('todo') || rawCrit.includes('toda')) {
    // El borrado masivo es destructivo e irreversible: exige confirmacion
    // explicita (opciones.confirmado === true) en la misma peticion.
    if (opciones.confirmado !== true) {
      return {
        ok: false,
        requiereConfirmacion: true,
        total: lista.length,
        mensaje: `Vas a borrar TODOS los recuerdos del Second Brain (${lista.length} registros). Esta accion no se puede deshacer. Confirma que quieres borrarlo todo.`
      };
    }
    const total = lista.length;
    guardarMemorias([], deps);
    console.log(`[Memoria] [Memoria Vaciada] Se eliminaron todos los recuerdos (${total}) tras confirmacion explicita.`);
    return { ok: true, mensaje: `Se han eliminado todos los recuerdos del Second Brain (${total} registros).` };
  }

  const crit = normalizarTexto(rawCrit);
  if (!crit) {
    return { ok: false, error: 'Criterio de búsqueda vacío.' };
  }

  const idx = lista.findIndex(m => m.id === criterio || normalizarTexto(m.sujeto).includes(crit) || normalizarTexto(m.dato).includes(crit));

  if (idx === -1) {
    return { ok: false, error: 'No se encontró ningún recuerdo que coincida con ese criterio.' };
  }

  const [eliminada] = lista.splice(idx, 1);
  guardarMemorias(lista, deps);
  const datoLog = esCifrada(eliminada) ? '[cifrado]' : eliminada.dato;
  console.log(`[Memoria] [Memoria Olvidada] "${eliminada.sujeto}": ${datoLog}`);
  return { ok: true, memoria: descifrarMemoria(eliminada), mensaje: `Recuerdo olvidado con éxito: "${eliminada.sujeto}".` };
}

/**
 * Elimina una o todas las memorias. Misma costura de persistencia que
 * guardarMemoria; con store transaccional la lectura, la comprobacion
 * de confirmacion y el borrado corren en una transaccion IMMEDIATE.
 */
export function olvidarMemoria(criterio, opciones = {}) {
  const deps = {};
  if (opciones.rutaArchivo) deps.rutaArchivo = opciones.rutaArchivo;
  if (opciones.store) deps.store = opciones.store;
  const storeEfectivo = storeDe(deps);
  if (storeEfectivo) deps.store = storeEfectivo;
  return transaccionar(deps, () => olvidarMemoriaImpl(criterio, opciones, deps));
}
