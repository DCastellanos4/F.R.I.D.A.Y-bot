import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consultarJarvis } from '../../src/core/jarvisAgent.js';
import {
  evaluarResultadoRonda,
  necesitaCriticaFinal,
  detectarDefectosBorrador,
  reflexionarYCriticarRespuesta
} from '../../src/services/cognitiveReflectionService.js';

const IDEMPOTENTES_BASE = new Set([
  'consultar_clima',
  'buscar_memoria',
  'listar_memorias',
  'listar_notas_recientes',
  'obtener_noticias_actuales',
  'resumir_enlace',
  'consultar_estado_servidor'
]);

test('evaluarResultadoRonda replanifica cuando falla una herramienta de solo lectura y existe alternativa segura', () => {
  const res = evaluarResultadoRonda({
    mensajeUsuario: 'busca mis notas sobre el proyecto',
    llamadasRonda: [{ id: 'c1', name: 'buscar_memoria', arguments: { consulta: 'proyecto' } }],
    resultadosRonda: [{ id: 'c1', name: 'buscar_memoria', status: 'error', result: 'Error al consultar indice', error: 'ENOENT' }],
    herramientasDisponibles: ['buscar_memoria', 'listar_memorias', 'crear_evento'],
    idempotentesSet: IDEMPOTENTES_BASE
  });

  assert.equal(res.replanificar, true);
  assert.equal(res.motivo, 'error_herramienta_lectura');
  assert.equal(res.herramientaAfectada, 'buscar_memoria');
  assert.deepEqual(res.alternativas, ['listar_memorias']);
  assert.match(res.sugerencia, /listar_memorias/);
  assert.doesNotMatch(res.sugerencia, /crear_evento/);
});

test('evaluarResultadoRonda replanifica cuando una herramienta de solo lectura devuelve vacio y hay alternativa', () => {
  const casosVacios = ['', '   ', '[]', '{}', null, 'Sin resultados para la consulta'];
  for (const valorVacio of casosVacios) {
    const res = evaluarResultadoRonda({
      mensajeUsuario: 'que notas tengo guardadas',
      llamadasRonda: [{ id: 'c1', name: 'buscar_memoria' }],
      resultadosRonda: [{ id: 'c1', name: 'buscar_memoria', status: 'ok', result: valorVacio }],
      herramientasDisponibles: ['buscar_memoria', 'listar_notas_recientes'],
      idempotentesSet: IDEMPOTENTES_BASE
    });
    assert.equal(res.replanificar, true);
    assert.equal(res.motivo, 'resultado_vacio_herramienta_lectura');
    assert.ok(res.alternativas.includes('listar_notas_recientes'));
  }
});

test('evaluarResultadoRonda NUNCA sugiere re-ejecutar ni replanificar herramientas mutantes', () => {
  const mutantes = ['crear_evento', 'registrar_gasto', 'enviar_mensaje_whatsapp', 'guardar_memoria'];
  for (const mutante of mutantes) {
    const res = evaluarResultadoRonda({
      mensajeUsuario: 'haz esta accion',
      llamadasRonda: [{ id: 'm1', name: mutante }],
      resultadosRonda: [{ id: 'm1', name: mutante, status: 'error', result: 'Error de red' }],
      herramientasDisponibles: [mutante, 'listar_memorias', 'consultar_clima'],
      idempotentesSet: IDEMPOTENTES_BASE
    });

    assert.equal(res.replanificar, false);
    assert.equal(res.motivo, 'herramienta_mutante_no_replanificable');
    assert.equal(res.sugerencia, null);
  }
});

test('evaluarResultadoRonda ignora alternativas mutantes y devuelve false si no hay alternativa de lectura', () => {
  const soloMutanteComoAlt = evaluarResultadoRonda({
    llamadasRonda: [{ id: 'c1', name: 'buscar_memoria' }],
    resultadosRonda: [{ id: 'c1', name: 'buscar_memoria', status: 'error', result: 'Error' }],
    herramientasDisponibles: ['buscar_memoria', 'guardar_memoria', 'crear_evento'],
    idempotentesSet: IDEMPOTENTES_BASE
  });
  assert.equal(soloMutanteComoAlt.replanificar, false);
  assert.equal(soloMutanteComoAlt.motivo, 'sin_alternativa_lectura_disponible');
  assert.equal(soloMutanteComoAlt.sugerencia, null);

  const sinIncidencias = evaluarResultadoRonda({
    llamadasRonda: [{ id: 'c1', name: 'consultar_clima' }],
    resultadosRonda: [{ id: 'c1', name: 'consultar_clima', status: 'ok', result: '21 grados, despejado' }],
    herramientasDisponibles: ['consultar_clima', 'obtener_noticias_actuales'],
    idempotentesSet: IDEMPOTENTES_BASE
  });
  assert.equal(sinIncidencias.replanificar, false);
  assert.equal(sinIncidencias.motivo, 'ronda_sin_incidencias');
});

