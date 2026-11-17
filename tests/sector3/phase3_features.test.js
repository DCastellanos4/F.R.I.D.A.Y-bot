/**
 * tests/sector3/phase3_features.test.js - Validacion tecnica de funcionalidades de Fase 3.
 *
 * 1. lifestyle MCP: aislamiento estricto de habitos y compras entre tenant_a y tenant_b.
 * 2. booking MCP: cancelarCita de tenant_a no afecta ni cancela citas de tenant_b.
 * 3. interactiveService: pollVoteStore con TTL y limite de memoria.
 * 4. Identidad D.A.V.I.S. coherente en Modelfile.jarvis (cero senor/mayordomo britanico).
 * 5. Suite existente pasando sin regresiones.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../sector2/setup_aislamiento.mjs';

import { crearLifestyleDb } from '../../mcp-servers/lifestyle/db.js';
import { crearBookingDb } from '../../mcp-servers/booking/db.js';
import {
  parseInteractiveResponse,
  getRecordedPollVotes,
  clearRecordedPollVotes,
  configurePollStoreLimits,
  pruneExpiredPolls,
  getPollStoreSize,
  DEFAULT_POLL_STORE_MAX_ENTRIES,
  DEFAULT_POLL_STORE_TTL_MS
} from '../../src/core/interactiveService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_MODELFILE = path.resolve(__dirname, '../../Modelfile.jarvis');
const RUTA_WHATSAPP_BOT = path.resolve(__dirname, '../../whatsappBot.js');

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

// ---------------------------------------------------------------------------
// 1. Lifestyle MCP: Aislamiento estricto de habitos y compras entre tenants
// ---------------------------------------------------------------------------

test('Fase 3 - Lifestyle MCP: aislamiento estricto de habitos entre tenant_a y tenant_b', () => {
  const db = crearLifestyleDb(':memory:');
  const hoy = '2026-11-20';

  try {
    // 1.1 Registro de habitos independientes con mismo nombre en diferentes tenants
    const habA = db.registrarHabito({ nombre: 'Entrenamiento fuerza', tenant_id: 'tenant_a' });
    assert.equal(habA.ok, true);
    assert.equal(habA.habito.tenant_id, 'tenant_a');
    assert.equal(habA.habito.nombre, 'Entrenamiento fuerza');

    const habB = db.registrarHabito({ nombre: 'Entrenamiento fuerza', tenant_id: 'tenant_b' });
    assert.equal(habB.ok, true);
    assert.equal(habB.habito.tenant_id, 'tenant_b');
    assert.notEqual(habA.habito.id, habB.habito.id);

    // Duplicado dentro del mismo tenant falla
    assert.throws(() => {
      db.registrarHabito({ nombre: 'Entrenamiento fuerza', tenant_id: 'tenant_a' });
    }, /Ya existe un habito/);

    // 1.2 Listar habitos aislado por tenant
    const listaA = db.listarHabitos({ hoy, tenant_id: 'tenant_a' });
    assert.equal(listaA.total, 1);
    assert.equal(listaA.habitos[0].id, habA.habito.id);
    assert.equal(listaA.habitos[0].tenant_id, 'tenant_a');

    const listaB = db.listarHabitos({ hoy, tenant_id: 'tenant_b' });
    assert.equal(listaB.total, 1);
    assert.equal(listaB.habitos[0].id, habB.habito.id);
    assert.equal(listaB.habitos[0].tenant_id, 'tenant_b');

    // 1.3 Marcar habito en tenant_a no afecta a tenant_b
    const marcA = db.marcarHabito({ criterio: 'fuerza', fecha: hoy, hoy, tenant_id: 'tenant_a' });
    assert.equal(marcA.ok, true);
    assert.equal(marcA.racha, 1);

    const listaBTrasMarcaA = db.listarHabitos({ hoy, tenant_id: 'tenant_b' });
    assert.equal(listaBTrasMarcaA.habitos[0].hecho_hoy, false);
    assert.equal(listaBTrasMarcaA.habitos[0].racha, 0);

    // 1.4 Intento de manipulacion cross-tenant falla (tenant_a intenta marcar el id de tenant_b)
    assert.throws(() => {
      db.marcarHabito({ criterio: habB.habito.id, fecha: hoy, hoy, tenant_id: 'tenant_a' });
    }, /No se encontro ningun habito/);
  } finally {
    db.cerrar();
  }
});

test('Fase 3 - Lifestyle MCP: aislamiento estricto de compras entre tenant_a y tenant_b', () => {
  const db = crearLifestyleDb(':memory:');

  try {
    // 2.1 Anadir items independientes por tenant
    const addA = db.anadirCompra({ items: ['Avena', 'Cafe'], tenant_id: 'tenant_a' });
    assert.equal(addA.ok, true);
    assert.equal(addA.total_pendientes, 2);

    const addB = db.anadirCompra({ items: ['Cafe', 'Manzanas', 'Leche'], tenant_id: 'tenant_b' });
    assert.equal(addB.ok, true);
    assert.equal(addB.total_pendientes, 3);

    // Listado aislado
    const listA1 = db.listarCompra({ tenant_id: 'tenant_a' });
    assert.equal(listA1.total, 2);
    assert.deepEqual(listA1.items, ['Avena', 'Cafe']);

    const listB1 = db.listarCompra({ tenant_id: 'tenant_b' });
    assert.equal(listB1.total, 3);
    assert.deepEqual(listB1.items, ['Cafe', 'Manzanas', 'Leche']);

    // 2.2 Tachar item en tenant_a no afecta a tenant_b
    const tachA = db.tacharCompra({ criterio: 'cafe', tenant_id: 'tenant_a' });
    assert.equal(tachA.ok, true);
    assert.equal(tachA.total_pendientes, 1);

    const listA2 = db.listarCompra({ tenant_id: 'tenant_a' });
    assert.equal(listA2.total, 1);
    assert.deepEqual(listA2.items, ['Avena']);

    // Cafe sigue pendiente en tenant_b
    const listB2 = db.listarCompra({ tenant_id: 'tenant_b' });
    assert.equal(listB2.total, 3);
    assert.ok(listB2.items.includes('Cafe'));

    // 2.3 Intento de tachar item exclusivo de tenant_b desde tenant_a debe fallar
    assert.throws(() => {
      db.tacharCompra({ criterio: 'manzanas', tenant_id: 'tenant_a' });
    }, /No se encontro ningun item pendiente/);

    // 2.4 Vaciar lista en tenant_a preserva los items de tenant_b
    const vaciarA = db.vaciarCompra({ tenant_id: 'tenant_a' });
    assert.equal(vaciarA.ok, true);
    assert.equal(vaciarA.eliminados, 1);

    const listA3 = db.listarCompra({ tenant_id: 'tenant_a' });
    assert.equal(listA3.total, 0);

    const listB3 = db.listarCompra({ tenant_id: 'tenant_b' });
    assert.equal(listB3.total, 3);
  } finally {
    db.cerrar();
  }
});

// ---------------------------------------------------------------------------
// 2. Booking MCP: cancelarCita de tenant_a no afecta ni cancela citas de tenant_b
// ---------------------------------------------------------------------------

test('Fase 3 - Booking MCP: cancelacion cross-tenant bloqueada por ID, nombre y telefono', () => {
  const db = crearBookingDb(':memory:');
  const fecha = '2026-11-25';
  const slot = `${fecha}T11:00:00.000Z`;

  try {
    // 2.1 Reserva en tenant_a y tenant_b en el mismo horario sin colision
    const resA = db.reservarCita({
      cliente_nombre: 'Carlos Gomez',
      cliente_telefono: '+34611223344',
      fecha_inicio: slot,
      duracion_minutos: 30,
      servicio: 'Fisioterapia',
      tenant_id: 'tenant_a'
    });
    assert.equal(resA.ok, true);
    assert.equal(resA.cita.tenant_id, 'tenant_a');

    const resB = db.reservarCita({
      cliente_nombre: 'Lucia Martin',
      cliente_telefono: '+34699887766',
      fecha_inicio: slot,
      duracion_minutos: 30,
      servicio: 'Odontologia',
      tenant_id: 'tenant_b'
    });
    assert.equal(resB.ok, true);
    assert.equal(resB.cita.tenant_id, 'tenant_b');

    // 2.2 Intento de cancelacion cross-tenant por cita_id: tenant_a intenta cancelar la cita de tenant_b
    const intentoCancelId = db.cancelarCita({
      cita_id: resB.cita.id,
      tenant_id: 'tenant_a'
    });
    assert.equal(intentoCancelId.ok, false);
    assert.match(intentoCancelId.error, /No se encontro ninguna cita/);

    // Verificar que la cita de tenant_b sigue intacta y confirmada
    const citaBTrasIntentoId = db.obtenerCitaPorId(resB.cita.id, 'tenant_b');
    assert.equal(citaBTrasIntentoId.estado, 'confirmada');

    // 2.3 Intento de cancelacion cross-tenant por cliente_nombre
    const intentoCancelNombre = db.cancelarCita({
      cliente_nombre: 'Lucia Martin',
      tenant_id: 'tenant_a'
    });
    assert.equal(intentoCancelNombre.ok, false);
    assert.match(intentoCancelNombre.error, /No se encontraron citas/);

    // 2.4 Intento de cancelacion cross-tenant por telefono y fecha
    const intentoCancelTel = db.cancelarCita({
      cliente_telefono: '+34699887766',
      fecha,
      tenant_id: 'tenant_a'
    });
    assert.equal(intentoCancelTel.ok, false);
    assert.match(intentoCancelTel.error, /No se encontraron citas/);

    // 2.5 Aislamiento en obtenerCitaPorId
    assert.equal(db.obtenerCitaPorId(resB.cita.id, 'tenant_a'), null);
    assert.ok(db.obtenerCitaPorId(resB.cita.id, 'tenant_b'));

    // 2.6 Cancelacion valida y autorizada por su propio tenant (tenant_b)
    const cancelValidaB = db.cancelarCita({
      cita_id: resB.cita.id,
      tenant_id: 'tenant_b'
    });
    assert.equal(cancelValidaB.ok, true);
    assert.equal(cancelValidaB.cita.estado, 'cancelada');

    // La cita de tenant_a permanece sin alteraciones en estado confirmada
    const citaAVerif = db.obtenerCitaPorId(resA.cita.id, 'tenant_a');
    assert.equal(citaAVerif.estado, 'confirmada');
  } finally {
    db.cerrar();
  }
});

// ---------------------------------------------------------------------------
// 3. interactiveService: pollVoteStore con TTL y limite de memoria
// ---------------------------------------------------------------------------

test('Fase 3 - interactiveService: registro de votos y control de TTL en pollVoteStore', () => {
  clearRecordedPollVotes();
  try {
    configurePollStoreLimits({
      maxEntries: 100,
      ttlMs: 50 // TTL muy corto para verificacion precisa
    });

    const msgVoto1 = {
      key: { remoteJid: 'user1@s.whatsapp.net', participant: 'user1@s.whatsapp.net' },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: 'POLL_ALPHA' },
          vote: { selectedOptions: ['opt_a', 'opt_b'] }
        }
      }
    };

    const res = parseInteractiveResponse(msgVoto1);
    assert.ok(res);
    assert.equal(res.type, 'poll_vote');
    assert.equal(res.pollId, 'POLL_ALPHA');

    const votosInmediatos = getRecordedPollVotes('POLL_ALPHA');
    assert.equal(votosInmediatos.length, 1);
    assert.equal(votosInmediatos[0].voterJid, 'user1@s.whatsapp.net');
    assert.deepEqual(votosInmediatos[0].selectedOptions, ['opt_a', 'opt_b']);
    assert.equal(getPollStoreSize(), 1);

    // Ejecutar poda con timestamp futuro que sobrepase el TTL
    const tiempoFuturo = Date.now() + 100;
    pruneExpiredPolls(tiempoFuturo);

    assert.equal(getRecordedPollVotes('POLL_ALPHA').length, 0);
    assert.equal(getPollStoreSize(), 0);
  } finally {
    clearRecordedPollVotes();
    configurePollStoreLimits({
      maxEntries: DEFAULT_POLL_STORE_MAX_ENTRIES,
      ttlMs: DEFAULT_POLL_STORE_TTL_MS
    });
  }
});

test('Fase 3 - interactiveService: limite de memoria y desalojo LRU/FIFO en pollVoteStore', () => {
  clearRecordedPollVotes();
  try {
    // Fijamos maxEntries en 3 encuestas
    configurePollStoreLimits({
      maxEntries: 3,
      ttlMs: 3600000
    });

    const crearMsgEncuesta = (pollId, voterJid, opt) => ({
      key: { remoteJid: voterJid, participant: voterJid },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: pollId },
          vote: { selectedOptions: [opt] }
        }
      }
    });

    parseInteractiveResponse(crearMsgEncuesta('POLL_1', 'u1@s.whatsapp.net', 'op_1'));
    parseInteractiveResponse(crearMsgEncuesta('POLL_2', 'u2@s.whatsapp.net', 'op_2'));
    parseInteractiveResponse(crearMsgEncuesta('POLL_3', 'u3@s.whatsapp.net', 'op_3'));
    assert.equal(getPollStoreSize(), 3);

    // Insertar una cuarta encuesta debe desalojar la mas antigua (POLL_1)
    parseInteractiveResponse(crearMsgEncuesta('POLL_4', 'u4@s.whatsapp.net', 'op_4'));
    assert.equal(getPollStoreSize(), 3);
    assert.deepEqual(getRecordedPollVotes('POLL_1'), [], 'POLL_1 debio ser desalojado por el limite de capacidad');
    assert.equal(getRecordedPollVotes('POLL_2').length, 1);
    assert.equal(getRecordedPollVotes('POLL_3').length, 1);
    assert.equal(getRecordedPollVotes('POLL_4').length, 1);

    // Limpieza total
    clearRecordedPollVotes();
    assert.equal(getPollStoreSize(), 0);
  } finally {
    clearRecordedPollVotes();
    configurePollStoreLimits({
      maxEntries: DEFAULT_POLL_STORE_MAX_ENTRIES,
      ttlMs: DEFAULT_POLL_STORE_TTL_MS
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Identidad D.A.V.I.S. coherente en Modelfile.jarvis (cero senor/mayordomo)
// ---------------------------------------------------------------------------

test('Fase 3 - Modelfile.jarvis: identidad D.A.V.I.S. coherente y eliminacion de mayordomo britanico', () => {
  assert.ok(fs.existsSync(RUTA_MODELFILE), 'Modelfile.jarvis debe existir');
  const modelfile = fs.readFileSync(RUTA_MODELFILE, 'utf-8');

  // 4.1 Identidad correcta D.A.V.I.S.
  assert.match(modelfile, /D\.A\.V\.I\.S\./, 'Debe identificarse como D.A.V.I.S.');
  assert.match(modelfile, /Digital Autonomous Voice & Intelligence System/, 'Debe expandir el acronimo D.A.V.I.S.');
  assert.match(modelfile, /copiloto personal y tecnico/i, 'Debe definirse como copiloto personal y tecnico');

  // 4.2 Erradicacion total de mayordomo personal britanico y referencias de Iron Man
  assert.doesNotMatch(modelfile, /mayordomo personal/i, 'No debe ser mayordomo personal');
  assert.match(modelfile, /Sin cortesia britanica/i, 'Debe descartar explicitamente la cortesia britanica');
  assert.doesNotMatch(modelfile, /Paul Bettany/i, 'No debe referenciar a Paul Bettany');
  assert.doesNotMatch(modelfile, /Los Vengadores|Iron Man/i, 'No debe referenciar franquicias de ficcion');
  assert.doesNotMatch(modelfile, /J\.A\.R\.V\.I\.S\./i, 'No debe identificarse como J.A.R.V.I.S.');

  // 4.3 Tono y directrices obligatorias alineadas con selectiveContext.js
  assert.match(modelfile, /Habla de tu/i, 'Debe especificar tratamiento de tu');
  assert.match(modelfile, /humor seco/i, 'Debe indicar humor seco y sarcastico');
  assert.match(modelfile, /Prohibici[oó]n estricta de emojis/i, 'Debe prohibir terminantemente los emojis');
  assert.match(modelfile, /Cero slop y cero relleno/i, 'Debe exigir cero slop');

  // 4.4 Tratamiento de senor solo con ironia o sin cortesia
  assert.doesNotMatch(modelfile, /Tratas a David formalmente como "se[nñ]or"/i,
    'No debe exigir llamar formalmente senor a David');
});

test('Fase 3 - whatsappBot.js: depuracion de cadenas residuales de servilismo', () => {
  assert.ok(fs.existsSync(RUTA_WHATSAPP_BOT), 'whatsappBot.js debe existir');
  const botContent = fs.readFileSync(RUTA_WHATSAPP_BOT, 'utf-8');

  // Cadenas residuales eliminadas
  assert.doesNotMatch(botContent, /Señor, he recibido su nota de voz/, 'Eliminado trato servil en notas de voz');
  assert.doesNotMatch(botContent, /A su servicio, señor/, 'Eliminada cortesia servil en easter eggs');
  assert.doesNotMatch(botContent, /Entendido, señor/, 'Eliminado senor en confirmaciones');
  assert.doesNotMatch(botContent, /Antes de actuar, señor/, 'Eliminado senor en avisos de acciones');
});

// ---------------------------------------------------------------------------
// 5. Verificacion de Cero Emojis en suite y artefactos modificados
// ---------------------------------------------------------------------------

test('Fase 3 - Politica Cero Emojis en archivos de Fase 3 y suite de tests', () => {
  const archivosAValidar = [
    RUTA_MODELFILE,
    path.resolve(__dirname, '../../mcp-servers/lifestyle/db.js'),
    path.resolve(__dirname, '../../mcp-servers/booking/db.js'),
    path.resolve(__dirname, '../../src/core/interactiveService.js'),
    __filename
  ];

  for (const ruta of archivosAValidar) {
    const texto = fs.readFileSync(ruta, 'utf-8');
    const lineas = texto.split('\n');
    for (let i = 0; i < lineas.length; i++) {
      assert.equal(
        EMOJI_REGEX.test(lineas[i]),
        false,
        `Se detecto emoji prohibido en ${path.basename(ruta)} linea ${i + 1}: "${lineas[i]}"`
      );
    }
  }
});
