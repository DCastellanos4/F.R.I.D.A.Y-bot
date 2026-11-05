/**
 * contactsService.js - Memoria de contactos (nº 37)
 *
 * Ficha por persona: nombre, telefono, relacion, email y notas. Datos
 * introducidos por David; busqueda por nombre, relacion o notas.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'contactos.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { contactos: Array.isArray(data.contactos) ? data.contactos : [] };
  } catch {
    return { contactos: [] };
  }
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
  const encontrados = leer(deps).contactos.filter((ct) =>
    ct.nombre.toLowerCase().includes(c) ||
    (ct.relacion || '').toLowerCase().includes(c) ||
    (ct.notas || '').toLowerCase().includes(c));
  return { ok: true, contactos: encontrados };
}

export function listarContactos(deps = {}) {
  return leer(deps).contactos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function eliminarContacto(criterio, deps = {}) {
  const estado = leer(deps);
  const c = String(criterio || '').trim().toLowerCase();
  const idx = estado.contactos.findIndex((ct) => ct.id === criterio || (c && ct.nombre.toLowerCase().includes(c)));
  if (idx === -1) return { ok: false, error: 'No encuentro ese contacto.' };
  const [borrado] = estado.contactos.splice(idx, 1);
  guardar(estado, deps);
  return { ok: true, contacto: borrado };
}
