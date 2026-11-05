/**
 * quedadasService.js - Planificador de quedadas (nº 48)
 *
 * Registra quedadas (titulo, dia/hora, lugar, participantes) y redacta la
 * invitacion como BORRADOR para que David la copie: el bot nunca la envia a
 * terceros.
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'quedadas.json');

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { quedadas: Array.isArray(data.quedadas) ? data.quedadas : [] };
  } catch {
    return { quedadas: [] };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export function crearQuedada({ titulo, fecha, hora, lugar, participantes } = {}, deps = {}) {
  const t = String(titulo || '').trim().slice(0, 80);
  if (!t) return { ok: false, error: 'Dime que quedada es (por ejemplo: "cena con la uni").' };
  const estado = leer(deps);
  const quedada = {
    id: crypto.randomBytes(4).toString('hex'),
    titulo: t,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : null,
    hora: /^\d{1,2}:\d{2}$/.test(String(hora || '')) ? hora : null,
    lugar: String(lugar || '').trim().slice(0, 120) || null,
    participantes: (Array.isArray(participantes) ? participantes : []).map((p) => String(p).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    creadaEn: new Date().toISOString()
  };
  estado.quedadas.push(quedada);
  guardar(estado, deps);
  return { ok: true, quedada };
}

export function listarQuedadas(deps = {}) {
  return leer(deps).quedadas.slice().reverse().slice(0, 10);
}

export async function redactarInvitacion({ criterio } = {}, deps = {}) {
  const c = String(criterio || '').trim().toLowerCase();
  const q = leer(deps).quedadas.find((x) => x.id === criterio || (c && x.titulo.toLowerCase().includes(c)));
  if (!q) return { ok: false, error: 'No encuentro esa quedada.' };
  const datos = `${q.titulo}${q.fecha ? `, ${q.fecha}` : ''}${q.hora ? ` a las ${q.hora}` : ''}${q.lugar ? `, en ${q.lugar}` : ''}`;
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: true, borrador: `Quedada: ${datos}. Os apuntais?`, nota: 'Borrador simple (sin modelo). Revisalo y envialo tu.' };
  }
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: 'Redacta un mensaje de WhatsApp corto y natural invitando a una quedada, en espanol, sin emojis. Es un borrador para que David lo revise y lo envie el: no lo envies a nadie.' },
      { role: 'user', content: datos }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  if (!texto) return { ok: false, error: 'El modelo no ha devuelto borrador.' };
  return { ok: true, borrador: texto, nota: 'Borrador: revisalo y envialo tu; yo no lo mando a nadie.' };
}
