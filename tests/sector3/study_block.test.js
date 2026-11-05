/**
 * study_block.test.js
 * Pruebas unitarias del bloque 2 del roadmap de 50 funciones:
 * planificador de estudio (nº 5) y flashcards de repaso espaciado (nº 6).
 * Almacenamiento temporal y recordatorios/alertas inyectados: sin efectos.
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
  repartirTemario
} from '../../src/services/studyPlannerService.js';
import {
  agregarFlashcard,
  pendientesDeRepaso,
  registrarRespuesta,
  listarFlashcards,
  resumenFlashcards,
  lanzarRondaRepaso,
  iniciarMonitorFlashcards,
  detenerMonitorFlashcards
} from '../../src/services/flashcardService.js';

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'davis-study-'));
}

// ---------- Planificador ----------

test('Planificador: reparte temas con ultimo dia de repaso y programa recordatorios', () => {
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
    temas: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']
  }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.plan.entradas.length, 4, '4 dias: 3 de estudio + 1 repaso');
  assert.equal(res.plan.entradas[3].tipo, 'repaso');
  assert.deepEqual(res.plan.entradas[0].temas, ['T1', 'T2']);
  assert.equal(res.recordatorios, 4, 'un recordatorio por sesion');
  assert.ok(recordatorios[0].mensaje.includes('Redes'));
  assert.ok(recordatorios[0].mensaje.includes('2026-11-09'));
  const guardados = JSON.parse(fs.readFileSync(path.join(dir, 'plans.json'), 'utf-8'));
  assert.equal(guardados.length, 1);
});

test('Planificador: validaciones (fecha pasada, formato, temas vacios)', () => {
  const deps = { rutaArchivo: path.join(dirTemporal(), 'plans.json'), hoy: new Date('2026-11-05T10:00:00Z'), crearRecordatorio: () => ({ ok: true }) };
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-01', temas: ['T1'] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: 'el lunes', temas: ['T1'] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-09', temas: [] }, deps).ok, false);
  assert.equal(crearPlanEstudio({ asignatura: '', fechaExamen: '2026-11-09', temas: ['T1'] }, deps).ok, false);
  // Examen hoy: una sola sesion hoy, sin romper
  const hoy = crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-05', temas: ['T1'] }, deps);
  assert.equal(hoy.ok, true);
  assert.equal(hoy.plan.entradas.length, 1);
});

test('Planificador: repartirTemario con pocos dias y muchos temas', () => {
  assert.equal(repartirTemario(['A', 'B'], 1).length, 1, 'un dia: todo junto, sin repaso aparte');
  const dos = repartirTemario(['A', 'B', 'C'], 2);
  assert.equal(dos.length, 2);
  assert.equal(dos[1].tipo, 'repaso');
});

test('Planificador: avance por orden y por fecha, ambiguedad y resumen', () => {
  const deps = { rutaArchivo: path.join(dirTemporal(), 'plans.json'), hoy: new Date('2026-11-05T10:00:00Z'), crearRecordatorio: () => ({ ok: true }) };
  crearPlanEstudio({ asignatura: 'Redes', fechaExamen: '2026-11-08', temas: ['T1', 'T2'] }, deps);
  crearPlanEstudio({ asignatura: 'Sistemas', fechaExamen: '2026-11-10', temas: ['S1'] }, deps);

  const avance = registrarAvance('redes', {}, deps);
  assert.equal(avance.ok, true);
  assert.equal(avance.entrada.fecha, '2026-11-05', 'primera pendiente por orden');

  const porFecha = registrarAvance('redes', { fecha: '2026-11-06' }, deps);
  assert.equal(porFecha.ok, true);
  assert.equal(registrarAvance('redes', { fecha: '2026-11-06' }, deps).ok, false, 'ya completada');

  const resumen = resumenPlan('redes', deps);
  assert.equal(resumen.completadas, 2);
  assert.equal(resumen.total, 3);

  // Completar el resto y agotar el plan
  registrarAvance('redes', {}, deps);
  assert.equal(registrarAvance('redes', {}, deps).ok, false, 'plan agotado');

  // Ambiguedad por texto parcial
  crearPlanEstudio({ asignatura: 'Redes II', fechaExamen: '2026-11-12', temas: ['X'] }, deps);
  const ambiguo = registrarAvance('redes', {}, deps);
  assert.equal(ambiguo.ok, false);
  assert.equal(ambiguo.coincidencias.length, 2);
  // Por ID resuelve la ambiguedad
  const planes = listarPlanes(deps);
  const redes1 = planes.find((p) => p.asignatura === 'Redes');
  assert.equal(resumenPlan(redes1.id, deps).ok, true);
});

// ---------- Flashcards ----------

test('Flashcards: crear, dedupe y pendientes inmediatas', () => {
  const deps = { rutaArchivo: path.join(dirTemporal(), 'flash.json'), ahora: new Date('2026-11-05T10:00:00Z') };
  const r = agregarFlashcard({ asignatura: 'Redes', pregunta: 'Que es TCP?', respuesta: 'Protocolo fiable orientado a conexion' }, deps);
  assert.equal(r.ok, true);
  assert.equal(agregarFlashcard({ asignatura: 'redes', pregunta: 'que es tcp?', respuesta: 'otra' }, deps).ok, false, 'dedupe por pregunta+asignatura');

  const pendientes = pendientesDeRepaso({}, deps);
  assert.equal(pendientes.length, 1, 'recien creada, toca ya');
  assert.equal(pendientes[0].id, r.tarjeta.id);
});

test('Flashcards: acierto espacia, fallo vuelve pronto y baja facilidad', () => {
  const deps = { rutaArchivo: path.join(dirTemporal(), 'flash.json'), ahora: new Date('2026-11-05T10:00:00Z') };
  const { tarjeta } = agregarFlashcard({ asignatura: 'Redes', pregunta: 'P1', respuesta: 'R1' }, deps);

  const acierto = registrarRespuesta(tarjeta.id, 4, deps);
  assert.equal(acierto.acierto, true);
  assert.equal(acierto.tarjeta.repaso.intervaloDias, 1);
  assert.equal(pendientesDeRepaso({}, deps).length, 0, 'ya no toca hoy');

  // Avanza el reloj 1 dia: toca de nuevo; fallo -> vuelve en 12h
  deps.ahora = new Date('2026-11-06T10:00:00Z');
  assert.equal(pendientesDeRepaso({}, deps).length, 1);
  const fallo = registrarRespuesta(tarjeta.id, 1, deps);
  assert.equal(fallo.acierto, false);
  assert.equal(fallo.tarjeta.repaso.intervaloDias, 0.5);
  assert.equal(fallo.tarjeta.repaso.facilidad, 2.4, '2.5 + 0.1 (acierto) - 0.2 (fallo)');
  deps.ahora = new Date('2026-11-06T12:00:00Z');
  assert.equal(pendientesDeRepaso({}, deps).length, 0, 'aun no pasaron 12h');
  deps.ahora = new Date('2026-11-06T23:00:00Z');
  assert.equal(pendientesDeRepaso({}, deps).length, 1, 'pasadas 12h toca');

  // Segundo acierto tras fallo: intervalo crece con facilidad reducida
  registrarRespuesta(tarjeta.id, 5, deps);
  deps.ahora = new Date('2026-11-07T23:00:00Z');
  const segundo = registrarRespuesta(tarjeta.id, 5, deps);
  assert.equal(segundo.tarjeta.repaso.intervaloDias, 3, '1 * 2.5 (facilidad tras segundo acierto) redondeado');

  assert.equal(registrarRespuesta(tarjeta.id, 9, deps).ok, false, 'calidad fuera de rango');
  assert.equal(registrarRespuesta('noexiste', 3, deps).ok, false);
});

test('Flashcards: ronda de repaso encola sin duplicar y respeta maximo', () => {
  const dir = dirTemporal();
  const alertas = [];
  const deps = { rutaArchivo: path.join(dir, 'flash.json'), ahora: new Date('2026-11-05T10:00:00Z'), enqueue: (a) => alertas.push(a) };
  for (let i = 0; i < 5; i++) {
    agregarFlashcard({ asignatura: 'Redes', pregunta: `P${i}`, respuesta: `R${i}` }, deps);
  }
  const ronda1 = lanzarRondaRepaso(deps);
  assert.equal(ronda1.encoladas, 3, 'maximo 3 por ronda');
  assert.equal(alertas.length, 3);
  assert.match(alertas[0].title, /Repaso de Redes/);
  assert.match(alertas[0].details, /Tarjeta ID:/);

  const ronda2 = lanzarRondaRepaso(deps);
  assert.equal(ronda2.encoladas, 2, 'salen las 2 pendientes que no cabian en la primera ronda');
  assert.equal(alertas.length, 5);
  const ronda2b = lanzarRondaRepaso(deps);
  assert.equal(ronda2b.encoladas, 0, 'misma revision ya alertada: no duplica');
  assert.equal(alertas.length, 5);

  // Responder una la hace elegible para su proxima revision
  const pendiente = pendientesDeRepaso({}, deps)[0];
  registrarRespuesta(pendiente.id, 1, deps);
  deps.ahora = new Date('2026-11-05T23:00:00Z');
  const ronda3 = lanzarRondaRepaso(deps);
  assert.equal(ronda3.encoladas, 1, 'la fallada vuelve a salir');
});

test('Flashcards: monitor no arranca sin tarjetas y si con ellas', () => {
  const dir = dirTemporal();
  const deps = { rutaArchivo: path.join(dir, 'flash.json'), intervaloMs: 3600000 };
  let res = iniciarMonitorFlashcards(deps);
  assert.equal(res.iniciado, false, 'sin tarjetas no hay monitor');
  agregarFlashcard({ asignatura: 'X', pregunta: 'P', respuesta: 'R' }, deps);
  res = iniciarMonitorFlashcards(deps);
  assert.equal(res.iniciado, true);
  detenerMonitorFlashcards();
  res = iniciarMonitorFlashcards(deps);
  assert.equal(res.iniciado, true, 'reinicio tras detener');
  detenerMonitorFlashcards();
});

test('Flashcards: listar filtra por asignatura y resumen cuenta pendientes', () => {
  const deps = { rutaArchivo: path.join(dirTemporal(), 'flash.json'), ahora: new Date('2026-11-05T10:00:00Z') };
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P1', respuesta: 'R1' }, deps);
  agregarFlashcard({ asignatura: 'Sistemas', pregunta: 'P2', respuesta: 'R2' }, deps);
  assert.equal(listarFlashcards({ asignatura: 'redes' }, deps).length, 1);
  const resumen = resumenFlashcards(deps);
  assert.equal(resumen.total, 2);
  assert.equal(resumen.pendientes, 2);
  assert.equal(resumen.porAsignatura.Redes, 1);
});

test('Planificador/flashcards: aislamiento entre almacenes', () => {
  const dirA = dirTemporal();
  const dirB = dirTemporal();
  const depsA = { rutaArchivo: path.join(dirA, 'flash.json'), ahora: new Date() };
  const depsB = { rutaArchivo: path.join(dirB, 'flash.json'), ahora: new Date() };
  agregarFlashcard({ asignatura: 'Redes', pregunta: 'P', respuesta: 'R' }, depsA);
  assert.equal(listarFlashcards({}, depsB).length, 0);
  assert.equal(listarFlashcards({}, depsA).length, 1);
});
