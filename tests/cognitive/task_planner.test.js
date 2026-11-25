import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';
import {
  detectarPeticionCompuesta,
  generarPlanEstructurado,
  actualizarProgresoPlan,
  pendientesDelPlan,
  formatearDirectivaPendientes,
  dividirEnClausulas
} from '../../src/services/taskPlannerService.js';

const RE_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('detectarPeticionCompuesta detecta conectores secuenciales, enumeraciones y multiples intenciones', () => {
  assert.equal(detectarPeticionCompuesta('Mira el tiempo en Madrid y luego creame un recordatorio para salir a correr'), true);
  assert.equal(detectarPeticionCompuesta('Revisa mis gastos del mes, despues anade leche a la compra'), true);
  assert.equal(detectarPeticionCompuesta('Consulta el proximo tren a Atocha; ademas mandale un whatsapp a Paula'), true);
  assert.equal(detectarPeticionCompuesta('Busca noticias de IA y creame una nota con el resumen'), true);
  assert.equal(detectarPeticionCompuesta('Mira mi agenda de hoy y mandale un mensaje a Carlos'), true);
  assert.equal(detectarPeticionCompuesta('Revisa el tiempo y anade pan a la lista de la compra'), true);
  assert.equal(detectarPeticionCompuesta('Mira las ofertas de portatiles y busca un vuelo a Roma'), true);

  // Enumeraciones
  assert.equal(detectarPeticionCompuesta('1) Consulta el clima en Sevilla 2) Crea un evento para manana 3) Lista mis recordatorios'), true);
  assert.equal(detectarPeticionCompuesta('1. Apunta 12 euros de comida\n2. Revisa mis habitos'), true);
  assert.equal(detectarPeticionCompuesta('- Mira el tiempo\n- Pon una alarma a las 7'), true);
  assert.equal(detectarPeticionCompuesta('Primero busca los trenes a Sol y segundo avisame a las 18:00'), true);

  // >=2 intenciones explicitas o dominios distintos con verbo compartido
  assert.equal(detectarPeticionCompuesta('Organiza mi tarde', ['calendario', 'recordatorio']), true);
  assert.equal(detectarPeticionCompuesta('Dime los trenes a Atocha y el tiempo en Madrid'), true);
});

test('detectarPeticionCompuesta NO marca chitchat ni consultas simples de clima o trenes', () => {
  // Chitchat
  assert.equal(detectarPeticionCompuesta('Hola, que tal estas?'), false);
  assert.equal(detectarPeticionCompuesta('Buenos dias, muchas gracias por todo', ['conversacion']), false);
  assert.equal(detectarPeticionCompuesta('Vale perfecto, luego hablamos', ['conversacion']), false);
  assert.equal(detectarPeticionCompuesta('Hola, ademas queria saludarte', ['conversacion']), false);
  assert.equal(detectarPeticionCompuesta('', []), false);
  assert.equal(detectarPeticionCompuesta(null, ['clima']), false);

  // Consultas simples de clima
  assert.equal(detectarPeticionCompuesta('Que tiempo hace en Madrid hoy?', ['clima']), false);
  assert.equal(detectarPeticionCompuesta('Va a llover hoy por la tarde en Valencia?'), false);
  assert.equal(detectarPeticionCompuesta('Que tiempo hace en Madrid y Barcelona?'), false);
  assert.equal(detectarPeticionCompuesta('Que temperatura hace manana despues de comer?'), false);

  // Consultas simples de trenes / transporte
  assert.equal(detectarPeticionCompuesta('Cuando sale el proximo tren a Atocha?', ['transporte']), false);
  assert.equal(detectarPeticionCompuesta('Hay cercanias desde Sol despues de las 18:00?'), false);
  assert.equal(detectarPeticionCompuesta('Proximas llegadas del autobus de la linea 27'), false);

  // Accion unica con conjuncion nominal
  assert.equal(detectarPeticionCompuesta('Anade pan y leche a la lista de la compra'), false);
});