test('evaluarResultadoRonda no replanifica ante estados de bloqueo de seguridad o idempotencia', () => {
  const res = evaluarResultadoRonda({
    llamadasRonda: [{ id: 'c1', name: 'buscar_memoria' }],
    resultadosRonda: [{ id: 'c1', name: 'buscar_memoria', status: 'blocked', result: 'Bloqueado' }],
    herramientasDisponibles: ['buscar_memoria', 'listar_memorias'],
    idempotentesSet: IDEMPOTENTES_BASE
  });
  assert.equal(res.replanificar, false);
});

test('necesitaCriticaFinal descarta turnos simples, chat dorado, reflexion desactivada y borradores vacios', () => {
  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'hola',
    textoBorrador: 'Buenas, en que te ayudo.',
    llamadas: []
  }), false);

  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'que tiempo hace',
    textoBorrador: 'En Madrid hace 20 grados.',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'ok' }]
  }), false);

  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'dime clima y noticias',
    textoBorrador: 'Aqui tienes todo.',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'ok' }, { nombre: 'obtener_noticias_actuales', resultado: 'ok' }],
    opciones: { habilitarReflexion: false }
  }), false);

  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'dime clima y noticias',
    textoBorrador: 'Aqui tienes todo.',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'ok' }, { nombre: 'obtener_noticias_actuales', resultado: 'ok' }],
    opciones: { chatId: 'chat-dorado@test' }
  }), false);

  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'dime clima y noticias',
    textoBorrador: '   ',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'error' }]
  }), false);
});

test('necesitaCriticaFinal devuelve true con >=2 llamadas o >=1 llamada con error', () => {
  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'que tiempo hace',
    textoBorrador: 'Hace 20 grados en Madrid.',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'error' }]
  }), true);

  assert.equal(necesitaCriticaFinal({
    mensajeUsuario: 'clima y recordatorios',
    textoBorrador: 'Hace sol y tienes dos recordatorios.',
    llamadas: [
      { nombre: 'consultar_clima', resultado: 'ok' },
      { nombre: 'listar_recordatorios', resultado: 'ok' }
    ]
  }), true);
});

test('detectarDefectosBorrador detecta errores de herramienta omitidos y borradores truncados o vacios', () => {
  const omitido = detectarDefectosBorrador({
    mensajeUsuario: 'mira el clima y mis recordatorios',
    textoBorrador: 'Tienes dos recordatorios pendientes para esta tarde.',
    llamadas: [
      { nombre: 'listar_recordatorios', resultado: 'ok' },
      { nombre: 'consultar_clima', resultado: 'error', detalle: 'timeout' }
    ]
  });
  assert.equal(omitido.hayDefectos, true);
  assert.deepEqual(omitido.erroresOmitidos, ['consultar_clima']);
  assert.ok(omitido.defectos.some((d) => d.includes('error_herramienta_omitido:consultar_clima')));

  const reconocido = detectarDefectosBorrador({
    mensajeUsuario: 'mira el clima y mis recordatorios',
    textoBorrador: 'Tienes dos recordatorios pendientes, pero no pude consultar el clima por un error temporal.',
    llamadas: [
      { nombre: 'listar_recordatorios', resultado: 'ok' },
      { nombre: 'consultar_clima', resultado: 'error', detalle: 'timeout' }
    ]
  });
  assert.equal(reconocido.hayDefectos, false);
  assert.deepEqual(reconocido.erroresOmitidos, []);

  const cortoMultiTool = detectarDefectosBorrador({
    mensajeUsuario: 'resume agenda y compras',
    textoBorrador: 'Listo.',
    llamadas: [
      { nombre: 'listar_eventos', resultado: 'ok' },
      { nombre: 'listar_compra', resultado: 'ok' }
    ]
  });
  assert.equal(cortoMultiTool.hayDefectos, true);
  assert.equal(cortoMultiTool.truncadoOVacio, true);

  const vacio = detectarDefectosBorrador({
    mensajeUsuario: 'hola',
    textoBorrador: '',
    llamadas: []
  });
  assert.equal(vacio.hayDefectos, true);
  assert.equal(vacio.truncadoOVacio, true);

  const cortoSimpleValido = detectarDefectosBorrador({
    mensajeUsuario: 'temperatura',
    textoBorrador: '22 grados.',
    llamadas: [{ nombre: 'consultar_clima', resultado: 'ok' }]
  });
  assert.equal(cortoSimpleValido.hayDefectos, false);
});

