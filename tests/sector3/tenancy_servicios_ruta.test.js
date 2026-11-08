/**
 * Servicios con opcion de ruta: lectura, escritura y borrado respetan la ruta
 * inyectada (la que aislarOpcionesTenant fuerza por tenant) en TODAS sus ramas
 * probadas, y nunca caen al fichero global. El directorio de datos por defecto
 * es un centinela vacio: cualquier fichero que aparezca alli es una fuga de ruta.
 * Cobertura: contactos, habitos, compra, quedadas, ideas, snoozes, entregas.
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SENT = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-centinela-'));
process.env.DAVIS_DATA_DIR = SENT;
const RA = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-ta-'));
const RB = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-tb-'));
const dA = (n) => ({ rutaArchivo: path.join(RA, n) });
const dB = (n) => ({ rutaArchivo: path.join(RB, n) });
const vacioCentinela = (donde) => assert.deepEqual(fs.readdirSync(SENT), [], `ningun fichero global tras ${donde}`);
const txt = (x) => JSON.stringify(x);

test('contactos: escribir/leer/buscar por ruta; B no ve A', async () => {
  const S = await import('../../src/services/contactsService.js');
  const r = S.registrarContacto({ nombre: 'Persona-Secreta-A', telefono: '+34600000001', relacion: 'amigo' }, dA('c.json'));
  assert.ok(r.ok, txt(r));
  assert.ok(txt(S.listarContactos(dA('c.json'))).includes('Persona-Secreta-A'));
  assert.ok(!txt(S.listarContactos(dB('c.json'))).includes('Persona-Secreta-A'));
  assert.ok(!txt(S.buscarContacto('Persona-Secreta-A', dB('c.json'))).includes('600000001'));
  vacioCentinela('contactos');
});

test('habitos: alta, marcar y listar por ruta', async () => {
  const S = await import('../../src/services/habitsService.js');
  assert.ok(S.registrarHabito({ nombre: 'Habito-Secreto-A' }, dA('h.json')).ok);
  assert.ok(txt(S.listarHabitos(dA('h.json'))).includes('Habito-Secreto-A'));
  assert.ok(!txt(S.listarHabitos(dB('h.json'))).includes('Habito-Secreto-A'));
  S.marcarHabito({ criterio: 'Habito-Secreto-A' }, dA('h.json'));
  vacioCentinela('habitos');
});

test('compra: anadir, tachar y vaciar solo afectan a su ruta', async () => {
  const S = await import('../../src/services/shoppingService.js');
  S.anadirCompra({ items: ['leche-secreta-A'] }, dA('s.json'));
  S.anadirCompra({ items: ['pan-de-B'] }, dB('s.json'));
  assert.ok(txt(S.listarCompra(dA('s.json'))).includes('leche-secreta-A'));
  assert.ok(!txt(S.listarCompra(dB('s.json'))).includes('leche-secreta-A'));
  S.vaciarCompra(dA('s.json'));
  assert.ok(txt(S.listarCompra(dB('s.json'))).includes('pan-de-B'), 'vaciar A no toca B');
  S.tacharCompra('pan', dB('s.json'));
  vacioCentinela('compra');
});

test('quedadas e ideas por ruta', async () => {
  const Q = await import('../../src/services/quedadasService.js');
  const I = await import('../../src/services/devToolsService.js');
  Q.crearQuedada({ titulo: 'Quedada-Secreta-A', fecha: '2027-01-01', hora: '20:00', lugar: 'x', participantes: ['a'] }, dA('q.json'));
  assert.ok(txt(Q.listarQuedadas(dA('q.json'))).includes('Quedada-Secreta-A'));
  assert.ok(!txt(Q.listarQuedadas(dB('q.json'))).includes('Quedada-Secreta-A'));
  I.anotarIdea({ titulo: 'Idea-Secreta-A', detalle: 'd' }, dA('i.json'));
  assert.ok(txt(I.listarIdeas(dA('i.json'))).includes('Idea-Secreta-A'));
  assert.ok(!txt(I.listarIdeas(dB('i.json'))).includes('Idea-Secreta-A'));
  vacioCentinela('quedadas/ideas');
});

test('snoozes y entregas: alta, listado y baja por ruta', async () => {
  const Z = await import('../../src/services/snoozeService.js');
  const D = await import('../../src/services/deadlinesService.js');
  const s = Z.programarSnooze({ chatId: 'chat-a', minutos: 30, nota: 'nota-secreta-A' }, dA('z.json'));
  assert.ok(s.ok, txt(s));
  assert.ok(txt(Z.listarSnoozes(dA('z.json'))).includes('chat-a'));
  assert.ok(!txt(Z.listarSnoozes(dB('z.json'))).includes('chat-a'));
  D.registrarEntrega({ titulo: 'Entrega-Secreta-A', fecha: '2027-02-01', tipo: 'entrega' }, dA('e.json'));
  assert.ok(txt(D.listarEntregas(dA('e.json'))).includes('Entrega-Secreta-A'));
  assert.ok(!txt(D.listarEntregas(dB('e.json'))).includes('Entrega-Secreta-A'));
  D.eliminarEntrega('Entrega-Secreta-A', dB('e.json'));
  assert.ok(txt(D.listarEntregas(dA('e.json'))).includes('Entrega-Secreta-A'), 'borrar en B no toca A');
  D.eliminarEntrega('Entrega-Secreta-A', dA('e.json'));
  assert.ok(!txt(D.listarEntregas(dA('e.json'))).includes('Entrega-Secreta-A'));
  vacioCentinela('snoozes/entregas');
});

test('procesos vigilados, fechas senaladas, avisos de llegada y menus por ruta', async () => {
  const P = await import('../../src/services/processWatchdogService.js');
  const F = await import('../../src/services/specialDatesService.js');
  const L = await import('../../src/services/arrivalWatchService.js');
  const M = await import('../../src/services/menuService.js');
  const rp = P.registrarProceso({ nombre: 'proc-secreto-A', patron: 'nginx', cpuLimite: 80, memLimite: 80 }, dA('p.json'));
  assert.ok(rp.ok, txt(rp));
  assert.ok(txt(P.listarProcesos(dA('p.json'))).includes('proc-secreto-A'));
  assert.ok(!txt(P.listarProcesos(dB('p.json'))).includes('proc-secreto-A'));
  P.dejarDeVigilar('proc-secreto-A', dB('p.json'));
  assert.ok(txt(P.listarProcesos(dA('p.json'))).includes('proc-secreto-A'), 'baja en B no toca A');

  const rf = F.registrarFechaSenalada({ nombre: 'Fecha-Secreta-A', dia: 3, mes: 4, descripcion: 'x' }, dA('f.json'));
  assert.ok(rf.ok, txt(rf));
  assert.ok(txt(F.listarFechasSenaladas(dA('f.json'))).includes('Fecha-Secreta-A'));
  assert.ok(!txt(F.listarFechasSenaladas(dB('f.json'))).includes('Fecha-Secreta-A'));
  F.eliminarFechaSenalada('Fecha-Secreta-A', dB('f.json'));
  assert.ok(txt(F.listarFechasSenaladas(dA('f.json'))).includes('Fecha-Secreta-A'));

  const rl = L.registrarAvisoLlegada({ chatId: 'chat-a', nombre: 'Casa-Secreta-A', latitud: 40.4, longitud: -3.7, radioMetros: 200 }, dA('l.json'));
  assert.ok(rl.ok, txt(rl));
  assert.ok(txt(L.listarAvisosLlegada(dA('l.json'))).includes('Casa-Secreta-A'));
  assert.ok(!txt(L.listarAvisosLlegada(dB('l.json'))).includes('Casa-Secreta-A'));
  L.cancelarAvisoLlegada('Casa-Secreta-A', dB('l.json'));
  assert.ok(txt(L.listarAvisosLlegada(dA('l.json'))).includes('Casa-Secreta-A'));

  M.ponerMenu({ dia: 'lunes', comida: 'lentejas-secretas-A', cena: 'x' }, dA('m.json'));
  assert.ok(txt(M.verMenu({}, dA('m.json'))).includes('lentejas-secretas-A'));
  assert.ok(!txt(M.verMenu({}, dB('m.json'))).includes('lentejas-secretas-A'));
  vacioCentinela('procesos/fechas/llegada/menus');
});

test('viajes vigilados por ruta', async () => {
  const V = await import('../../src/services/viajesService.js');
  const r = V.vigilarRuta({ tipo: 'tren', origen: 'Madrid', destino: 'secretopolis-a', fecha: '2027-03-01', precioObjetivo: 20 }, dA('v.json'));
  assert.ok(r.ok, txt(r));
  assert.ok(txt(V.listarRutasVigiladas(dA('v.json'))).includes('secretopolis-a'));
  assert.ok(!txt(V.listarRutasVigiladas(dB('v.json'))).includes('secretopolis-a'));
  V.cancelarVigilanciaRuta({ criterio: 'secretopolis-a' }, dB('v.json'));
  assert.ok(txt(V.listarRutasVigiladas(dA('v.json'))).includes('secretopolis-a'));
  vacioCentinela('viajes');
});

test('flashcards por ruta (tarjetas y configuracion)', async () => {
  const FC = await import('../../src/services/flashcardService.js');
  const r = FC.agregarFlashcard({ pregunta: 'pregunta-secreta-A', respuesta: 'r' }, { rutaArchivo: path.join(RA, 'fc.json'), rutaConfig: path.join(RA, 'fcc.json') });
  assert.ok(r.ok, txt(r));
  assert.ok(txt(FC.listarFlashcards({}, { rutaArchivo: path.join(RA, 'fc.json') })).includes('pregunta-secreta-A'));
  assert.ok(!txt(FC.listarFlashcards({}, { rutaArchivo: path.join(RB, 'fc.json') })).includes('pregunta-secreta-A'));
  vacioCentinela('flashcards');
});

test('recordatorios: CREAR, listar y cancelar usan la ruta (antes crear ignoraba la ruta y escribia el fichero global)', async () => {
  const R = await import('../../src/services/reminderService.js');
  const c = R.crearRecordatorio({ mensaje: 'recordatorio-secreto-A', minutosEnElFuturo: 600 }, dA('r.json'));
  assert.ok(c.recordatorio, txt(c));
  assert.ok(txt(R.listarRecordatorios(true, dA('r.json'))).includes('recordatorio-secreto-A'));
  assert.ok(!txt(R.listarRecordatorios(true, dB('r.json'))).includes('recordatorio-secreto-A'));
  R.cancelarRecordatorio('recordatorio-secreto-A', dB('r.json'));
  assert.ok(txt(R.listarRecordatorios(true, dA('r.json'))).includes('recordatorio-secreto-A'));
  vacioCentinela('recordatorios');
});
