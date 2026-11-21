import test from 'node:test';
import assert from 'node:assert/strict';
import { analizarIntencion } from '../../src/core/jarvisAgent.js';
import { validarMensajeSalida, guardHallucinations } from '../../src/services/preSendGuardrailService.js';

test('Enrutador reconoce intencion de listar contactos por lenguaje natural', () => {
  const frases = [
    'dime los contactos que tengo',
    'que contactos tenemos guardados?',
    'mis contactos',
    'listar contactos',
    'ver mis contactos',
    'contactos guardados'
  ];

  for (const f of frases) {
    const res = analizarIntencion(f);
    assert.strictEqual(res.safetyNet, false, `Frase "${f}" no debe caer en safety net`);
    assert.ok(res.intenciones.includes('contactos') || res.intenciones.includes('cerebro'), `Frase "${f}" debe tener intencion contactos o cerebro`);
    const nombresTools = res.herramientas.map((h) => h.function.name);
    assert.ok(nombresTools.includes('listar_contactos'), `Frase "${f}" debe incluir herramienta listar_contactos`);
  }
});

test('validarMensajeSalida no censura telefonos de contactos conocidos', () => {
  const textoRespuesta = [
    'Contactos guardados:',
    '- Paula: +34 690 358 664',
    '- Hugo Gemelo: +34611413819',
    '- Padre: +34 617 85 68 05',
    '- Madre: 676899520'
  ].join('\n');

  const contexto = {
    chatId: '34635605605@s.whatsapp.net',
    contactosConocidos: [
      { nombre: 'Paula', telefono: '+34690358664' },
      { nombre: 'Hugo Gemelo', telefono: '+34611413819' },
      { nombre: 'Padre', telefono: '+34 617 85 68 05' },
      { nombre: 'Madre', telefono: '676899520' }
    ]
  };

  const res = validarMensajeSalida(textoRespuesta, contexto);
  assert.strictEqual(res.textoFinal.includes('[NUMERO_NO_VERIFICADO]'), false);
  assert.ok(res.textoFinal.includes('676899520'));
  assert.ok(res.textoFinal.includes('+34611413819'));
  assert.strictEqual(res.correccionesAplicadas.length, 0);
});

test('guardHallucinations acepta telefonos formateados con espacios desde resultados de herramientas', () => {
  const textoRespuesta = 'El contacto de tu padre es +34 617 85 68 05 y el de tu madre es 676899520.';
  const contexto = {
    destinatario: '34635605605@s.whatsapp.net',
    traza: {
      reactSteps: [
        {
          phase: 'observe',
          toolResults: [
            {
              id: 'call_1',
              name: 'listar_contactos',
              result: 'Tus contactos:\n- Padre: +34 617 85 68 05\n- Madre: 676899520'
            }
          ]
        }
      ]
    }
  };

  const res = guardHallucinations(textoRespuesta, contexto);
  assert.strictEqual(res.huboCorreccion, false);
  assert.strictEqual(res.textoModificado.includes('[NUMERO_NO_VERIFICADO]'), false);
});
