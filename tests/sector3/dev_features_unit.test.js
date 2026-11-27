/**
 * dev_features_unit.test.js
 *
 * Verificacion unitaria de las tres funcionalidades implementadas por dev-features:
 * 1. Google Calendar bidireccional (crear, modificar, cancelar local y remoto via mock).
 * 2. Precios de viajes y transporte vivo (tarifas de Renfe, corredores AVE/MD/Cercanias y comprobacion funcional).
 * 3. Herramientas del Agente GitHub autonomo registradas en tools y despachadas en jarvisAgent.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  crearEvento,
  modificarEvento,
  cancelarEvento,
  consultarEventos
} from '../../src/services/calendarService.js';

import {
  consultarPrecioRutaRenfe,
  vigilarRuta,
  listarRutasVigiladas,
  cancelarVigilanciaRuta,
  registrarPrecioRuta,
  comprobarRutasProgramado
} from '../../src/services/viajesService.js';

import {
  crearRamaTrabajo,
  crearCommit,
  empujarRama,
  abrirPullRequest,
  ejecutarTareaProgramacion
} from '../../src/services/githubAgentService.js';

import { herramientasJarvis, MAPA_INTENCION_HERRAMIENTAS, NOMBRES_HERRAMIENTAS_JARVIS } from '../../src/core/tools.js';
import { consultarJarvis, analizarIntencion } from '../../src/core/jarvisAgent.js';

const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-features-test-'));
const rutaArchivoCal = path.join(dirTmp, 'cal_test.json');
const rutaArchivoViajes = path.join(dirTmp, 'viajes_test.json');

// --- 1. Google Calendar bidireccional ---

test('1. Calendar: crearEvento, modificarEvento y cancelarEvento local', async () => {
  const deps = { rutaArchivo: rutaArchivoCal, apiKey: null };

  // Crear
  const rCrear = await crearEvento({
    titulo: 'Examen de Redes',
    inicio: '2026-12-01 09:00',
    fin: '2026-12-01 11:00',
    descripcion: 'Aula 2.1'
  }, deps);

  assert.strictEqual(rCrear.ok, true);
  assert.ok(rCrear.evento.id);
  assert.strictEqual(rCrear.evento.titulo, 'Examen de Redes');

  // Modificar
  const rMod = await modificarEvento({
    id: rCrear.evento.id,
    titulo: 'Examen de Redes (Actualizado)',
    inicio: '2026-12-01 10:00',
    descripcion: 'Cambio al Aula 3.4'
  }, deps);

  assert.strictEqual(rMod.ok, true);
  assert.strictEqual(rMod.evento.titulo, 'Examen de Redes (Actualizado)');
  assert.strictEqual(rMod.evento.inicio, '2026-12-01 10:00');
  assert.strictEqual(rMod.evento.descripcion, 'Cambio al Aula 3.4');

  // Cancelar
  const rCanc = await cancelarEvento({ id: rCrear.evento.id }, deps);
  assert.strictEqual(rCanc.ok, true);
  assert.strictEqual(rCanc.cancelados, 1);

  const lista = await consultarEventos({ desde: '2026-11-01', hasta: '2026-12-31' }, deps);
  assert.strictEqual(lista.eventos.length, 0);
});

test('1. Calendar: sincronizacion con Google Calendar API mockeada', async () => {
  const peticiones = [];
  const mockFetch = async (url, opts = {}) => {
    peticiones.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'POST') {
      return { ok: true, json: async () => ({ id: 'gcal-remote-999', summary: 'Cita Medica' }) };
    }
    if (opts.method === 'PATCH') {
      return { ok: true, json: async () => ({ id: 'gcal-remote-999', summary: 'Cita Medica Modificada' }) };
    }
    if (opts.method === 'DELETE') {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };

  const deps = {
    rutaArchivo: path.join(dirTmp, 'cal_google.json'),
    fetchFn: mockFetch,
    apiKey: 'ai_fake_key',
    accessToken: 'ya29_fake_token',
    calendarId: 'primary'
  };

  const rCrear = await crearEvento({
    titulo: 'Cita Medica',
    inicio: '2026-12-05 16:30'
  }, deps);

  assert.strictEqual(rCrear.ok, true);
  assert.strictEqual(rCrear.fuente, 'google');
  assert.strictEqual(rCrear.evento.id, 'gcal-remote-999');
  assert.strictEqual(peticiones[0].method, 'POST');

  const rMod = await modificarEvento({
    id: 'gcal-remote-999',
    titulo: 'Cita Medica Modificada'
  }, deps);

  assert.strictEqual(rMod.ok, true);
  assert.strictEqual(rMod.fuente, 'google');
  assert.strictEqual(peticiones[1].method, 'PATCH');

  const rDel = await cancelarEvento({ id: 'gcal-remote-999' }, deps);
  assert.strictEqual(rDel.ok, true);
  assert.strictEqual(peticiones[2].method, 'DELETE');
});

// --- 2. Precios de viajes y transporte vivo ---

test('2. Viajes: consultarPrecioRutaRenfe calcula tarifas realistas segun corredor y fecha', async () => {
  // Corredor conocido Madrid -> Barcelona
  const rBcn = await consultarPrecioRutaRenfe({
    tipo: 'tren',
    origen: 'Madrid',
    destino: 'Barcelona',
    fecha: '2026-12-20'
  });

  assert.strictEqual(rBcn.ok, true);
  assert.strictEqual(rBcn.fuente, 'renfe_tarifas_gtfs');
  assert.strictEqual(rBcn.moneda, 'EUR');
  assert.ok(rBcn.precio > 20 && rBcn.precio < 80);
  assert.match(rBcn.servicio, /AVE/);

  // Corredor Madrid -> Sevilla
  const rSev = await consultarPrecioRutaRenfe({
    tipo: 'tren',
    origen: 'Madrid Atocha',
    destino: 'Sevilla Santa Justa',
    fecha: '2026-12-22'
  });

  assert.strictEqual(rSev.ok, true);
  assert.ok(rSev.precio > 20 && rSev.precio < 70);

  // Cercanias
  const rCer = await consultarPrecioRutaRenfe({
    tipo: 'tren',
    origen: 'Aravaca',
    destino: 'Pozuelo',
    fecha: '2026-12-10'
  });

  assert.strictEqual(rCer.ok, true);
  assert.strictEqual(rCer.precio, 2.6);
  assert.strictEqual(rCer.servicio, 'Cercanias');
});

test('2. Viajes: comprobarRutasProgramado funcional conectado a tarifas de Renfe', async () => {
  const rutaArch = path.join(dirTmp, 'viajes_func.json');
  const encoladas = [];

  // Registrar ruta vigilada de tren
  const reg = vigilarRuta({
    tipo: 'tren',
    origen: 'Madrid',
    destino: 'Sevilla',
    fecha: '2026-12-25',
    precioObjetivo: 45
  }, { rutaArchivo: rutaArch });

  assert.strictEqual(reg.ok, true);
  assert.match(reg.nota, /Renfe/);

  // Ejecucion sin proveedor externo: usa la logica funcional de Renfe conectada
  const comp = await comprobarRutasProgramado({
    rutaArchivo: rutaArch,
    enqueue: (a) => encoladas.push(a)
  });

  assert.strictEqual(comp.ok, true);
  assert.strictEqual(comp.avisos, 1);
  assert.ok(encoladas.length >= 1);
  assert.match(encoladas[0].title, /Bajada en tu tren/);
  assert.match(encoladas[0].body, /EUR/);

  const rutas = listarRutasVigiladas({ rutaArchivo: rutaArch });
  assert.strictEqual(rutas[0].historial.length, 1);
  assert.strictEqual(rutas[0].historial[0].fuente, 'renfe_tarifas_gtfs');
});

// --- 3. Herramientas registradas en tools.js y despachadas en jarvisAgent.js ---

test('3. Tools: herramientas registradas en tools.js y MAPA_INTENCION_HERRAMIENTAS', () => {
  const nombres = herramientasJarvis.map((h) => h.function.name);

  // Calendar
  assert.ok(nombres.includes('consultar_eventos'));
  assert.ok(nombres.includes('crear_evento'));
  assert.ok(nombres.includes('modificar_evento'));
  assert.ok(nombres.includes('cancelar_evento'));
  assert.deepEqual(MAPA_INTENCION_HERRAMIENTAS.calendario, ['consultar_eventos', 'crear_evento', 'modificar_evento', 'cancelar_evento']);

  // GitHub Agent
  assert.ok(nombres.includes('crear_rama_trabajo'));
  assert.ok(nombres.includes('crear_commit'));
  assert.ok(nombres.includes('abrir_pull_request'));
  assert.ok(nombres.includes('empujar_rama'));
  assert.ok(nombres.includes('ejecutar_tarea_programacion'));
  assert.deepEqual(MAPA_INTENCION_HERRAMIENTAS.github, [
    'crear_rama_trabajo', 'crear_commit', 'abrir_pull_request', 'empujar_rama', 'ejecutar_tarea_programacion'
  ]);

  // Set de telemetria NOMBRES_HERRAMIENTAS_JARVIS actualizado
  assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.has('crear_evento'));
  assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.has('crear_rama_trabajo'));
});

test('3. Enrutador: analizarIntencion detecta intenciones de calendario y github', () => {
  const rCal = analizarIntencion('crea un evento en mi calendario para el examen de algoritmos');
  assert.ok(rCal.intenciones.includes('calendario'));
  const namesCal = rCal.herramientas.map((h) => h.function.name);
  assert.ok(namesCal.includes('crear_evento'));

  const rGit = analizarIntencion('crea una rama feat/auth y haz commit de los cambios');
  assert.ok(rGit.intenciones.includes('github'));
  const namesGit = rGit.herramientas.map((h) => h.function.name);
  assert.ok(namesGit.includes('crear_rama_trabajo'));
  assert.ok(namesGit.includes('crear_commit'));
});

test('3. Despacho jarvisAgent: herramientas de calendar y github se ejecutan correctamente', async () => {
  const chatSimulado = (toolCall) => async ({ messages }) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo.role === 'tool') {
      return { message: { role: 'assistant', content: 'Hecho: ' + ultimo.content } };
    }
    return {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [toolCall]
      }
    };
  };

  // Calendar crear_evento
  const chatCal = chatSimulado({
    id: 'c_cal',
    type: 'function',
    function: {
      name: 'crear_evento',
      arguments: JSON.stringify({ titulo: 'Reunion Swarm', inicio: '2026-11-20 12:00' })
    }
  });

  const resCal = await consultarJarvis('agenda reunion', {
    chatCompletion: chatCal,
    rutaArchivoCalendario: path.join(dirTmp, 'cal_agent.json')
  });

  assert.ok(typeof resCal === 'string');
  assert.match(resCal, /Reunion Swarm/);

  // GitHub crear_rama_trabajo con execGit mockeado
  const gitComandos = [];
  const mockExecGit = async (args, cwd) => {
    gitComandos.push(args);
    return 'Switched to a new branch feat/test';
  };

  const chatGit = chatSimulado({
    id: 'c_git',
    type: 'function',
    function: {
      name: 'crear_rama_trabajo',
      arguments: JSON.stringify({ nombreRama: 'feat/test', base: 'main' })
    }
  });

  const resGit = await consultarJarvis('crea una rama feat/test', {
    chatCompletion: chatGit,
    execGit: mockExecGit
  });

  assert.ok(typeof resGit === 'string');
  assert.match(resGit, /feat\/test/);
  assert.ok(gitComandos.length >= 1);
});