test('dividirEnClausulas separa correctamente sin romper conjunciones nominales ni horas', () => {
  const c1 = dividirEnClausulas('1) Anade pan y leche a la lista de la compra 2) Consulta el tren despues de las 18:00 y luego mandale un whatsapp a Ana');
  assert.equal(c1.length, 3);
  assert.match(c1[0], /pan y leche/i);
  assert.match(c1[1], /despues de las 18:00/i);
  assert.match(c1[2], /whatsapp a Ana/i);
});

test('generarPlanEstructurado descompone en sub-objetivos ordenados con coste 0 LLM', () => {
  let llmLlamado = false;
  const chatCompletionMock = async () => {
    llmLlamado = true;
    return { message: { content: '[]' } };
  };

  const herramientasMock = [
    { type: 'function', function: { name: 'consultar_clima', description: 'Consulta el clima actual' } },
    { type: 'function', function: { name: 'anadir_compra', description: 'Anade articulos a la lista de la compra' } },
    { type: 'function', function: { name: 'programar_mensaje_whatsapp', description: 'Programa o envia un mensaje de WhatsApp' } }
  ];

  const plan = generarPlanEstructurado(
    'Consulta el tiempo en Madrid, luego anade huevos a la compra y mandale un whatsapp a Paula',
    {
      intenciones: ['clima', 'bienestar', 'mensajeProgramado'],
      herramientas: herramientasMock,
      chatCompletion: chatCompletionMock
    }
  );

  assert.equal(llmLlamado, false);
  assert.equal(plan.length, 3);

  assert.deepEqual(plan[0], {
    id: 1,
    descripcion: 'Consulta el tiempo en Madrid',
    dominio: 'clima',
    herramientaSugerida: 'consultar_clima',
    estado: 'pendiente'
  });

  assert.deepEqual(plan[1], {
    id: 2,
    descripcion: 'anade huevos a la compra',
    dominio: 'bienestar',
    herramientaSugerida: 'anadir_compra',
    estado: 'pendiente'
  });

  assert.deepEqual(plan[2], {
    id: 3,
    descripcion: 'mandale un whatsapp a Paula',
    dominio: 'mensajeProgramado',
    herramientaSugerida: 'programar_mensaje_whatsapp',
    estado: 'pendiente'
  });
});

test('generarPlanEstructurado soporta enumeraciones, catalogo por tokens y multi-intencion sin conectores', () => {
  const planEnum = generarPlanEstructurado(
    '1) Registra un gasto de 18 euros en cena 2) Crea un recordatorio para pagar el internet 3) Lista las noticias de hoy'
  );
  assert.equal(planEnum.length, 3);
  assert.equal(planEnum[0].dominio, 'finanzas');
  assert.equal(planEnum[0].herramientaSugerida, 'registrar_gasto');
  assert.equal(planEnum[1].dominio, 'recordatorio');
  assert.equal(planEnum[1].herramientaSugerida, 'crear_recordatorio');
  assert.equal(planEnum[2].dominio, 'noticias');
  assert.equal(planEnum[2].herramientaSugerida, 'obtener_noticias_actuales');

  // Coincidencia por tokens sobre herramientas personalizadas
  const planCustom = generarPlanEstructurado('Analiza la telemetria del cluster', {
    herramientas: [
      { function: { name: 'inspeccionar_telemetria_cluster', description: 'Analiza la telemetria y metricas del cluster' } }
    ]
  });
  assert.equal(planCustom.length, 1);
  assert.equal(planCustom[0].herramientaSugerida, 'inspeccionar_telemetria_cluster');

  // Multiples intenciones con una sola clausula
  const planMulti = generarPlanEstructurado('Prepara mi manana', {
    intenciones: ['clima', 'transporte']
  });
  assert.equal(planMulti.length, 2);
  assert.equal(planMulti[0].dominio, 'clima');
  assert.equal(planMulti[1].dominio, 'transporte');

  assert.deepEqual(generarPlanEstructurado(''), []);
  assert.deepEqual(generarPlanEstructurado(null), []);
});

