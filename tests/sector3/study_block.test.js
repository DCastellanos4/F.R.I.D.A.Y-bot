/**
 * study_block.test.js
 * Pruebas unitarias del bloque 2 del roadmap de 50 funciones:
 * planificador de estudio (nº 5) y flashcards de repaso espaciado (nº 6).
 * Fechas en Europe/Madrid (convencion del repo), recordatorios solo con
 * hora elegida por el propietario, repaso proactivo solo con opt-in.
 * Almacenamiento temporal y efectos inyectados: sin red ni efectos.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

import {
  crearPlanEstudio,
  listarPlanes,
  registrarAvance,
  resumenPlan,
  repartirTemario,
  programarRecordatoriosPlan,
  msParedAZulu,
  hoyEnZona
} from '../../src/services/studyPlannerService.js';
import {
  agregarFlashcard,
  pendientesDeRepaso,
  registrarRespuesta,
  listarFlashcards,
  resumenFlashcards,
  lanzarRondaRepaso,
  configurarRepaso,
  iniciarMonitorFlashcards,
  detenerMonitorFlashcards
} from '../../src/services/flashcardService.js';

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'davis-study-'));
}

function depsPlan(dir, extra = {}) {
  return {
    rutaArchivo: path.join(dir, 'plans.json'),
    crearRecordatorio: (r) => { (depsPlan._rec = depsPlan._rec || []).push(r); return { ok: true }; },
    ...extra
  };
}

function depsFlash(dir, extra = {}) {
  return {
    rutaArchivo: path.join(dir, 'flash.json'),
    rutaConfig: path.join(dir, 'flash_config.json'),
    ...extra
  };
}

// ---------- Zona horaria ----------

test('Zona horaria: fechas en Europe/Madrid, no UTC del host', () => {
  // 2026-11-05T23:30Z ya es 2026-11-06 en Madrid (CET, UTC+1)
  assert.equal(hoyEnZona({ hoy: new Date('2026-11-05T23:30:00Z') }), '2026-11-06');
  assert.equal(hoyEnZona({ hoy: new Date('2026-11-05T22:30:00Z') }), '2026-11-05');
});

test('Zona horaria: horas de pared correctas en invierno y verano (DST)', () => {
  // Invierno (CET, UTC+1): 18:00 Madrid = 17:00Z
  assert.equal(msParedAZulu('2026-01-15', '18:00'), Date.parse('2026-01-15T17:00:00Z'));
  // Verano (CEST, UTC+2): 18:00 Madrid = 16:00Z. El 2026-03-30 ya es CEST
  // (el cambio fue el 29-03-2026 a las 02:00): cubre el borde DST.
  assert.equal(msParedAZulu('2026-03-30', '18:00'), Date.parse('2026-03-30T16:00:00Z'));
  // Cambio de octubre: 2026-10-25 vuelve a CET; 2026-10-26 18:00 = 17:00Z
  assert.equal(msParedAZulu('2026-10-26', '18:00'), Date.parse('2026-10-26T17:00:00Z'));
});

// ---------- Planificador ----------

test('Planificador: sin hora no crea recordatorios y lo dice claro', () => {
  const deps = depsPlan(dirTemporal(), { hoy: new Date('2026-11-05T10:00:00Z') });
  const res = crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-09', temas: ['T1', 'T2'] }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.recordatorios, 0, 'ningun recordatorio sin hora elegida');
  assert.match(res.aviso, /dime a que hora/i);
  assert.equal(res.plan.horaEstudio, null);
});

test('Planificador: con hora elegida crea un recordatorio por sesion en su hora', () => {
  const dir = dirTemporal();
  const recordatorios = [];
  const deps = {
    rutaArchivo: path.join(dir, 'plans.json'),
    hoy: new Date('2026-11-05T10:00:00Z'),
    crearRecordatorio: (r) => { recordatorios.push(r); return { ok: true }; }
  };
  const res = crearPlanEstudio({
    asignatura: 'Redes',
    fechaExamen: '2026-11-09',
    temas: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
    horaEstudio: '17:30'
  }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.plan.entradas.length, 4, '3 dias de estudio + 1 repaso');
  assert.equal(res.plan.entradas[3].tipo, 'repaso');
  assert.deepEqual(res.plan.entradas[0].temas, ['T1', 'T2']);
  assert.equal(res.recordatorios, 4);
  // El primer recordatorio cae el 2026-11-05 a las 17:30 Madrid (CET = 16:30Z)
  const esperadoMs = Date.parse('2026-11-05T16:30:00Z');
  const ahoraMs = new Date('2026-11-05T10:00:00Z').getTime();
  assert.equal(ahoraMs + recordatorios[0].minutosEnElFuturo * 60000, esperadoMs);
  assert.ok(recordatorios[0].mensaje.includes('Redes'));
});

test('Planificador: validaciones (fecha pasada, formato, temas, hora)', () => {
  const deps = depsPlan(dirTemporal(), { hoy: new Date('2026-11-05T10:00:00Z') });
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-01', temas: ['T1'] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: 'el lunes', temas: ['T1'] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-09', temas: [] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: '', fechaExamen: '2026-11-09', temas: ['T1'] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-09', temas: ['T1'], horaEstudio: '25:99' }, deps).ok, false);
  // Examen hoy: una sola sesion hoy, sin romper
  const hoy = crearPlanEstudio({ asignatura: 'Redes', fechaExamen: hoyEnZona({ hoy: new Date('2026-11-05T10:00:00Z') }), temas: ['T1'] }, deps);
  assert.equal(hoy.ok, true);
  assert.equal(hoy.plan.entradas.length, 1);
});

test('Planificador: plan duplicado no duplica ni crea recordatorios', () => {
  const dir = dirTemporal();
  const recordatorios = [];
  const deps = {
    rutaArchivo: path.join(dir, 'plans.json'),
    hoy: new Date('2026-11-05T10:00:00Z'),
    crearRecordatorio: (r) => { recordatorios.push(r); return { ok: true }; }
  };
  const args = { asignatura: 'Redes', fechaExamen: '2026-11-09', temas: ['T1'], horaEstudio: '18:00' };
  assert.equal(crearPlanEstudio(args, deps).ok, true);
  assert.equal(recordatorios.length, 2);
  const dup = crearPlanEstudio(args, deps);
  assert.equal(dup.ok, false);
  assert.ok(dup.existente, 'devuelve el plan existente');
  assert.equal(recordatorios.length, 2, 'reintento sin recordatorios duplicados');
});

test('Planificador: programarRecordatoriosPlan una sola vez y a la hora elegida', () => {
  const dir = dirTemporal();
  const recordatorios = [];
  const deps = {
    rutaArchivo: path.join(dir, 'plans.json'),
    hoy: new Date('2026-11-05T10:00:00Z'),
    crearRecordatorio: (r) => { recordatorios.push(r); return { ok: true }; }
  };
  crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-08', temas: ['T1'] }, deps);
  assert.equal(recordatorios.length, 0);

  const res = programarRecordatoriosPlan('redes', '17:30', deps);
  assert.equal(res.ok, true);
  assert.equal(res.recordatorios, 2);
  const esperadoMs = Date.parse('2026-11-05T16:30:00Z');
  assert.equal(new Date('2026-11-05T10:00:00Z').getTime() + recordatorios[0].minutosEnElFuturo * 60000, esperadoMs);

  assert.equal(programarRecordatoriosPlan('redes', '19:00', deps).ok, false, 'no se reprograma ni duplica');
  assert.equal(recordatorios.length, 2);
  assert.equal(programarRecordatoriosPlan('redes', '99:99', deps).ok, false);
});

test('Planificador: avance por orden y por fecha, ambiguedad y resumen', () => {
  const deps = depsPlan(dirTemporal(), { hoy: new Date('2026-11-05T10:00:00Z') });
  crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-08', temas: ['T1', 'T2'] }, deps);
  crearPlanEstudio({ asignatura: 'Sistemas', fechaExamen: '2026-11-10', temas: ['S1'] }, deps);

  const avance = registrarAvance('redes', {}, deps);
  assert.equal(avance.ok, true);
  assert.equal(avance.entrada.fecha, '2026-11-05');

  assert.equal(registrarAvance('redes', { fecha: '2026-11-06' }, deps).ok, true);
  assert.equal(registrarAvance('redes', { fecha: '2026-11-06' }, deps).ok, false, 'ya completada');

  const resumen = resumenPlan('redes', deps);
  assert.equal(resumen.completadas, 2);
  assert.equal(resumen.total, 3);

  registrarAvance('redes', {}, deps);
  assert.equal(registrarAvance('redes', {}, deps).ok, false, 'plan agotado');

  crearPlanEstudio({ asignatura: 'Redes II', fechaExamen: '2026-11-12', temas: ['X'] }, deps);
  const ambiguo = registrarAvance('redes', {}, deps);
  assert.equal(ambiguo.ok, false);
  assert.equal(ambiguo.coincidencias.length, 2);
  const planes = listarPlanes(deps);
  const redes1 = planes.find((p) => p.asignatura === 'Redes');
  assert.equal(resumenPlan(redes1.id, deps).ok, true);
});

test('Planificador: repartirTemario con pocos dias y muchos temas', () => {
  assert.equal(repartirTemario(['A', 'B'], 1).length, 1);
  const dos = repartirTemario(['A', 'B', 'C'], 2);
  assert.equal(dos.length, 2);
  assert.equal(dos[1].tipo, 'repaso');
});

// ---------- Flashcards ----------

test('Flashcards: crear, dedupe y pendientes inmediatas', () => {
  const deps = depsFlash(dirTemporal(), { ahora: new Date('2026-11-05T10:00:00Z') });
  const r = agregarFlashcard({ asignatura: 'Redes', pregunta: 'Que es TCP?', respuesta: 'Protocolo fiable orientado a conexion' }, deps);
  assert.equal(r.ok, true);
  assert.equal(agregarFlashcard({ asignatura: 'redes', pregunta: 'que es tcp?', respuesta: 'otra' }, deps).ok, false);
  const pendientes = pendientesDeRepaso({}, deps);
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].id, r.tarjeta.id);
});

test('Flashcards: acierto espacia, fallo vuelve pronto, no se califica dos veces', () => {
  const deps = depsFlash(dirTemporal(), { ahora: new Date('2026-11-05T10:00:00Z') });
  const { tarjeta } = agregarFlashcard({ asignatura: 'Redes', pregunta: 'P1', respuesta: 'R1' }, deps);

  const acierto = registrarRespuesta(tarjeta.id, 4, deps);
  assert.equal(acierto.acierto, true);
  assert.equal(acierto.tarjeta.repaso.intervaloDias, 1);

  // Repetir la respuesta de la MISMA revision: rechazada, no recalcula
  const repetida = registrarRespuesta(tarjeta.id, 0, deps);
  assert.equal(repetida.ok, false);
  assert.match(repetida.error, /no toca ahora/);
  assert.equal(registrarRespuesta(tarjeta.id, 4, deps).tarjeta === undefined, true);

  // Al dia siguiente toca; fallo -> vuelve en 12h con facilidad reducida
  deps.ahora = new Date('2026-11-06T10:00:00Z');
  const fallo = registrarRespuesta(tarjeta.id, 1, deps);
  assert.equal(fallo.acierto, false);
  assert.equal(fallo.tarjeta.repaso.intervaloDias, 0.5);
  assert.equal(fallo.tarjeta.repaso.facilidad, 2.4, '2.5 + 0.1 (acierto) - 0.2 (fallo)');
  deps.ahora = new Date('2026-11-06T12:00:00Z');
  assert.equal(pendientesDeRepaso({}, deps).length, 0);
  deps.ahora = new Date('2026-11-06T23:00:00Z');
  assert.equal(pendientesDeRepaso({}, deps).length, 1);

  registrarRespuesta(tarjeta.id, 5, deps);
  deps.ahora = new Date('2026-11-07T23:00:00Z');
  const segundo = registrarRespuesta(tarjeta.id, 5, deps);
  assert.equal(segundo.tarjeta.repaso.intervaloDias, 3, '1 * 2.5 redondeado');

  assert.equal(registrarRespuesta(tarjeta.id, 9, deps).ok, false);
  assert.equal(registrarRespuesta('noexiste', 3, deps).ok, false);
});

test('Flashcards: ronda proactiva desactivada sin opt-in, activa con el', () => {
  const dir = dirTemporal();
  const alertas = [];
  const deps = depsFlash(dir, { ahora: new Date('2026-11-05T10:00:00Z'), enqueue: (a) => alertas.push(a) });
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P1', respuesta: 'R1' }, deps);

  let ronda = lanzarRondaRepaso(deps);
  assert.equal(ronda.encoladas, 0, 'sin opt-in no hay rondas');
  assert.match(ronda.motivo, /desactivado/i);
  assert.equal(alertas.length, 0);

  const cfg = configurarRepaso({ activo: true }, deps);
  assert.equal(cfg.ok, true);
  ronda = lanzarRondaRepaso(deps);
  assert.equal(ronda.encoladas, 1);
  assert.equal(alertas.length, 1);
});

test('Flashcards: cadencia y horario de silencio limitan las rondas', () => {
  const dir = dirTemporal();
  const alertas = [];
  const deps = depsFlash(dir, { ahora: new Date('2026-11-05T10:00:00Z'), enqueue: (a) => alertas.push(a) });
  for (let i = 0; i < 5; i++) agregarFlashcard({ asignatura: 'Redes', pregunta: `P${i}`, respuesta: `R${i}` }, deps);
  configurarRepaso({ activo: true, cadenciaHoras: 4, silencioDesde: 22, silencioHasta: 8 }, deps);

  // 10:00Z = 11:00 Madrid: fuera de silencio
  assert.equal(lanzarRondaRepaso(deps).encoladas, 3, 'maximo 3 por ronda');
  // Cadencia: una ronda inmediata no repite
  assert.equal(lanzarRondaRepaso(deps).encoladas, 0);
  assert.equal(alertas.length, 3);
  // Pasada la cadencia salen las 2 restantes
  deps.ahora = new Date('2026-11-05T14:30:00Z');
  assert.equal(lanzarRondaRepaso(deps).encoladas, 2);
  // Silencio: 23:00 Madrid = 22:00Z
  deps.ahora = new Date('2026-11-05T22:30:00Z');
  const rondaNoche = lanzarRondaRepaso(deps);
  assert.equal(rondaNoche.encoladas, 0);
  assert.match(rondaNoche.motivo, /silencio/i);
});

test('Flashcards: reinicio del monitor no duplica avisos de la misma revision', () => {
  const dir = dirTemporal();
  const alertas = [];
  const deps = depsFlash(dir, { ahora: new Date('2026-11-05T10:00:00Z'), enqueue: (a) => alertas.push(a), intervaloMs: 3600000 });
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P', respuesta: 'R' }, deps);

  // Sin opt-in el monitor no arranca aunque haya tarjetas
  assert.equal(iniciarMonitorFlashcards(deps).iniciado, false);

  configurarRepaso({ activo: true }, deps);
  assert.equal(iniciarMonitorFlashcards(deps).iniciado, true);
  detenerMonitorFlashcards();
  assert.equal(iniciarMonitorFlashcards(deps).iniciado, true, 'reinicio');
  detenerMonitorFlashcards();

  lanzarRondaRepaso(deps);
  lanzarRondaRepaso({ ...deps, ahora: new Date('2026-11-05T15:00:00Z') });
  assert.equal(alertas.length, 1, 'misma revision, un solo aviso aunque haya reinicios');
});

test('Flashcards: configurarRepaso valida rangos', () => {
  const deps = depsFlash(dirTemporal());
  assert.equal(configurarRepaso({ cadenciaHoras: 0 }, deps).ok, false);
  assert.equal(configurarRepaso({ cadenciaHoras: 30 }, deps).ok, false);
  assert.equal(configurarRepaso({ silencioDesde: 24 }, deps).ok, false);
  assert.equal(configurarRepaso({ cadenciaHoras: 6 }, deps).ok, true);
});

test('Flashcards: listar filtra por asignatura y resumen cuenta pendientes', () => {
  const deps = depsFlash(dirTemporal(), { ahora: new Date('2026-11-05T10:00:00Z') });
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P1', respuesta: 'R1' }, deps);
  agregarFlashcard({ asignatura: 'Sistemas', pregunta: 'P2', respuesta: 'R2' }, deps);
  assert.equal(listarFlashcards({ asignatura: 'redes' }, deps).length, 1);
  const resumen = resumenFlashcards(deps);
  assert.equal(resumen.total, 2);
  assert.equal(resumen.pendientes, 2);
});

test('Planificador/flashcards: aislamiento entre almacenes', () => {
  const dirA = dirTemporal();
  const dirB = dirTemporal();
  const depsA = depsFlash(dirA, { ahora: new Date() });
  const depsB = depsFlash(dirB, { ahora: new Date() });
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P', respuesta: 'R' }, depsA);
  assert.equal(listarFlashcards({}, depsB).length, 0);
  assert.equal(listarFlashcards({}, depsA).length, 1);
});