test('reflexionarYCriticarRespuesta tiene coste 0 cuando no hace falta critica o no hay defectos', async () => {
  let invocaciones = 0;
  const fakeChat = async () => {
    invocaciones++;
    return { message: { content: 'No deberia llamarse' } };
  };

  const turnoSimple = await reflexionarYCriticarRespuesta({
    mensajeUsuario: 'que hora es',
    textoBorrador: 'Son las 10:00.',
    llamadas: [{ nombre: 'consultar_hora', resultado: 'ok' }],
    chatCompletion: fakeChat
  });
  assert.equal(turnoSimple.revisado, false);
  assert.equal(turnoSimple.llamadasLlm, 0);
  assert.equal(turnoSimple.texto, 'Son las 10:00.');

  const sinDefectos = await reflexionarYCriticarRespuesta({
    mensajeUsuario: 'clima y recordatorios',
    textoBorrador: 'En Madrid hace 20 grados y tienes una reunion a las 17:00.',
    llamadas: [
      { nombre: 'consultar_clima', resultado: 'ok', datos: '20 grados' },
      { nombre: 'listar_recordatorios', resultado: 'ok', datos: 'Reunion 17:00' }
    ],
    chatCompletion: fakeChat
  });
  assert.equal(sinDefectos.revisado, false);
  assert.equal(sinDefectos.llamadasLlm, 0);
  assert.equal(invocaciones, 0);
});

test('reflexionarYCriticarRespuesta ejecuta maximo 1 llamada LLM sin tools e incluye solo hechos reales', async () => {
  const peticionesRecibidas = [];
  const fakeChat = async (peticion) => {
    peticionesRecibidas.push(peticion);
    return {
      message: {
        role: 'assistant',
        content: 'Tienes una reunion a las 17:00, pero no he podido consultar el clima por un error en el servicio.'
      }
    };
  };

  const res = await reflexionarYCriticarRespuesta({
    mensajeUsuario: 'dime mis recordatorios y el clima',
    textoBorrador: 'Tienes una reunion a las 17:00.',
    llamadas: [
      { nombre: 'listar_recordatorios', resultado: 'ok', datos: 'Reunion 17:00' },
      { nombre: 'consultar_clima', resultado: 'error', detalle: '503 upstream' }
    ],
    chatCompletion: fakeChat,
    maxRevisiones: 4 // debe acotarse estrictamente a 1
  });

  assert.equal(peticionesRecibidas.length, 1);
  assert.equal('tools' in peticionesRecibidas[0], false);
  assert.equal(res.revisado, true);
  assert.equal(res.llamadasLlm, 1);
  assert.match(res.texto, /no he podido consultar el clima/i);
  assert.match(peticionesRecibidas[0].messages[1].content, /503 upstream/);
});

test('reflexionarYCriticarRespuesta soporta forzarCriticaLlm y captura errores de cuota sin romper el borrador', async () => {
  let intentos = 0;
  const fakeChatFalloCuota = async () => {
    intentos++;
    throw new Error('429 rate_limit_exceeded: cuota agotada');
  };

  const borrador = 'Resumen completo de tus tareas y gastos del dia.';
  const res = await reflexionarYCriticarRespuesta({
    mensajeUsuario: 'resume tareas y gastos',
    textoBorrador: borrador,
    llamadas: [
      { nombre: 'listar_recordatorios', resultado: 'ok' },
      { nombre: 'listar_gastos', resultado: 'ok' }
    ],
    chatCompletion: fakeChatFalloCuota,
    opciones: { forzarCriticaLlm: true }
  });

  assert.equal(intentos, 1);
  assert.equal(res.revisado, false);
  assert.equal(res.llamadasLlm, 1);
  assert.equal(res.texto, borrador);
  assert.equal(res.motivo, 'error_critica_llm');
  assert.match(res.error, /cuota agotada/);
});

