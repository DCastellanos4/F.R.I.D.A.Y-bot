import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  normalizarNumeroTelefono,
  calcularTimestampMensaje,
  programarMensaje,
  listarMensajesProgramados,
  cancelarMensajeProgramado,
  iniciarMonitorMensajesProgramados,
  detenerMonitorMensajesProgramados,
  despacharMensajesPendientes,
  leerMensajesProgramados,
  guardarMensajesProgramados
} from './scheduledMessageService.js';

import {
  crearRecordatorio,
  listarRecordatorios,
  cancelarRecordatorio,
  iniciarMonitorRecordatorios,
  detenerMonitorRecordatorios,
  despacharRecordatoriosPendientes
} from './reminderService.js';

import {
  seleccionarHerramientasPorIntencion,
  limpiarRespuestaJarvis
} from './jarvisAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO_MENSAJES = path.join(__dirname, 'data', 'scheduled_messages.json');
const ARCHIVO_RECORDATORIOS = path.join(__dirname, 'data', 'reminders.json');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    testsFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    testsFailed++;
  }
}

console.log('====================================================');
console.log('TEST SUITE: RECORDATORIOS Y MENSAJES PROGRAMADOS');
console.log('====================================================\n');

// Backup original data files
const backupMensajes = fs.existsSync(ARCHIVO_MENSAJES) ? fs.readFileSync(ARCHIVO_MENSAJES, 'utf-8') : null;
const backupRecordatorios = fs.existsSync(ARCHIVO_RECORDATORIOS) ? fs.readFileSync(ARCHIVO_RECORDATORIOS, 'utf-8') : null;

