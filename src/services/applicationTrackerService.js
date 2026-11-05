/**
 * applicationTrackerService.js
 * CRM de candidaturas de practicas y empleo (funcion 2 del roadmap de 50).
 * Registro local en JSON, ciclo de estados del proceso y seguimiento con
 * recordatorios reutilizando reminderService (inyectable en pruebas).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths.js';
import { crearRecordatorio as crearRecordatorioReal } from './reminderService.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'applications.json');
export const ESTADOS = ['registrada', 'enviada', 'entrevista', 'oferta', 'descartada'];
export const DIAS_SEGUIMIENTO_DEFECTO = 5;

function ruta(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leerCandidaturas(deps = {}) {
  try {
    const raw = fs.readFileSync(ruta(deps), 'utf-8');
    const lista = JSON.parse(raw);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function guardarCandidaturas(lista, deps = {}) {
  const archivo = ruta(deps);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const tmp = `${archivo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf-8');
  fs.renameSync(tmp, archivo);
}

function normalizar(texto) {
  return String(texto || '').trim().toLowerCase();
}

function ahora() {
  return new Date().toISOString();
}

/**
 * Registra una candidatura nueva. Dedupe por empresa+puesto (insensible a
 * mayusculas) salvo que la anterior estuviera descartada. Con seguimientoDias
 * crea un recordatorio real para no dejar morir el proceso.
 */
export function registrarCandidatura(
  { empresa, puesto, url = null, estado = 'registrada', notas = null, fuente = 'manual', seguimientoDias = null } = {},
  deps = {}
) {
  if (!normalizar(empresa) || !normalizar(puesto)) {
    return { ok: false, error: 'Empresa y puesto son obligatorios.' };
  }
  if (!ESTADOS.includes(estado)) {
    return { ok: false, error: `Estado no valido: ${estado}. Validos: ${ESTADOS.join(', ')}.` };
  }

  const lista = leerCandidaturas(deps);
  const duplicada = lista.find(
    (c) => normalizar(c.empresa) === normalizar(empresa) && normalizar(c.puesto) === normalizar(puesto) && c.estado !== 'descartada'
  );
  if (duplicada) {
    return { ok: false, error: 'Ya existe una candidatura activa para esa empresa y puesto.', existente: duplicada };
  }

  const ts = ahora();
  const candidatura = {
    id: crypto.randomUUID().slice(0, 8),
    empresa: String(empresa).trim(),
    puesto: String(puesto).trim(),
    url: url ? String(url).trim() : null,
    estado,
    notas: notas ? String(notas).trim() : null,
    fuente,
    creadaEn: ts,
    actualizadaEn: ts,
    historial: [{ estado, ts }]
  };
  lista.push(candidatura);
  guardarCandidaturas(lista, deps);

  let recordatorio = null;
  const dias = Number(seguimientoDias);
  if (Number.isFinite(dias) && dias > 0) {
    const crear = typeof deps.crearRecordatorio === 'function' ? deps.crearRecordatorio : crearRecordatorioReal;
    try {
      recordatorio = crear({
        mensaje: `Seguimiento de candidatura: ${candidatura.puesto} en ${candidatura.empresa} (id ${candidatura.id})`,
        minutosEnElFuturo: Math.round(dias * 24 * 60)
      });
    } catch (err) {
      recordatorio = { ok: false, error: err.message };
    }
  }

  return { ok: true, candidatura, recordatorio };
}

/**
 * Lista candidaturas, opcionalmente filtradas por estado, mas recientes primero.
 */
export function listarCandidaturas({ estado = null } = {}, deps = {}) {
  let lista = leerCandidaturas(deps);
  if (estado) lista = lista.filter((c) => c.estado === estado);
  return lista.slice().sort((a, b) => String(b.actualizadaEn).localeCompare(String(a.actualizadaEn)));
}

/**
 * Busca por id exacto o por texto parcial en empresa/puesto.
 */
export function buscarCandidaturas(criterio, deps = {}) {
  const q = normalizar(criterio);
  if (!q) return [];
  const lista = leerCandidaturas(deps);
  const porId = lista.filter((c) => c.id === q);
  if (porId.length > 0) return porId;
  return lista.filter((c) => normalizar(c.empresa).includes(q) || normalizar(c.puesto).includes(q));
}

/**
 * Actualiza estado y/o notas de una candidatura localizada por criterio.
 * Requiere coincidencia unica; si hay varias devuelve las candidatas.
 */
export function actualizarCandidatura(criterio, { estado = null, notas = null } = {}, deps = {}) {
  const coincidencias = buscarCandidaturas(criterio, deps);
  if (coincidencias.length === 0) {
    return { ok: false, error: `Ninguna candidatura coincide con "${criterio}".` };
  }
  if (coincidencias.length > 1) {
    return {
      ok: false,
      error: `Criterio ambiguo: ${coincidencias.length} candidaturas coinciden. Usa el id.`,
      coincidencias: coincidencias.map((c) => ({ id: c.id, empresa: c.empresa, puesto: c.puesto, estado: c.estado }))
    };
  }
  if (estado !== null && !ESTADOS.includes(estado)) {
    return { ok: false, error: `Estado no valido: ${estado}. Validos: ${ESTADOS.join(', ')}.` };
  }

  const lista = leerCandidaturas(deps);
  const candidatura = lista.find((c) => c.id === coincidencias[0].id);
  const ts = ahora();
  if (estado && estado !== candidatura.estado) {
    candidatura.estado = estado;
    candidatura.historial.push({ estado, ts });
  }
  if (notas) {
    candidatura.notas = candidatura.notas ? `${candidatura.notas}\n${String(notas).trim()}` : String(notas).trim();
  }
  candidatura.actualizadaEn = ts;
  guardarCandidaturas(lista, deps);
  return { ok: true, candidatura };
}

/**
 * Resumen por estados para contestaciones rapidas.
 */
export function resumenCandidaturas(deps = {}) {
  const lista = leerCandidaturas(deps);
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const c of lista) {
    if (porEstado[c.estado] !== undefined) porEstado[c.estado] += 1;
  }
  return { total: lista.length, porEstado };
}

/**
 * Candidaturas activas (no oferta ni descartada) sin movimiento en `dias`.
 * Base del aviso de seguimiento cuando no se pidio recordatorio al registrar.
 */
export function pendientesDeSeguimiento({ dias = DIAS_SEGUIMIENTO_DEFECTO } = {}, deps = {}) {
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  return leerCandidaturas(deps).filter(
    (c) => c.estado !== 'descartada' && c.estado !== 'oferta' && Date.parse(c.actualizadaEn) < corte
  );
}
