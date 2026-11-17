/**
 * contactsService.js - Memoria de contactos (nº 37)
 *
 * Ficha por persona: nombre, telefono, relacion, email y notas. Datos
 * introducidos por David; busqueda por nombre, relacion o notas.
 *
 * Soporte dual: SQLite Store (ACID + multi-tenant) y fallback JSON.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from '../security/tenantFileSystem.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'contactos.json');

let storeContactosPorDefecto = null;

export function registrarStoreContactosPorDefecto(store) {
  storeContactosPorDefecto = store || null;
}

function storeDe(deps = {}) {
  if (deps.store) return deps.store;
  if (deps.rutaArchivo) return null;
  return storeContactosPorDefecto;
}

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    const lista = Array.isArray(data.contactos) ? data.contactos : [];
    if (lista.length > 0) return { contactos: lista };
  } catch {
    // Si no existe el archivo, intentamos sincronizar contactos existentes del Segundo Cerebro
  }
  // Sincronizacion perezosa si contactos.json no tiene entradas
  if (!deps.sinAutoSync) {
    sincronizarContactosDesdeSegundoCerebro({ ...deps, sinAutoSync: true });
    try {
      const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
      return { contactos: Array.isArray(data.contactos) ? data.contactos : [] };
    } catch {
      return { contactos: [] };
    }
  }
  return { contactos: [] };
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

function campo(txt, max) {
  return String(txt || '').trim().slice(0, max) || null;
}

export function registrarContacto({ nombre, telefono, relacion, email, notas } = {}, deps = {}) {
  const n = campo(nombre, 60);
  if (!n) return { ok: false, error: 'Dime el nombre del contacto.' };
  const tel = campo(telefono, 30);
  if (tel && !/^[+\d][\d\s-]{4,}$/.test(tel)) return { ok: false, error: 'Telefono invalido.' };

  const store = storeDe(deps);
  if (store) {
    const rel = campo(relacion, 60);
    const em = campo(email, 80);
    const nota = campo(notas, 300);
    const contacto = store.guardar({ nombre: n, telefono: tel, relacion: rel, email: em, notas: nota }, deps.tenantId);
    return { ok: true, contacto };
  }

  const estado = leer(deps);
  let contacto = estado.contactos.find((c) => c.nombre.toLowerCase() === n.toLowerCase());
  if (!contacto) {
    contacto = { id: crypto.randomBytes(4).toString('hex'), nombre: n, creadoEn: new Date().toISOString() };
    estado.contactos.push(contacto);
  }
  if (tel) contacto.telefono = tel;
  const rel = campo(relacion, 60);
  if (rel) contacto.relacion = rel;
  const em = campo(email, 80);
  if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) contacto.email = em;
  const nota = campo(notas, 300);
  if (nota) contacto.notas = nota;
  contacto.actualizadoEn = new Date().toISOString();
  guardar(estado, deps);
  return { ok: true, contacto };
}

export function buscarContacto(criterio, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  if (!c) return { ok: false, error: 'Dime a quien busco.' };

  const store = storeDe(deps);
  if (store) {
    const encontrados = store.buscar(c, deps.tenantId);
    return { ok: true, contactos: encontrados };
  }

  const encontrados = leer(deps).contactos.filter((ct) =>
    ct.nombre.toLowerCase().includes(c) ||
    (ct.relacion || '').toLowerCase().includes(c) ||
    (ct.notas || '').toLowerCase().includes(c));
  return { ok: true, contactos: encontrados };
}

export function listarContactos(deps = {}) {
  const store = storeDe(deps);
  if (store) {
    return store.listar(deps.tenantId);
  }

  return leer(deps).contactos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function eliminarContacto(criterio, deps = {}) {
  const store = storeDe(deps);
  if (store) {
    const ok = store.borrar(criterio, deps.tenantId);
    if (!ok.ok) return { ok: false, error: 'No encuentro ese contacto.' };
    return { ok: true, contacto: { criterio } };
  }

  const estado = leer(deps);
  const c = String(criterio || '').trim().toLowerCase();
  const idx = estado.contactos.findIndex((ct) => ct.id === criterio || (c && ct.nombre.toLowerCase().includes(c)));
  if (idx === -1) return { ok: false, error: 'No encuentro ese contacto.' };
  const [borrado] = estado.contactos.splice(idx, 1);
  guardar(estado, deps);
  return { ok: true, contacto: borrado };
}

function extraerTelefonoDeTexto(texto) {
  if (!texto) return null;
  const m = String(texto).match(/\+?[\d\s-]{9,}/);
  if (!m) return null;
  const limpio = m[0].trim();
  const digitos = limpio.replace(/\D/g, '');
  if (digitos.length >= 8 && digitos.length <= 15) return limpio;
  return null;
}

export function sincronizarContactosDesdeSegundoCerebro(deps = {}) {
  const rutaMemorias = deps.rutaArchivoMemorias || path.join(DATA_DIR, 'brain_memory.json');
  // Si el store por defecto (SQLite) esta activo y no se pide ruta explicita de archivo,
  // usamos el store para que los contactos queden persistidos en SQLite, no solo en JSON.
  const depsEfectivos = deps.rutaArchivo ? deps : { ...deps };
  try {
    if (!fs.existsSync(rutaMemorias)) return { ok: false, sincronizados: 0 };
    const raw = fs.readFileSync(rutaMemorias, 'utf-8');
    const memorias = JSON.parse(raw);
    if (!Array.isArray(memorias)) return { ok: false, sincronizados: 0 };
    let sincronizados = 0;
    for (const m of memorias) {
      if (m && m.categoria === 'contacto' && m.sujeto && m.dato) {
        const tel = extraerTelefonoDeTexto(m.dato) || (Array.isArray(m.tags) ? m.tags.map(extraerTelefonoDeTexto).find(Boolean) : null);
        if (tel) {
          const res = registrarContacto({
            nombre: m.sujeto,
            telefono: tel,
            relacion: m.relacion || 'contacto',
            notas: 'Sincronizado desde Segundo Cerebro'
          }, depsEfectivos);
          if (res.ok) sincronizados++;
        }
      }
    }
    return { ok: true, sincronizados };
  } catch {
    return { ok: false, sincronizados: 0 };
  }
}

/**
 * Importa contactos desde un archivo contactos.json al store activo (SQLite o JSON).
 * Solo importa contactos que no existan ya (por nombre exacto). Idem-potente.
 * Para uso en bootstrapping al arranque cuando el store SQLite esta vacio.
 */
export function importarContactosDesdeJson(rutaJson, deps = {}) {
  try {
    if (!fs.existsSync(rutaJson)) return { ok: true, importados: 0 };
    const data = JSON.parse(fs.readFileSync(rutaJson, 'utf-8'));
    const lista = Array.isArray(data.contactos) ? data.contactos : [];
    if (lista.length === 0) return { ok: true, importados: 0 };
    // Leer los que ya existen para no duplicar
    const existentes = new Set(listarContactos(deps).map((c) => c.nombre.toLowerCase()));
    let importados = 0;
    for (const c of lista) {
      if (!c.nombre || existentes.has(String(c.nombre).toLowerCase())) continue;
      const res = registrarContacto({
        nombre: c.nombre,
        telefono: c.telefono || '',
        relacion: c.relacion || '',
        email: c.email || '',
        notas: c.notas || ''
      }, deps);
      if (res.ok) { importados++; existentes.add(String(c.nombre).toLowerCase()); }
    }
    return { ok: true, importados };
  } catch {
    return { ok: false, importados: 0 };
  }
}
