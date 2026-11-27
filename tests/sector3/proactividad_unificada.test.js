/**
 * proactividad_unificada.test.js - Pruebas unitarias de puntos 4.5 y 4.6
 *
 * Cubre:
 * - Check-in nocturno opt-in de habitos pendientes (habitsService.js)
 * - Alertas proximas <=48h / <=24h de entregas (deadlinesService.js)
 * - Recordatorios recurrentes diario/semanal/mensual sin duplicados (reminderService.js)
 * - Monitor proactivo de transporte diario opt-in y ruido cero (transportProactiveService.js)
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-proactividad-'));
process.env.DAVIS_DATA_DIR = dirTemp;
process.env.NODE_ENV = 'test';
delete process.env.DAVIS_HABITS_CHECKIN_NOCTURNO;
delete process.env.DAVIS_DEADLINES_ALERTAS;
delete process.env.DAVIS_TRANSPORTE_PROACTIVO;
delete process.env.DAVIS_EMT_CLIENT_ID;
delete process.env.DAVIS_EMT_PASS_KEY;

const {
  registrarHabito,
  marcarHabito,
  configurarCheckInNocturno,
  evaluarCheckInHabitosPendientes
} = await import('../../src/services/habitsService.js');

const {
  registrarEntrega,
  configurarAlertasEntregas,
  evaluarAlertasEntregas
} = await import('../../src/services/deadlinesService.js');

const {
  crearRecordatorio,
  listarRecordatorios,
  cancelarRecordatorio,
  despacharRecordatoriosPendientes
} = await import('../../src/services/reminderService.js');

const { registrarParadaFavorita } = await import('../../src/services/transportService.js');
const { registrarActividadRutina } = await import('../../src/services/habitPatternPredictorService.js');
const {
  configurarMonitorTransporteProactivo,
  evaluarMonitorTransporteProactivo
} = await import('../../src/services/transportProactiveService.js');

const REGEX_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// --- 4.5.1 Habitos: check-in nocturno opt-in ---

test('Habitos: check-in nocturno desactivado por defecto (opt-in)', () => {
  const ruta = path.join(dirTemp, 'habitos-optin.json');
  registrarHabito({ nombre: 'Leer 20 minutos' }, { rutaArchivo: ruta });

  const res = evaluarCheckInHabitosPendientes(new Date('2026-11-27T21:30:00+01:00'), { rutaArchivo: ruta });
  assert.equal(res.ok, true);
  assert.equal(res.avisar, false);
  assert.equal(res.motivo, 'desactivado');
});

test('Habitos: check-in nocturno respeta horario, pendientes y no duplica en el mismo dia', () => {
  const ruta = path.join(dirTemp, 'habitos-flujo.json');
  registrarHabito({ nombre: 'Leer 20 minutos' }, { rutaArchivo: ruta });
  registrarHabito({ nombre: 'Estirar' }, { rutaArchivo: ruta });
  configurarCheckInNocturno({ activo: true, horaDesde: 20 }, { rutaArchivo: ruta });

  // Fuera de horario (15:00 Madrid)
  const tarde = evaluarCheckInHabitosPendientes(new Date('2026-11-27T15:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(tarde.avisar, false);
  assert.equal(tarde.motivo, 'fuera_de_horario');

  // En horario nocturno (21:30 Madrid) con ambos pendientes
  const noche = evaluarCheckInHabitosPendientes(new Date('2026-11-27T21:30:00+01:00'), { rutaArchivo: ruta });
  assert.equal(noche.avisar, true);
  assert.equal(noche.pendientes.length, 2);
  assert.match(noche.mensaje, /Leer 20 minutos/);
  assert.match(noche.mensaje, /Estirar/);
  assert.equal(REGEX_EMOJI.test(noche.mensaje), false);

  // Segunda evaluacion el mismo dia no duplica aviso
  const repeticion = evaluarCheckInHabitosPendientes(new Date('2026-11-27T22:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(repeticion.avisar, false);
  assert.equal(repeticion.motivo, 'ya_notificado_hoy');

  // Al dia siguiente, si ya estan todos marcados, no avisa
  marcarHabito({ criterio: 'Leer', fecha: '2026-11-28' }, { rutaArchivo: ruta });
  marcarHabito({ criterio: 'Estirar', fecha: '2026-11-28' }, { rutaArchivo: ruta });
  const diaSig = evaluarCheckInHabitosPendientes(new Date('2026-11-28T21:15:00+01:00'), { rutaArchivo: ruta });
  assert.equal(diaSig.avisar, false);
  assert.equal(diaSig.motivo, 'sin_pendientes');
});

// --- 4.5.2 Entregas: alertas proximas <=48h / <=24h ---

test('Entregas: alertas desactivadas por defecto (opt-in)', () => {
  const ruta = path.join(dirTemp, 'entregas-optin.json');
  registrarEntrega({ titulo: 'Practica Redes', fecha: '2026-11-28', tipo: 'entrega' }, { rutaArchivo: ruta });

  const res = evaluarAlertasEntregas(new Date('2026-11-27T10:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(res.avisar, false);
  assert.equal(res.motivo, 'desactivado');
});

test('Entregas: alertas <=48h y <=24h progresivas sin duplicados', () => {
  const ruta = path.join(dirTemp, 'entregas-flujo.json');
  registrarEntrega({ titulo: 'Examen Calculo', fecha: '2026-11-29', tipo: 'examen' }, { rutaArchivo: ruta });
  registrarEntrega({ titulo: 'Proyecto Lejano', fecha: '2026-12-10', tipo: 'entrega' }, { rutaArchivo: ruta });
  configurarAlertasEntregas({ activo: true }, { rutaArchivo: ruta });

  // A 3 dias: sin alertas
  const d3 = evaluarAlertasEntregas(new Date('2026-11-26T10:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(d3.avisar, false);
  assert.equal(d3.motivo, 'sin_alertas');

  // A 2 dias (48h): avisa una vez
  const d2 = evaluarAlertasEntregas(new Date('2026-11-27T10:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(d2.avisar, true);
  assert.equal(d2.alertas.length, 1);
  assert.equal(d2.alertas[0].umbral, '48h');
  assert.equal(REGEX_EMOJI.test(d2.mensaje), false);

  // Mismo dia: no duplica 48h
  const d2Rep = evaluarAlertasEntregas(new Date('2026-11-27T18:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(d2Rep.avisar, false);

  // A 1 dia (24h): avisa una vez por ventana 24h
  const d1 = evaluarAlertasEntregas(new Date('2026-11-28T09:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(d1.avisar, true);
  assert.equal(d1.alertas.length, 1);
  assert.equal(d1.alertas[0].umbral, '24h');

  // Mismo dia o dia 0: no duplica 24h
  const d0 = evaluarAlertasEntregas(new Date('2026-11-29T08:00:00+01:00'), { rutaArchivo: ruta });
  assert.equal(d0.avisar, false);
});

// --- 4.5.3 Recordatorios recurrentes ---

test('Recordatorios: rechaza recurrencia invalida', () => {
  const ruta = path.join(dirTemp, 'rem-invalid.json');
  const res = crearRecordatorio({ mensaje: 'Prueba', minutosEnElFuturo: 10, recurrencia: 'horaria' }, { rutaArchivo: ruta });
  assert.equal(res.ok, false);
});

test('Recordatorios: recurrencia diaria reprograma siguiente ocurrencia sin duplicar avisos', async () => {
  const ruta = path.join(dirTemp, 'rem-diario.json');
  const notificaciones = [];

  const creado = crearRecordatorio({
    mensaje: 'Tomar vitamina',
    minutosEnElFuturo: 1,
    recurrencia: 'diario'
  }, { rutaArchivo: ruta });
  assert.equal(creado.ok, true);
  assert.equal(creado.recordatorio.recurrencia, 'diario');

  const tsInicial = creado.recordatorio.timestamp;
  const ahora1 = tsInicial + 5000;

  const disp1 = await despacharRecordatoriosPendientes({
    rutaArchivo: ruta,
    ahora: ahora1,
    callbackNotificacion: async (r, txt) => notificaciones.push({ id: r.id, txt })
  });
  assert.equal(disp1.length, 1);
  assert.equal(notificaciones.length, 1);

  // Re-ejecutar inmediatamente no duplica
  const dispRep = await despacharRecordatoriosPendientes({
    rutaArchivo: ruta,
    ahora: ahora1 + 1000,
    callbackNotificacion: async (r, txt) => notificaciones.push({ id: r.id, txt })
  });
  assert.equal(dispRep.length, 0);
  assert.equal(notificaciones.length, 1);

  // Debe existir 1 pendiente reprogramado (~24h despues)
  const pendientes = listarRecordatorios(true, { rutaArchivo: ruta });
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].recurrencia, 'diario');
  const diffHoras = (pendientes[0].timestamp - tsInicial) / (3600 * 1000);
  assert.ok(diffHoras >= 23 && diffHoras <= 25);

  // Al llegar la siguiente ocurrencia, se dispara y vuelve a reprogramar
  const disp2 = await despacharRecordatoriosPendientes({
    rutaArchivo: ruta,
    ahora: pendientes[0].timestamp + 2000,
    callbackNotificacion: async (r, txt) => notificaciones.push({ id: r.id, txt })
  });
  assert.equal(disp2.length, 1);
  assert.equal(notificaciones.length, 2);
  assert.equal(listarRecordatorios(true, { rutaArchivo: ruta }).length, 1);
});

test('Recordatorios: recurrencia semanal y mensual avanzan correctamente', async () => {
  const ruta = path.join(dirTemp, 'rem-sem-mes.json');

  const sem = crearRecordatorio({ mensaje: 'Revision semanal', minutosEnElFuturo: 1, recurrencia: 'semanal' }, { rutaArchivo: ruta });
  const mes = crearRecordatorio({ mensaje: 'Pago alquiler', minutosEnElFuturo: 1, recurrencia: 'mensual' }, { rutaArchivo: ruta });
  const ahora = Math.max(sem.recordatorio.timestamp, mes.recordatorio.timestamp) + 5000;

  const disp = await despacharRecordatoriosPendientes({ rutaArchivo: ruta, ahora });
  assert.equal(disp.length, 2);

  const pendientes = listarRecordatorios(true, { rutaArchivo: ruta });
  assert.equal(pendientes.length, 2);

  const pSem = pendientes.find((p) => p.mensaje === 'Revision semanal');
  const pMes = pendientes.find((p) => p.mensaje === 'Pago alquiler');
  assert.ok(pSem && pMes);

  const diasSem = Math.round((pSem.timestamp - sem.recordatorio.timestamp) / 86400000);
  const diasMes = Math.round((pMes.timestamp - mes.recordatorio.timestamp) / 86400000);
  assert.equal(diasSem, 7);
  assert.ok(diasMes >= 28 && diasMes <= 31);

  // Cancelar detiene la cadena
  cancelarRecordatorio('Revision semanal', { rutaArchivo: ruta });
  assert.equal(listarRecordatorios(true, { rutaArchivo: ruta }).length, 1);
});

// --- 4.6 Monitor proactivo de transporte diario ---

test('Transporte proactivo: desactivado por defecto (opt-in)', async () => {
  const rutaTransp = path.join(dirTemp, 'transporte-optin.json');
  const rutaEstado = path.join(dirTemp, 'transporte-estado-optin.json');
  await registrarParadaFavorita({ nombre: 'Atocha', tipo: 'cercanias', codigo: '17000' }, { rutaArchivo: rutaTransp });

  const res = await evaluarMonitorTransporteProactivo(new Date('2026-11-27T08:30:00+01:00'), {
    rutaTransporte: rutaTransp,
    rutaEstado
  });
  assert.equal(res.avisar, false);
  assert.equal(res.motivo, 'desactivado');
});

test('Transporte proactivo: ruido cero en operacion normal y fuera de franja habitual', async () => {
  const rutaTransp = path.join(dirTemp, 'transporte-normal.json');
  const rutaEstado = path.join(dirTemp, 'transporte-estado-normal.json');
  const rutaRutinas = path.join(dirTemp, 'routines-normal.json');

  await registrarParadaFavorita({ nombre: 'Atocha', tipo: 'cercanias', codigo: '17000' }, { rutaArchivo: rutaTransp });
  configurarMonitorTransporteProactivo({
    activo: true,
    umbralRetrasoMin: 5,
    franjasConfiguradas: ['08-10']
  }, { rutaEstado });

  // Fuera de franja 08-10 (14:00 Madrid)
  const fuera = await evaluarMonitorTransporteProactivo(new Date('2026-11-27T14:00:00+01:00'), {
    rutaTransporte: rutaTransp,
    rutaEstado,
    rutaArchivo: rutaRutinas
  });
  assert.equal(fuera.avisar, false);
  assert.equal(fuera.motivo, 'fuera_de_franja_habitual');

  // En franja 08-10, pero retraso menor al umbral (2 min < 5 min) -> ruido cero
  const ahora = new Date('2026-11-27T08:30:00+01:00');
  const fetchNormal = async () => ({
    text: async () => JSON.stringify({
      entity: [{
        id: 'TU-OK',
        tripUpdate: {
          trip: { tripId: 'C3-100', scheduleRelationship: 'SCHEDULED' },
          stopTimeUpdate: [
            { stopId: '17000', arrival: { delay: 120, time: Math.floor(ahora.getTime() / 1000) + 300 } }
          ]
        }
      }]
    })
  });

  const normal = await evaluarMonitorTransporteProactivo(ahora, {
    rutaTransporte: rutaTransp,
    rutaEstado,
    rutaArchivo: rutaRutinas,
    fetchFnCercanias: fetchNormal
  });
  assert.equal(normal.avisar, false);
  assert.equal(normal.motivo, 'operacion_normal');
});

test('Transporte proactivo: detecta retrasos/cancelaciones cruzando predictor de rutinas y evita spam', async () => {
  const rutaTransp = path.join(dirTemp, 'transporte-incidencia.json');
  const rutaEstado = path.join(dirTemp, 'transporte-estado-incidencia.json');
  const rutaRutinas = path.join(dirTemp, 'routines-incidencia.json');

  await registrarParadaFavorita({ nombre: 'Atocha', tipo: 'cercanias', codigo: '17000' }, { rutaArchivo: rutaTransp });
  await registrarParadaFavorita({ nombre: 'Casa Bus', tipo: 'emt', codigo: '1234' }, { rutaArchivo: rutaTransp });

  const ahora = new Date('2026-11-27T08:45:00+01:00'); // Franja 08-10
  for (let i = 0; i < 4; i++) {
    registrarActividadRutina({
      intencion: 'transporte',
      herramienta: 'proximas_llegadas_transporte',
      fecha: ahora
    }, { rutaArchivo: rutaRutinas });
  }

  configurarMonitorTransporteProactivo({
    activo: true,
    umbralRetrasoMin: 5,
    usarPredictorRutinas: true
  }, { rutaEstado });

  const fetchIncidencia = async () => ({
    text: async () => JSON.stringify({
      entity: [
        {
          id: 'TU-DEL',
          tripUpdate: {
            trip: { tripId: 'C7-501', scheduleRelationship: 'SCHEDULED' },
            stopTimeUpdate: [
              { stopId: '17000', arrival: { delay: 600, time: Math.floor(ahora.getTime() / 1000) + 900 } }
            ]
          }
        },
        {
          id: 'TU-CAN',
          tripUpdate: {
            trip: { tripId: 'C4-900', scheduleRelationship: 'CANCELED' },
            stopTimeUpdate: [
              { stopId: '17000', arrival: { delay: 0, time: Math.floor(ahora.getTime() / 1000) + 1200 } }
            ]
          }
        }
      ]
    })
  });

  const alerta = await evaluarMonitorTransporteProactivo(ahora, {
    rutaTransporte: rutaTransp,
    rutaEstado,
    rutaArchivo: rutaRutinas,
    fetchFnCercanias: fetchIncidencia
  });

  assert.equal(alerta.avisar, true);
  assert.equal(alerta.motivo, 'incidencia_detectada');
  assert.equal(alerta.franja, '08-10');
  assert.equal(alerta.alertas.length, 2);
  assert.match(alerta.mensaje, /C7-501/);
  assert.match(alerta.mensaje, /C4-900/);
  assert.equal(REGEX_EMOJI.test(alerta.mensaje), false);

  // Repeticion en la misma franja no vuelve a molestar (deduplicacion)
  const repetida = await evaluarMonitorTransporteProactivo(ahora, {
    rutaTransporte: rutaTransp,
    rutaEstado,
    rutaArchivo: rutaRutinas,
    fetchFnCercanias: fetchIncidencia
  });
  assert.equal(repetida.avisar, false);
  assert.equal(repetida.motivo, 'operacion_normal');
});
