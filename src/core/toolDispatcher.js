/**
 * toolDispatcher.js - Registro modular por dominio para la ejecucion de herramientas.
 *
 * Extrae el despacho de herramientas de jarvisAgent.js manteniendo intactas
 * todas las firmas, contratos de respuesta y compatibilidad con mocks/deps.
 *
 * Politica estricta: cero emojis en codigo, comentarios y respuestas.
 */

import { crearManejadoresCalendario, depsCalendarioDe } from './handlers/calendarHandlers.js';
import { crearManejadoresGmail } from './handlers/gmailHandlers.js';
import { crearManejadoresFinanzas, depsFinanzasDe } from './handlers/financeHandlers.js';
import { crearManejadoresMemoriaYCerebro, repoMemoriaDe } from './handlers/memoryBrainHandlers.js';
import { crearManejadoresEstudioYCarrera } from './handlers/studyCareerHandlers.js';
import { crearManejadoresOpsYSeguridad } from './handlers/opsSecurityHandlers.js';
import {
  crearManejadoresVidaPersonal,
  depsHabitosDe,
  depsCompraDe,
  depsTransporteDe,
  textoResultadoTransporte
} from './handlers/personalLifeHandlers.js';
import { crearManejadoresComunicacionYDev } from './handlers/commsDevHandlers.js';

export {
  depsCalendarioDe,
  depsFinanzasDe,
  depsHabitosDe,
  depsCompraDe,
  depsTransporteDe,
  repoMemoriaDe,
  textoResultadoTransporte
};

const REGISTRO_MANEJADORES = new Map([
  ...Object.entries(crearManejadoresCalendario()),
  ...Object.entries(crearManejadoresGmail()),
  ...Object.entries(crearManejadoresFinanzas()),
  ...Object.entries(crearManejadoresMemoriaYCerebro()),
  ...Object.entries(crearManejadoresEstudioYCarrera()),
  ...Object.entries(crearManejadoresOpsYSeguridad()),
  ...Object.entries(crearManejadoresVidaPersonal()),
  ...Object.entries(crearManejadoresComunicacionYDev())
]);

export function tieneManejadorHerramienta(nombreFuncion) {
  return REGISTRO_MANEJADORES.has(nombreFuncion);
}

/**
 * Despacha una herramienta nativa registrada por dominio.
 * Devuelve { texto, enlaces } manteniendo el contrato historico de jarvisAgent.
 */
export async function despacharHerramienta(nombreFuncion, args = {}, opciones = {}, deps = {}) {
  const manejador = REGISTRO_MANEJADORES.get(nombreFuncion);
  if (!manejador) {
    return { texto: 'Función no reconocida.', enlaces: null };
  }
  const resultado = await manejador(args, opciones, deps);
  if (resultado && typeof resultado === 'object' && 'texto' in resultado) {
    return { texto: resultado.texto, enlaces: resultado.enlaces || null };
  }
  return { texto: resultado, enlaces: null };
}