test('actualizarProgresoPlan marca completado, fallido y reintentos sin mutar el plan original', () => {
  const planInicial = generarPlanEstructurado(
    'Mira el tiempo en Madrid, crea un recordatorio a las 19:00 y mandale un whatsapp a Paula'
  );
  assert.equal(planInicial.length, 3);

  const ronda1 = actualizarProgresoPlan(
    planInicial,
    [
      { id: 'c1', name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } },
      { id: 'c2', name: 'programar_mensaje_whatsapp', arguments: { numero: 'Paula', mensaje: 'Hola' } }
    ],
    [
      { id: 'c1', name: 'consultar_clima', result: '22C soleado', status: 'ok' },
      { id: 'c2', name: 'programar_mensaje_whatsapp', result: 'Bloqueado: destinatario no verificado', status: 'blocked' }
    ]
  );

  // Inmutabilidad del plan original
  assert.equal(planInicial[0].estado, 'pendiente');
  assert.equal(planInicial[2].estado, 'pendiente');

  assert.equal(ronda1[0].estado, 'completado');
  assert.equal(ronda1[1].estado, 'pendiente');
  assert.equal(ronda1[2].estado, 'fallido');

  // Ronda 2: se ejecuta el recordatorio pendiente y se reintenta el whatsapp con exito
  const ronda2 = actualizarProgresoPlan(
    ronda1,
    [
      { id: 'c3', name: 'crear_recordatorio', arguments: {} },
      { id: 'c4', name: 'programar_mensaje_whatsapp', arguments: {} }
    ],
    [
      { id: 'c3', name: 'crear_recordatorio', result: 'Recordatorio creado', status: 'ok' },
      { id: 'c4', name: 'programar_mensaje_whatsapp', result: 'Mensaje enviado', status: 'ok' }
    ]
  );

  assert.equal(ronda2[0].estado, 'completado');
  assert.equal(ronda2[1].estado, 'completado');
  assert.equal(ronda2[2].estado, 'completado');
});

test('actualizarProgresoPlan soporta fallback por dominio y formatos alternativos de ronda', () => {
  const plan = [
    { id: 1, descripcion: 'Ver que hay en la compra', dominio: 'bienestar', herramientaSugerida: 'anadir_compra', estado: 'pendiente' },
    { id: 2, descripcion: 'Apuntar un gasto', dominio: 'finanzas', herramientaSugerida: 'registrar_gasto', estado: 'pendiente' }
  ];

  // Fallback por dominio en bienestar (listar_compra pertenece a bienestar) + error explicito en finanzas
  const actualizado = actualizarProgresoPlan(
    plan,
    [{ name: 'listar_compra' }, { name: 'registrar_gasto', ok: false }],
    []
  );

  assert.equal(actualizado[0].estado, 'completado');
  assert.equal(actualizado[0].herramientaEjecutada, 'listar_compra');
  assert.equal(actualizado[1].estado, 'fallido');
});

