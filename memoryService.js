import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = path.join(__dirname, 'data');
const ARCHIVO_MEMORIA = path.join(CARPETA_DATA, 'brain_memory.json');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

function leerMemorias() {
  try {
    if (!fs.existsSync(ARCHIVO_MEMORIA)) {
      return [];
    }
    const raw = fs.readFileSync(ARCHIVO_MEMORIA, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo memorias:', err.message);
    return [];
  }
}

function guardarMemorias(lista) {
  try {
    fs.writeFileSync(ARCHIVO_MEMORIA, JSON.stringify(lista, null, 2), 'utf-8');
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
export function guardarMemoria({ sujeto, dato, categoria = 'general', tags = [] }) {
  if (!sujeto || !dato) {
    return { ok: false, error: 'Se requiere sujeto y dato para guardar en la memoria.' };
  }

  const lista = leerMemorias();
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

  // Comprobar si ya existe un hecho exactamente igual para actualizarlo
  const idxExistente = lista.findIndex(m => sonElMismoHecho(m, nuevaMemoria));

  if (idxExistente !== -1) {
    const idAnterior = lista[idxExistente].id;
    lista[idxExistente] = { ...nuevaMemoria, id: idAnterior };
    guardarMemorias(lista);
    console.log(`🧠 [Memoria Actualizada] "${nuevaMemoria.sujeto}": ${nuevaMemoria.dato}`);
    return { ok: true, accion: 'actualizada', memoria: lista[idxExistente] };
  }

  lista.push(nuevaMemoria);
  guardarMemorias(lista);
  console.log(`🧠 [Memoria Guardada] "${nuevaMemoria.sujeto}": ${nuevaMemoria.dato}`);

  return { ok: true, accion: 'creada', memoria: nuevaMemoria };
}

/**
 * Busca datos en el Second Brain utilizando scoring semántico y de similitud
 */
export function buscarMemorias(consulta) {
  const lista = leerMemorias();
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

    return { item, score };
  });

  return resultadosConScore
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.item)
    .slice(0, 5);
}

/**
 * Devuelve todas las memorias o las filtra por categoría
 */
export function listarMemorias(categoria = null) {
  const lista = leerMemorias();
  if (!categoria) return lista;
  return lista.filter(m => m.categoria.toLowerCase() === categoria.toLowerCase());
}

/**
 * Elimina una o todas las memorias guardadas
 */
export function olvidarMemoria(criterio) {
  const lista = leerMemorias();
  const rawCrit = (criterio || '').toString().trim().toLowerCase();

  // Comprobación de comodín ANTES de normalizar
  if (rawCrit === '*' || rawCrit === 'todos' || rawCrit === 'todas' || rawCrit.includes('todo') || rawCrit.includes('toda')) {
    const total = lista.length;
    guardarMemorias([]);
    console.log(`🧠 [Memoria Vaciada] Se eliminaron todos los recuerdos (${total}).`);
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
  guardarMemorias(lista);
  console.log(`🧠 [Memoria Olvidada] "${eliminada.sujeto}": ${eliminada.dato}`);
  return { ok: true, memoria: eliminada, mensaje: `Recuerdo olvidado con éxito: "${eliminada.sujeto}".` };
}
