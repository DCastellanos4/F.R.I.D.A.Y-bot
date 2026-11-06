/**
 * skills.test.js
 * Adaptacion Hermes aprobada por David (6 nov 2026, WhatsApp
 * wamid.HBgLMzQ2MzU2MDU2MDUVAgASGBQzQTk4MTU1N0ZFMzA4MjQ3RjI3RgA=
 * "vale pues aplica eso"): procedimientos reutilizables (skills) con
 * aprobacion humana fuera del modelo. Estos tests fijan:
 *  - la skill semilla de diagnostico (solo lectura) viene aprobada por David;
 *  - el modelo puede PROPONER pero jamas aprobar: la aprobacion es un
 *    mensaje real de David en el mismo chat, ligado al contenido exacto,
 *    con TTL y de un solo uso;
 *  - ejecutar_skill solo corre skills aprobadas, sustituye parametros
 *    declarados y pasa cada paso por el ejecutor normal (guardas intactas);
 *  - una skill nunca invoca la propia capa de skills.
 *
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import os from 'os';

const dirEntorno = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-skills-'));
process.env.DAVIS_DATA_DIR = path.join(dirEntorno, 'data');
process.env.DAVIS_HISTORY_DIR = path.join(dirEntorno, 'history');
process.env.NODE_ENV = 'test';

const skills = await import('../../src/services/skillsService.js');
const bot = await import('../../whatsappBot.js');

const JID_DAVID = '149868706304033@lid';
const depsSkills = () => ({ rutaSkills: path.join(dirEntorno, 'data', `skills-${Math.random().toString(36).slice(2)}.json`) });

function sockSimulado(enviados) {
  return {
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => { enviados.push({ jid, payload }); return { key: { id: 'SIM-' + enviados.length } }; }
  };
}

function mensajeEntrante(texto, id = 'SIM-SKILL-1') {
  return {
    key: { remoteJid: JID_DAVID, fromMe: false, id },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

// ---------- Semilla ----------

test('la skill semilla diagnostico_davis viene aprobada y es de solo lectura', () => {
  const deps = depsSkills();
  const lista = skills.listarSkills(deps);
  const diag = lista.find((s) => s.nombre === 'diagnostico_davis');
  assert.ok(diag, 'existe la skill semilla');
  assert.equal(diag.estado, 'aprobada');
  assert.equal(diag.parametros.length, 0);
});

// ---------- Propuesta y aprobacion fuera del modelo ----------

test('proponerSkill valida: nombre, pasos existentes, placeholders declarados y capa meta prohibida', () => {
  const deps = depsSkills();
  const conocidas = ['consultar_estado_servidor', 'obtener_noticias_actuales'];
  const base = { nombre: 'resumen_matinal', descripcion: 'Resume noticias', parametros: [], pasos: [{ herramienta: 'obtener_noticias_actuales', argumentos: {} }] };
  assert.equal(skills.proponerSkill({ ...base, nombre: 'Mal Nombre' }, { chatId: 'c1' }, { ...deps, herramientasConocidas: conocidas }).ok, false);
  assert.equal(skills.proponerSkill({ ...base, pasos: [{ herramienta: 'no_existe', argumentos: {} }] }, { chatId: 'c1' }, { ...deps, herramientasConocidas: conocidas }).ok, false);
  assert.equal(skills.proponerSkill({ ...base, pasos: [{ herramienta: 'ejecutar_skill', argumentos: {} }] }, { chatId: 'c1' }, { ...deps, herramientasConocidas: conocidas }).ok, false);
  assert.equal(skills.proponerSkill({ ...base, pasos: [{ herramienta: 'obtener_noticias_actuales', argumentos: { tema: '{{tema}}' } }] }, { chatId: 'c1' }, { ...deps, herramientasConocidas: conocidas }).ok, false);
  assert.equal(skills.proponerSkill(base, { chatId: 'c1' }, { ...deps, herramientasConocidas: conocidas }).ok, true);
});

test('flujo completo: propuesta pendiente -> aprobacion de David en el chat -> ejecutable', async () => {
  const deps = depsSkills();
  const chat = 'chat-skill-1';
  const def = {
    nombre: 'estado_servidor_simple',
    descripcion: 'Consulta el estado del servidor',
    parametros: [],
    pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }]
  };
  const prop = skills.proponerSkill(def, { chatId: chat }, { ...deps, herramientasConocidas: ['consultar_estado_servidor'] });
  assert.ok(prop.ok);
  assert.equal(prop.skill.estado, 'pendiente');

  // Pendiente: no ejecutable.
  const antes = await skills.ejecutarSkill('estado_servidor_simple', {}, { ...deps, ejecutor: async () => ({ texto: 'x' }) });
  assert.equal(antes.ok, false);

  // Otro chat no puede aprobarla.
  const otroChat = skills.resolverConfirmacionSkill('otro-chat', 'aprobar skill estado_servidor_simple', deps);
  assert.equal(otroChat.confirmado, false);

  // David aprueba en su chat.
  const aprob = skills.resolverConfirmacionSkill(chat, 'aprobar skill estado_servidor_simple', deps);
  assert.equal(aprob.confirmado, true);

  // Un solo uso: repetir no vale.
  const repetida = skills.resolverConfirmacionSkill(chat, 'aprobar skill estado_servidor_simple', deps);
  assert.equal(repetida.confirmado, false);

  // Ahora ejecuta con el ejecutor inyectado.
  const llamadas = [];
  const res = await skills.ejecutarSkill('estado_servidor_simple', {}, {
    ...deps,
    ejecutor: async (h, a) => { llamadas.push([h, a]); return { texto: 'servidor ok' }; }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(llamadas, [['consultar_estado_servidor', {}]]);
  assert.ok(res.texto.includes('servidor ok'));
});

test('rechazar skill: queda rechazada y no ejecutable', async () => {
  const deps = depsSkills();
  const chat = 'chat-skill-2';
  skills.proponerSkill({ nombre: 'idea_mala', descripcion: 'x', parametros: [], pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }] }, { chatId: chat }, { ...deps, herramientasConocidas: ['consultar_estado_servidor'] });
  const rech = skills.resolverConfirmacionSkill(chat, 'rechazar skill idea_mala', deps);
  assert.equal(rech.confirmado, true);
  const res = await skills.ejecutarSkill('idea_mala', {}, { ...deps, ejecutor: async () => ({ texto: 'x' }) });
  assert.equal(res.ok, false);
});

test('la aprobacion caduca (TTL)', () => {
  const deps = depsSkills();
  const chat = 'chat-skill-ttl';
  let ahora = Date.now();
  skills.proponerSkill({ nombre: 'caducable', descripcion: 'x', parametros: [], pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }] }, { chatId: chat }, { ...deps, herramientasConocidas: ['consultar_estado_servidor'], now: () => ahora });
  ahora += 31 * 60 * 1000;
  const res = skills.resolverConfirmacionSkill(chat, 'aprobar skill caducable', { ...deps, now: () => ahora });
  assert.equal(res.confirmado, false);
  assert.ok(res.motivo.includes('caduco'));
});

// ---------- Ejecucion ----------

test('ejecutarSkill: parametros obligatorios, sustitucion de placeholders y rechazo de parametros no declarados', async () => {
  const deps = depsSkills();
  const chat = 'chat-skill-params';
  skills._reiniciarPendientes();
  const def = {
    nombre: 'noticias_tema',
    descripcion: 'Noticias de un tema',
    parametros: [{ nombre: 'tema', descripcion: 'tema', requerido: true }],
    pasos: [{ herramienta: 'obtener_noticias_actuales', argumentos: { tema: '{{tema}}' } }]
  };
  skills.proponerSkill(def, { chatId: chat }, { ...deps, herramientasConocidas: ['obtener_noticias_actuales'] });
  skills.resolverConfirmacionSkill(chat, 'aprobar skill noticias_tema', deps);

  const sinParam = await skills.ejecutarSkill('noticias_tema', {}, { ...deps, ejecutor: async () => ({ texto: 'x' }) });
  assert.equal(sinParam.ok, false);

  const sobrante = await skills.ejecutarSkill('noticias_tema', { tema: 'ia', trampa: 'rm -rf' }, { ...deps, ejecutor: async () => ({ texto: 'x' }) });
  assert.equal(sobrante.ok, false);

  const llamadas = [];
  const ok = await skills.ejecutarSkill('noticias_tema', { tema: 'ia' }, {
    ...deps,
    ejecutor: async (h, a) => { llamadas.push([h, a]); return { texto: 'titulares de ia' }; }
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(llamadas, [['obtener_noticias_actuales', { tema: 'ia' }]]);
});

test('ejecutarSkill: se detiene en el primer paso que lanza error', async () => {
  const deps = depsSkills();
  const chat = 'chat-skill-error';
  skills._reiniciarPendientes();
  skills.proponerSkill({
    nombre: 'dos_pasos',
    descripcion: 'x',
    parametros: [],
    pasos: [
      { herramienta: 'paso_uno', argumentos: {} },
      { herramienta: 'paso_dos', argumentos: {} }
    ]
  }, { chatId: chat }, { ...deps, herramientasConocidas: ['paso_uno', 'paso_dos'] });
  skills.resolverConfirmacionSkill(chat, 'aprobar skill dos_pasos', deps);
  const res = await skills.ejecutarSkill('dos_pasos', {}, {
    ...deps,
    ejecutor: async (h) => { if (h === 'paso_uno') throw new Error('caido'); return { texto: 'no deberia' }; }
  });
  assert.equal(res.ok, false);
  assert.equal(res.resultados.length, 1);
});

// ---------- Confirmacion fuera del modelo en el flujo real ----------

test('procesarMensajesEntrantes: "aprobar skill X" lo resuelve whatsappBot sin llamar al LLM', async () => {
  skills._reiniciarPendientes();
  // Propuesta registrada para el JID de David directamente en el servicio.
  const prop = skills.proponerSkill({
    nombre: 'diag_rapido',
    descripcion: 'Diagnostico rapido',
    parametros: [],
    pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }]
  }, { chatId: JID_DAVID }, { herramientasConocidas: ['consultar_estado_servidor'] });
  assert.ok(prop.ok);

  let llamadasLLM = 0;
  const llm = async () => { llamadasLLM++; return { message: { content: 'no deberia llamarse' } }; };
  const enviados = [];
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [mensajeEntrante('aprobar skill diag_rapido')],
    type: 'notify'
  }, { chatCompletion: llm, skipPersistencia: true });
  assert.equal(llamadasLLM, 0, 'la aprobacion nunca pasa por el modelo');
  assert.ok(enviados.some((m) => String(m.payload.text || '').includes('aprobada')));
});

// ---------- Guardas: la aprobacion esta ligada al contenido exacto ----------

test('si la definicion cambia tras la propuesta, la aprobacion ya no vale', () => {
  const deps = depsSkills();
  const chat = 'chat-skill-hash';
  skills._reiniciarPendientes();
  const ruta = deps.rutaSkills;
  const prop = skills.proponerSkill({
    nombre: 'skill_manipulable',
    descripcion: 'inocua',
    parametros: [],
    pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }]
  }, { chatId: chat }, { ...deps, herramientasConocidas: ['consultar_estado_servidor', 'programar_mensaje_whatsapp'] });
  assert.ok(prop.ok);
  // Alguien altera la definicion guardada (p. ej. un paso con envio).
  const data = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  data.skills.find((s) => s.nombre === 'skill_manipulable').pasos.push({ herramienta: 'programar_mensaje_whatsapp', argumentos: { numero: '600000000', mensaje: 'x' } });
  fs.writeFileSync(ruta, JSON.stringify(data), 'utf-8');
  const res = skills.resolverConfirmacionSkill(chat, 'aprobar skill skill_manipulable', deps);
  assert.equal(res.confirmado, false, 'la mutacion invalida la aprobacion');
  assert.ok(res.motivo.includes('cambio'));
});

// ---------- Guardas por paso: efectos externos exigen verificacion ----------

test('verificarPaso bloquea un paso de envio sin destinatario verificado y deja pasar uno verificado', async () => {
  const deps = depsSkills();
  const chat = 'chat-skill-envio';
  skills._reiniciarPendientes();
  skills.proponerSkill({
    nombre: 'aviso_a_marta',
    descripcion: 'Manda un aviso',
    parametros: [{ nombre: 'mensaje', requerido: true }],
    pasos: [{ herramienta: 'programar_mensaje_whatsapp', argumentos: { numero: '600111222', mensaje: '{{mensaje}}' } }]
  }, { chatId: chat }, { ...deps, herramientasConocidas: ['programar_mensaje_whatsapp'] });
  skills.resolverConfirmacionSkill(chat, 'aprobar skill aviso_a_marta', deps);

  let ejecutado = false;
  const bloqueado = await skills.ejecutarSkill('aviso_a_marta', { mensaje: 'hola' }, {
    ...deps,
    verificarPaso: () => 'el numero de destino no consta en este chat ni en los contactos verificados',
    ejecutor: async () => { ejecutado = true; return { texto: 'enviado' }; }
  });
  assert.equal(bloqueado.ok, false);
  assert.equal(ejecutado, false, 'el paso bloqueado no se ejecuta');

  const permitido = await skills.ejecutarSkill('aviso_a_marta', { mensaje: 'hola' }, {
    ...deps,
    verificarPaso: () => null,
    ejecutor: async (h, a) => { ejecutado = true; return { texto: `ok:${a.mensaje}` }; }
  });
  assert.equal(permitido.ok, true);
  assert.ok(permitido.texto.includes('ok:hola'));
});

// ---------- Confirmacion de voz: aprobar skills tambien es accion critica ----------

test('esAccionCriticaPorVoz cubre aprobar/rechazar skills dictados por voz', async () => {
  const voz = await import('../../src/services/voiceConfirmationService.js');
  assert.equal(voz.esAccionCriticaPorVoz('aprobar skill diag_rapido'), true);
  assert.equal(voz.esAccionCriticaPorVoz('rechazar skill aviso_a_marta'), true);
  assert.equal(voz.esAccionCriticaPorVoz('que skills tengo'), false);
});

test('procesarMensajesEntrantes: "aprobar skill X" por AUDIO exige el si previo y no aprueba directamente', async () => {
  skills._reiniciarPendientes();
  const prop = skills.proponerSkill({
    nombre: 'skill_por_voz',
    descripcion: 'x',
    parametros: [],
    pasos: [{ herramienta: 'consultar_estado_servidor', argumentos: {} }]
  }, { chatId: JID_DAVID }, { herramientasConocidas: ['consultar_estado_servidor'] });
  assert.ok(prop.ok);

  let llamadasLLM = 0;
  const llm = async () => { llamadasLLM++; return { message: { content: 'no deberia llamarse' } }; };
  const enviados = [];
  const msgAudio = {
    key: { remoteJid: JID_DAVID, fromMe: false, id: 'SIM-AUDIO-1' },
    message: { audioMessage: { url: 'sim', mimetype: 'audio/ogg' } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [msgAudio],
    type: 'notify'
  }, {
    chatCompletion: llm,
    skipPersistencia: true,
    descargarMedia: async () => Buffer.from('sim'),
    transcribirAudio: async () => ({ ok: true, texto: 'aprobar skill skill_por_voz' })
  });
  assert.equal(llamadasLLM, 0);
  assert.ok(enviados.some((m) => String(m.payload.text || '').includes('Antes de actuar')), 'pide confirmacion de voz');
  assert.ok(!enviados.some((m) => String(m.payload.text || '').includes('aprobada')), 'no aprueba por audio sin el si');

  // Y un "si" textual confirma la accion original (que aprueba la skill).
  await bot.procesarMensajesEntrantes(sockSimulado(enviados), {
    messages: [mensajeEntrante('si', 'SIM-AUDIO-2')],
    type: 'notify'
  }, { chatCompletion: llm, skipPersistencia: true });
  assert.ok(enviados.some((m) => String(m.payload.text || '').includes('aprobada')), 'el si textual aprueba');
});

test('Regresion: la directiva de skills esta en el prompt del agente (el modelo la ve)', async () => {
  // El 400 real de Groq del 6-nov ("attempted to call tool
  // 'consultar_estado_servidor' which was not in request.tools") ocurrio
  // porque el prompt nunca mencionaba las skills: el modelo seguia la regla 7
  // e invocaba la herramienta interna directamente. La directiva 15 lo evita.
  const { consultarJarvis } = await import('../../src/core/jarvisAgent.js');
  let promptSistema = '';
  const chat = async ({ messages }) => {
    promptSistema = (messages.find((m) => m.role === 'system') || {}).content || '';
    return { message: { content: 'vale' } };
  };
  await consultarJarvis('haz el diagnostico de davis', [], { chatId: 'test-skills-prompt', chatCompletion: chat });
  assert.ok(promptSistema.includes('15. SKILLS'), 'la directiva 15 de skills esta en el prompt');
  assert.ok(promptSistema.includes('ejecutar_skill'), 'la directiva nombra ejecutar_skill');
  assert.ok(promptSistema.includes('EN LUGAR de llamar a las herramientas individuales'), 'la directiva prefiere la skill sobre llamadas individuales');
});