test('pendientesDelPlan y formatearDirectivaPendientes generan guia concisa en espanol sin emojis', () => {
  const plan = generarPlanEstructurado(
    'Consulta el tiempo en Madrid y luego crea un recordatorio para llevar paraguas'
  );
  const trasRonda1 = actualizarProgresoPlan(
    plan,
    [{ id: 'c1', name: 'consultar_clima' }],
    [{ id: 'c1', name: 'consultar_clima', result: 'Lluvia debil', status: 'ok' }]
  );

  const pendientes = pendientesDelPlan(trasRonda1);
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].id, 2);
  assert.equal(pendientes[0].herramientaSugerida, 'crear_recordatorio');

  const directiva = formatearDirectivaPendientes(trasRonda1);
  assert.match(directiva, /PLAN PENDIENTE/);
  assert.match(directiva, /Paso 2/);
  assert.match(directiva, /crear_recordatorio/);
  assert.equal(RE_EMOJI.test(directiva), false);

  const trasRonda2 = actualizarProgresoPlan(
    trasRonda1,
    [{ id: 'c2', name: 'crear_recordatorio' }],
    [{ id: 'c2', name: 'crear_recordatorio', result: 'Creado', status: 'ok' }]
  );
  assert.deepEqual(pendientesDelPlan(trasRonda2), []);
  assert.equal(formatearDirectivaPendientes(trasRonda2), '');
});

test('cumplimiento estricto de politica de cero emojis en codigo y tests', () => {
  const raiz = process.cwd();
  const codigo = fs.readFileSync(path.join(raiz, 'src/services/taskPlannerService.js'), 'utf-8');
  const pruebas = fs.readFileSync(path.join(raiz, 'tests/cognitive/task_planner.test.js'), 'utf-8');

  assert.equal(RE_EMOJI.test(codigo), false, 'taskPlannerService.js no debe contener emojis');
  assert.equal(RE_EMOJI.test(pruebas), false, 'task_planner.test.js no debe contener emojis');
});

test('integracion consultarJarvis crea traza.planEjecucion y fuerza ronda pendiente antes de cerrar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-planner-int-'));
  const invocadas = [];
  const promptsVistos = [];
  let turnoLlm = 0;

  try {
    const res = await consultarJarvis(
      'Consulta el tiempo en Madrid y luego crea un recordatorio para llevar paraguas',
      [],
      {
        chatId: 'planner-int-chat',
        carpetaTrazas: dir,
        rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
        retornarTraza: true,
        topKMemorias: 0,
        habilitarReflexion: false,
        ejecutores: {
          consultar_clima: async () => {
            invocadas.push('consultar_clima');
            return 'Madrid: 19C, lluvia ligera';
          },
          crear_recordatorio: async () => {
            invocadas.push('crear_recordatorio');
            return 'Recordatorio creado: llevar paraguas';
          }
        },
        chatCompletion: async (peticion) => {
          turnoLlm++;
          const ultimo = peticion.messages[peticion.messages.length - 1];
          promptsVistos.push(ultimo?.content || '');
          if (turnoLlm === 1) {
            return {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 't1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } }]
              }
            };
          }
          if (turnoLlm === 2) {
            // Intenta cerrar dejando el recordatorio pendiente
            return {
              message: { role: 'assistant', content: 'En Madrid hace 19C con lluvia ligera.' }
            };
          }
          if (turnoLlm === 3) {
            assert.match(ultimo.content, /\[PLAN PENDIENTE\]/);
            assert.match(ultimo.content, /crear_recordatorio/);
            return {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 't2', function: { name: 'crear_recordatorio', arguments: { texto: 'llevar paraguas', cuando: 'hoy 18:00' } } }]
              }
            };
          }
          return {
            message: { role: 'assistant', content: 'Listo: en Madrid hay 19C con lluvia ligera y ya cree el recordatorio para llevar paraguas.' }
          };
        }
      }
    );

    assert.equal(turnoLlm, 4);
    assert.deepEqual(invocadas, ['consultar_clima', 'crear_recordatorio']);
    assert.equal(res.traza.complejidad.razon, 'peticion_compuesta_multi_paso');
    assert.ok(Array.isArray(res.traza.planEjecucion));
    assert.equal(res.traza.planEjecucion.length, 2);
    assert.equal(res.traza.planEjecucion[0].estado, 'completado');
    assert.equal(res.traza.planEjecucion[1].estado, 'completado');
    assert.equal(pendientesDelPlan(res.traza.planEjecucion).length, 0);
    assert.match(res.respuesta, /paraguas/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