test('politica estricta de cero emojis en servicio y archivo de pruebas', () => {
  const rxEmoji = /\p{Extended_Pictographic}/u;
  const archivos = [
    path.resolve('src/services/cognitiveReflectionService.js'),
    path.resolve('tests/cognitive/cognitive_reflection.test.js')
  ];
  for (const archivo of archivos) {
    const contenido = fs.readFileSync(archivo, 'utf-8');
    assert.equal(rxEmoji.test(contenido), false, `Se detecto emoji prohibido en ${archivo}`);
  }
});

test('integracion consultarJarvis replanifica post-ronda y ejecuta critica pre-guardrail guardando traza.reflexion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-reflection-int-'));
  let turnoLlm = 0;
  let vioHintPostRonda = false;

  try {
    // 1) Replanificacion post-ronda cuando buscar_memoria (idempotente) falla
    const resReplan = await consultarJarvis('busca en tu memoria lo de proyecto alfa', [], {
      chatId: 'reflection-replan-chat',
      carpetaTrazas: dir,
      rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      ejecutores: {
        buscar_memoria: async () => { throw new Error('indice corrupto'); },
        listar_memorias: async () => 'Proyecto Alfa: lanzamiento lunes.'
      },
      chatCompletion: async (peticion) => {
        turnoLlm++;
        if (turnoLlm === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'm1', function: { name: 'buscar_memoria', arguments: { consulta: 'alfa' } } }]
            }
          };
        }
        if (turnoLlm === 2) {
          const ultimo = peticion.messages[peticion.messages.length - 1];
          if (ultimo && typeof ultimo.content === 'string' && ultimo.content.includes('[REFLEXION POST-RONDA]')) {
            vioHintPostRonda = true;
          }
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'm2', function: { name: 'listar_memorias', arguments: {} } }]
            }
          };
        }
        return {
          message: {
            role: 'assistant',
            content: 'El buscador dio un error temporal, pero en tus memorias consta que Proyecto Alfa se lanza el lunes.'
          }
        };
      }
    });

    assert.equal(vioHintPostRonda, true);
    assert.ok(Array.isArray(resReplan.traza.reflexion?.replanificaciones));
    assert.equal(resReplan.traza.reflexion.replanificaciones[0].herramientaAfectada, 'buscar_memoria');
    assert.match(resReplan.respuesta, /Proyecto Alfa/i);

    // 2) Critica pre-guardrail cuando borrador omite error de herramienta
    let llamadasCritica = 0;
    const resCritica = await consultarJarvis('dime el clima en Madrid y lista mis recordatorios', [], {
      chatId: 'reflection-critica-chat',
      carpetaTrazas: dir,
      rutaArchivoIdempotencia: path.join(dir, 'idemp.json'),
      retornarTraza: true,
      topKMemorias: 0,
      habilitarPlanner: false,
      ejecutores: {
        consultar_clima: async () => { throw new Error('timeout meteo'); },
        listar_recordatorios: async () => 'Llamar al dentista a las 17:00'
      },
      chatCompletion: async (peticion) => {
        const sys = peticion.messages[0]?.content || '';
        if (sys.includes('revisor critico interno')) {
          llamadasCritica++;
          assert.equal('tools' in peticion, false);
          return {
            message: {
              role: 'assistant',
              content: 'Tienes que llamar al dentista a las 17:00, pero no pude consultar el clima por un error temporal.'
            }
          };
        }
        const hayTool = peticion.messages.some((m) => m.role === 'tool');
        if (!hayTool) {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                { id: 'c1', function: { name: 'consultar_clima', arguments: { ubicacion: 'Madrid' } } },
                { id: 'c2', function: { name: 'listar_recordatorios', arguments: {} } }
              ]
            }
          };
        }
        return {
          message: {
            role: 'assistant',
            content: 'Tienes que llamar al dentista a las 17:00.'
          }
        };
      }
    });

    assert.equal(llamadasCritica, 1);
    assert.equal(resCritica.traza.reflexion.revisado, true);
    assert.equal(resCritica.traza.reflexion.llamadasLlm, 1);
    assert.ok(resCritica.traza.reflexion.defectosDetectados.includes('error_herramienta_omitido:consultar_clima'));
    assert.match(resCritica.respuesta, /no pude consultar el clima/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