async function ejecutarPruebas() {
  try {
    // ----------------------------------------------------
    // Suite 1: Normalización de números telefónicos
    // ----------------------------------------------------
    console.log('--- Suite 1: Normalización de Números Telefónicos (E.164 + España +34) ---');

    runTest('Añade prefijo +34 a móvil español de 9 dígitos que empieza por 6', () => {
      const res = normalizarNumeroTelefono('612345678');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.numero, '34612345678');
      assert.strictEqual(res.jid, '34612345678@s.whatsapp.net');
    });

    runTest('Añade prefijo +34 a fijo español de 9 dígitos que empieza por 9', () => {
      const res = normalizarNumeroTelefono('912345678');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.numero, '34912345678');
      assert.strictEqual(res.jid, '34912345678@s.whatsapp.net');
    });

    runTest('Limpia espacios, paréntesis y guiones en número español con +34', () => {
      const res = normalizarNumeroTelefono('+34 (612) 34-56-78');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.numero, '34612345678');
      assert.strictEqual(res.jid, '34612345678@s.whatsapp.net');
    });

    runTest('Normaliza prefijo internacional 0034 a 34', () => {
      const res = normalizarNumeroTelefono('0034612345678');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.numero, '34612345678');
    });

    runTest('Mantiene número internacional sin prefijo español (ej: EE.UU. +1)', () => {
      const res = normalizarNumeroTelefono('+1 (555) 234-5678');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.numero, '15552345678');
      assert.strictEqual(res.jid, '15552345678@s.whatsapp.net');
    });

    runTest('Rechaza números inválidos o demasiado cortos', () => {
      const r1 = normalizarNumeroTelefono('12345');
      assert.strictEqual(r1.ok, false);

      const r2 = normalizarNumeroTelefono('abc');
      assert.strictEqual(r2.ok, false);

      const r3 = normalizarNumeroTelefono('');
      assert.strictEqual(r3.ok, false);
    });

    // ----------------------------------------------------
    // Suite 2: Cálculo de Timestamps y Persistencia en Disco
    // ----------------------------------------------------
    console.log('\n--- Suite 2: Programación y Persistencia Duradera ---');

    runTest('Calcula timestamp relativo para minutos en el futuro', () => {
      const ahora = Date.now();
      const fecha = calcularTimestampMensaje({ minutosEnElFuturo: 10 });
      const diffMin = Math.round((fecha.getTime() - ahora) / 60000);
      assert.strictEqual(diffMin, 10);
    });

    runTest('Calcula timestamp para envío inmediato (minutosEnElFuturo = 0 o inmediato = true)', () => {
      const ahora = Date.now();
      const fecha = calcularTimestampMensaje({ minutosEnElFuturo: 0, inmediato: true });
      const diffSec = Math.abs(fecha.getTime() - ahora) / 1000;
      assert.strictEqual(diffSec < 2, true);
    });

    runTest('Calcula timestamp inmediato por defecto si no se pasa hora ni minutos', () => {
      const ahora = Date.now();
      const fecha = calcularTimestampMensaje({});
      const diffSec = Math.abs(fecha.getTime() - ahora) / 1000;
      assert.strictEqual(diffSec < 2, true);
    });

    runTest('Calcula timestamp para hora específica (ej: 18:30)', () => {
      const fecha = calcularTimestampMensaje({ hora: '18:30' });
      assert.strictEqual(fecha instanceof Date, true);
      assert.strictEqual(isNaN(fecha.getTime()), false);
    });

    runTest('Crea mensaje programado y lo persiste en data/scheduled_messages.json', () => {
      guardarMensajesProgramados([]);
      const res = programarMensaje({
        numero: '612345678',
        mensaje: 'Reunión de proyecto confirmada',
        minutosEnElFuturo: 20
      });

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.programado.numero, '34612345678');
      assert.strictEqual(res.programado.mensaje, 'Reunión de proyecto confirmada');
      assert.strictEqual(res.programado.enviado, false);

      // Verificar en disco
      const enDisco = leerMensajesProgramados();
      assert.strictEqual(enDisco.length, 1);
      assert.strictEqual(enDisco[0].id, res.programado.id);
    });

    runTest('Lista mensajes pendientes correctamente', () => {
      const lista = listarMensajesProgramados(true);
      assert.strictEqual(lista.length, 1);
      assert.strictEqual(lista[0].mensaje, 'Reunión de proyecto confirmada');
    });

    runTest('Cancela un mensaje programado por ID o criterio', () => {
      const pendientes = listarMensajesProgramados(true);
      const id = pendientes[0].id;
      const resCancel = cancelarMensajeProgramado(id);

      assert.strictEqual(resCancel.ok, true);
      const listaDespues = listarMensajesProgramados(true);
      assert.strictEqual(listaDespues.length, 0);
    });

    // ----------------------------------------------------
    // Suite 3: Monitor de Despacho y Callback Sin 'undefined'
    // ----------------------------------------------------
    console.log('\n--- Suite 3: Monitor de Despacho de Mensajes y Recordatorios ---');

    await runAsyncTest('Monitor de mensajes programados despacha y notifica con payload íntegro', async () => {
      detenerMonitorMensajesProgramados();

      // Guardar un mensaje con timestamp vencido
      const idTest = `sch_test_${Date.now()}`;
      guardarMensajesProgramados([{
        id: idTest,
        numero: '34699887766',
        destinatarioJid: '34699887766@s.whatsapp.net',
        mensaje: 'Prueba de entrega inmediata',
        timestamp: Date.now() - 1000,
        fechaHoraLocal: '27/10/2026, 17:00',
        enviado: false,
        creadoEn: new Date().toISOString()
      }]);

      let callbackInvocado = false;
      let mensajeRecibido = null;

      iniciarMonitorMensajesProgramados(async (msg) => {
        callbackInvocado = true;
        mensajeRecibido = msg;
      }, 50000);

      // Despachar inmediatamente
      const despachados = await despacharMensajesPendientes();
      detenerMonitorMensajesProgramados();

      assert.strictEqual(callbackInvocado, true);
      assert.strictEqual(mensajeRecibido.mensaje, 'Prueba de entrega inmediata');
      assert.strictEqual(mensajeRecibido.numero, '34699887766');
      assert.strictEqual(despachados.length, 1);

      // Comprobar que en disco figura enviado
      const enDisco = leerMensajesProgramados();
      const itemActualizado = enDisco.find(m => m.id === idTest);
      assert.strictEqual(itemActualizado.enviado, true);
    });

    await runAsyncTest('Bugfix Recordatorio: Callback entrega objeto y mensaje NO es undefined', async () => {
      detenerMonitorRecordatorios();

      // Crear un recordatorio con timestamp en el pasado
      const notaTexto = 'Revisar servidor de base de datos Oracle';
      const nuevo = crearRecordatorio({
        mensaje: notaTexto,
        minutosEnElFuturo: 0
      });

      // Forzar timestamp en el pasado para disparo
      const listaRec = JSON.parse(fs.readFileSync(ARCHIVO_RECORDATORIOS, 'utf-8'));
      const item = listaRec.find(r => r.id === nuevo.recordatorio.id);
      item.timestamp = Date.now() - 5000;
      item.completado = false;
      fs.writeFileSync(ARCHIVO_RECORDATORIOS, JSON.stringify(listaRec, null, 2), 'utf-8');

      let alertaGenerada = '';
      let recordatorioObtenido = null;

      iniciarMonitorRecordatorios(async (recordatorio, alertaTexto) => {
        recordatorioObtenido = recordatorio;
        // Simulación idéntica a whatsappBot.js
        const notaMensaje = (recordatorio && recordatorio.mensaje)
          ? recordatorio.mensaje
          : (typeof recordatorio === 'string' ? recordatorio : 'Recordatorio programado');
        alertaGenerada = `[RECORDATORIO]\n\nSeñor, tal como me solicitó: "${notaMensaje}".\n\nTarea completada y archivada, señor.`;
      }, 50000);

      // Disparar
      const disparados = await despacharRecordatoriosPendientes();
      detenerMonitorRecordatorios();

      assert.strictEqual(Boolean(recordatorioObtenido), true);
      assert.strictEqual(recordatorioObtenido.mensaje, notaTexto);
      assert.strictEqual(alertaGenerada.includes('undefined'), false, 'La alerta no debe contener "undefined"');
      assert.strictEqual(alertaGenerada.includes(notaTexto), true, 'La alerta debe contener el texto del recordatorio');
      assert.strictEqual(disparados.length >= 1, true);
    });

    // ----------------------------------------------------
    // Suite 4: Enrutamiento de Herramientas y Detección de Intenciones
    // ----------------------------------------------------
    console.log('\n--- Suite 4: Dynamic Tool Pruning y Enrutamiento J.A.R.V.I.S. ---');

    runTest('Enruta intención de programar mensaje de WhatsApp a terceros', () => {
      const tools = seleccionarHerramientasPorIntencion('Programa un mensaje a 612345678 diciendo que llego tarde');
      const nombres = tools.map(t => t.function.name);
      assert.strictEqual(nombres.includes('programar_mensaje_whatsapp'), true);
    });

    runTest('Enruta intención de listar y cancelar mensajes programados', () => {
      const t1 = seleccionarHerramientasPorIntencion('¿Qué mensajes programados tengo pendientes?');
      assert.strictEqual(t1.some(t => t.function.name.includes('mensaje_programado')), true);

      const t2 = seleccionarHerramientasPorIntencion('Cancela el mensaje programado al 612345678');
      assert.strictEqual(t2.some(t => t.function.name.includes('cancelar_mensaje_programado')), true);
    });

    runTest('Distingue recordatorio personal vs mensaje externo', () => {
      const toolsRec = seleccionarHerramientasPorIntencion('Recuérdame sacar la basura a las 20:00');
      const nombres = toolsRec.map(t => t.function.name);
      assert.strictEqual(nombres.includes('crear_recordatorio'), true);
      assert.strictEqual(nombres.includes('programar_mensaje_whatsapp'), false);
    });

    runTest('limpiarRespuestaJarvis elimina emojis y slop residual', () => {
      const textoConEmojis = '⏰ Buenos días señor 🤖, su mensaje ha sido programado con éxito. 👍';
      const limpio = limpiarRespuestaJarvis(textoConEmojis);
      assert.strictEqual(limpio.includes('⏰'), false);
      assert.strictEqual(limpio.includes('🤖'), false);
      assert.strictEqual(limpio.includes('👍'), false);
      assert.strictEqual(limpio, 'Buenos días señor, su mensaje ha sido programado con éxito.');
    });

    // ----------------------------------------------------
    // Suite 5: Prueba End-to-End de Programación y Consulta
    // ----------------------------------------------------
    console.log('\n--- Suite 5: Ejecución End-to-End de Programación y Consulta ---');

    runTest('Programa un mensaje correctamente vía service y verifica persistencia', () => {
      const res = programarMensaje({
        numero: '699112233',
        mensaje: 'Buenos días, confirmamos la cita médica.',
        hora: '10:00',
        fecha: 'mañana'
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.programado.numero, '34699112233');

      const lista = listarMensajesProgramados(true);
      const encontrado = lista.find(m => m.numero === '34699112233');
      assert.strictEqual(Boolean(encontrado), true);
      assert.strictEqual(encontrado.mensaje, 'Buenos días, confirmamos la cita médica.');

      // Cancelar para limpiar
      cancelarMensajeProgramado(encontrado.id);
    });

  } finally {
    // Restore original data files
    if (backupMensajes !== null) {
      fs.writeFileSync(ARCHIVO_MENSAJES, backupMensajes, 'utf-8');
    }
    if (backupRecordatorios !== null) {
      fs.writeFileSync(ARCHIVO_RECORDATORIOS, backupRecordatorios, 'utf-8');
    }
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${testsPassed} PASSED | ${testsFailed} FAILED`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

ejecutarPruebas().catch(err => {
  console.error('Error fatal ejecutando la suite de pruebas:', err);
  process.exit(1);
});
