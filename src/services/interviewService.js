/**
 * interviewService.js - Simulador de entrevistas tecnicas por voz (nº 3)
 *
 * Simulacro por chat: JARVIS lo abre con la herramienta y, mientras este
 * activo en ese chat, cada mensaje de David se evalua como respuesta y se
 * hace la siguiente pregunta. Las notas de voz llegan transcritas por el
 * flujo de audio existente, asi que hablar o escribir es el mismo camino.
 * Sin el modelo no hay simulacro: lo dice y no improvisa.
 * Se sale con "terminar entrevista" (interceptado antes que el modo).
 *
 * Strict Policy: Zero Emojis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';

export const ARCHIVO_DEFECTO = path.join(DATA_DIR, 'entrevistas.json');
const MAX_PREGUNTAS = 5;

function rutaArchivo(deps = {}) {
  return deps.rutaArchivo || ARCHIVO_DEFECTO;
}

function leer(deps = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(rutaArchivo(deps), 'utf-8'));
    return { sesiones: data.sesiones && typeof data.sesiones === 'object' ? data.sesiones : {} };
  } catch {
    return { sesiones: {} };
  }
}

function guardar(estado, deps = {}) {
  const ruta = rutaArchivo(deps);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf-8');
  fs.renameSync(tmp, ruta);
}

export function estadoEntrevista(deps = {}) {
  const chatId = deps.chatId || 'default';
  return leer(deps).sesiones[chatId] || null;
}

export async function iniciarEntrevista({ rol, nivel } = {}, deps = {}) {
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'El simulacro necesita el modelo de lenguaje; sin el no puedo hacer de entrevistador.' };
  }
  const r = String(rol || '').trim().slice(0, 80);
  if (!r) return { ok: false, error: 'Dime para que puesto practicas (por ejemplo: "entrevista de backend junior").' };
  const chatId = deps.chatId || 'default';
  const estado = leer(deps);
  const sesion = { rol: r, nivel: String(nivel || 'junior').trim().slice(0, 40), pregunta: 1, aciertos: 0, iniciadaEn: new Date().toISOString(), historial: [] };
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: `Eres un entrevistador tecnico para un puesto de ${r} (nivel ${sesion.nivel}). Haz SOLO la primera pregunta tecnica, breve y concreta, en espanol, sin emojis ni presentaciones.` },
      { role: 'user', content: 'Primera pregunta.' }
    ]
  });
  const pregunta = (resp?.message?.content || resp?.content || '').trim();
  if (!pregunta) return { ok: false, error: 'El modelo no ha devuelto la primera pregunta.' };
  sesion.historial.push({ pregunta });
  estado.sesiones[chatId] = sesion;
  guardar(estado, deps);
  return { ok: true, pregunta, total: MAX_PREGUNTAS };
}

export async function responderEntrevista(respuesta, deps = {}) {
  const chatId = deps.chatId || 'default';
  const estado = leer(deps);
  const sesion = estado.sesiones[chatId];
  if (!sesion) return { ok: false, error: 'No hay simulacro activo en este chat. Abre uno con "simulacro de entrevista de ...".' };
  if (typeof deps.chatCompletion !== 'function') {
    return { ok: false, error: 'Sin el modelo no puedo evaluar la respuesta.' };
  }
  const actual = sesion.historial[sesion.historial.length - 1];
  const resp = await deps.chatCompletion({
    messages: [
      { role: 'system', content: `Eres un entrevistador tecnico (${sesion.rol}, nivel ${sesion.nivel}). Evalua la respuesta del candidato a tu pregunta "${actual.pregunta}". Responde en espanol, sin emojis, con este formato exacto de 3 lineas:\nVEREDICTO: acierto | parcial | fallo\nCOMENTARIO: una o dos frases honestas\n${sesion.pregunta < MAX_PREGUNTAS ? 'SIGUIENTE: la siguiente pregunta tecnica' : 'CIERRE: valoracion global del simulacro en dos frases'}` },
      { role: 'user', content: String(respuesta || '').slice(0, 2000) }
    ]
  });
  const texto = (resp?.message?.content || resp?.content || '').trim();
  if (!texto) return { ok: false, error: 'El modelo no ha devuelto evaluacion.' };
  const veredicto = (texto.match(/^VEREDICTO:\s*(.+)$/mi) || [])[1]?.trim().toLowerCase() || 'parcial';
  if (veredicto.startsWith('acierto')) sesion.aciertos++;
  const siguiente = (texto.match(/^SIGUIENTE:\s*(.+)$/mi) || [])[1]?.trim() || null;
  const fin = sesion.pregunta >= MAX_PREGUNTAS;
  if (fin) {
    const resultado = { aciertos: sesion.aciertos, total: sesion.pregunta };
    delete estado.sesiones[chatId];
    guardar(estado, deps);
    return { ok: true, evaluacion: texto, fin: true, resultado };
  }
  sesion.pregunta++;
  sesion.historial.push({ pregunta: siguiente });
  estado.sesiones[chatId] = sesion;
  guardar(estado, deps);
  return { ok: true, evaluacion: texto, fin: false, pregunta: sesion.pregunta, total: MAX_PREGUNTAS };
}

export function terminarEntrevista(deps = {}) {
  const chatId = deps.chatId || 'default';
  const estado = leer(deps);
  const habia = Boolean(estado.sesiones[chatId]);
  delete estado.sesiones[chatId];
  guardar(estado, deps);
  return { ok: true, habia };
}
