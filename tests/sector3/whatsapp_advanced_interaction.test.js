/**
 * whatsapp_advanced_interaction.test.js
 *
 * Bateria de pruebas de Interaccion WhatsApp Avanzada:
 * - Deteccion precisa de menciones y resumenes en grupos (@g.us).
 * - Enrutamiento fail-closed de mensajes grupales no dirigidos a DAVIS.
 * - Manejo interactivo de botones (OTP, borrado destructivo, finanzas y planes).
 * - Directiva duplex y sanitizacion de texto para sintesis de voz Edge-TTS.
 *
 * Strict Policy: Zero Emojis.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esMensajeParaDavisEnGrupo,
  limpiarMencionGrupo,
  procesarMensajeGrupo
} from '../../src/services/groupInteractionService.js';
import {
  manejarRespuestaInteractiva,
  enviarConfirmacionInteractiva
} from '../../src/services/interactiveActionHandler.js';
import { limpiarTextoParaVoz } from '../../src/services/textFormatService.js';

test('esMensajeParaDavisEnGrupo detecta menciones explicitas y filtra mensajes ajenos', () => {
  const grupoJid = '12036304@g.us';

  // 1. Mencion textual con arroba
  const msg1 = { key: { remoteJid: grupoJid } };
  assert.equal(esMensajeParaDavisEnGrupo(msg1, '@davis como esta el servidor?'), true);

  // 2. Invocacion por prefijo con dos puntos
  assert.equal(esMensajeParaDavisEnGrupo(msg1, 'davis: cual es el estado?'), true);

  // 3. Peticion de resumen grupal
  assert.equal(esMensajeParaDavisEnGrupo(msg1, 'resume el grupo por favor'), true);
  assert.equal(esMensajeParaDavisEnGrupo(msg1, 'davis que paso en el grupo'), true);

  // 4. Mencion nativa Baileys contextInfo.mentionedJid
  const msgMencionNativa = {
    key: { remoteJid: grupoJid },
    message: {
      extendedTextMessage: {
        contextInfo: {
          mentionedJid: ['34600112233@s.whatsapp.net']
        }
      }
    }
  };
  assert.equal(
    esMensajeParaDavisEnGrupo(msgMencionNativa, 'puedes revisar esto?', { botJid: '34600112233@s.whatsapp.net' }),
    true
  );

  // 5. Conversacion normal entre miembros sin nombrar a DAVIS: debe devolver false
  const msgAjeno = { key: { remoteJid: grupoJid } };
  assert.equal(esMensajeParaDavisEnGrupo(msgAjeno, 'alguien va a comer a las 2?'), false);
  assert.equal(esMensajeParaDavisEnGrupo(msgAjeno, 'hola carlos nos vemos luego'), false);
});

test('limpiarMencionGrupo extrae el comando limpio sin la llamada inicial', () => {
  assert.equal(limpiarMencionGrupo('@davis dime las notas de ayer'), 'dime las notas de ayer');
  assert.equal(limpiarMencionGrupo('davis: genera el reporte'), 'genera el reporte');
  assert.equal(limpiarMencionGrupo('@davis'), '');
});

test('procesarMensajeGrupo registra mensaje y guarda silencio si no es llamado', async () => {
  let registrado = false;
  const sock = {
    sendMessage: async () => {
      throw new Error('No debio enviar mensaje');
    }
  };
  const msg = {
    key: { remoteJid: '12036304@g.us', participant: '34699999999@s.whatsapp.net' }
  };

  const res = await procesarMensajeGrupo(sock, msg, 'hola a todos', {
    recordGroupMessage: async () => {
      registrado = true;
    }
  });

  assert.equal(registrado, true);
  assert.equal(res.gestionado, false);
  assert.equal(res.ignorado, true);
});

test('procesarMensajeGrupo responde a peticion de resumen en el grupo', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload, opts) => {
      enviados.push({ jid, payload, opts });
      return { key: { id: 'test_id' } };
    }
  };
  const msg = {
    key: { remoteJid: '12036304@g.us', id: 'msg_resumen_1' }
  };

  const res = await procesarMensajeGrupo(sock, msg, 'davis resume el grupo', {
    recordGroupMessage: async () => {},
    generateGroupSummary: async (jid) => `Resumen generado del grupo ${jid}: todo en calma.`
  });

  assert.equal(res.gestionado, true);
  assert.equal(res.tipo, 'resumen');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /Resumen generado del grupo/);
  assert.equal(enviados[0].opts.quoted, msg);
});

test('procesarMensajeGrupo delega consulta al agente cuando es mencionado', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload, opts) => {
      enviados.push({ jid, payload, opts });
      return { key: { id: 'test_id' } };
    }
  };
  const msg = {
    key: { remoteJid: '12036304@g.us', participant: '34611111111@s.whatsapp.net' }
  };

  const res = await procesarMensajeGrupo(sock, msg, '@davis cual es el estado?', {
    recordGroupMessage: async () => {},
    procesarMensajeAgente: async (cmd, meta) => {
      assert.equal(cmd, 'cual es el estado?');
      assert.equal(meta.esGrupo, true);
      return 'El sistema esta operativo al 100%.';
    }
  });

  assert.equal(res.gestionado, true);
  assert.equal(res.tipo, 'agente');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].payload.text, /El sistema esta operativo/);
});

test('manejarRespuestaInteractiva procesa confirmacion OTP de bash console', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return {};
    }
  };

  let otpVerificado = null;
  const deps = {
    confirmAndExecute: async (otp) => {
      otpVerificado = otp;
      return { ok: true, stdout: 'Procesos PM2 reiniciados con exito' };
    }
  };

  const interactive = {
    id: 'btn_otp_confirm_984512'
  };

  const res = await manejarRespuestaInteractiva(sock, '34600112233@s.whatsapp.net', interactive, deps);
  assert.equal(res.gestionado, true);
  assert.equal(otpVerificado, '984512');
  assert.match(enviados[0].payload.text, /Procesos PM2 reiniciados/);
});

test('manejarRespuestaInteractiva procesa cancelacion de OTP', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return {};
    }
  };

  const interactive = { id: 'btn_otp_cancel' };
  const res = await manejarRespuestaInteractiva(sock, '34600112233@s.whatsapp.net', interactive);
  assert.equal(res.gestionado, true);
  assert.match(enviados[0].payload.text, /cancelada por el usuario/);
});

test('manejarRespuestaInteractiva procesa confirmacion y descarte de borrador de gastos', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return {};
    }
  };

  let gastoConfirmado = false;
  let gastoDescartado = false;

  const deps = {
    confirmarBorrador: async () => {
      gastoConfirmado = true;
      return { ok: true, gasto: { concepto: 'Supermercado', importe: 45.5 } };
    },
    descartarBorrador: () => {
      gastoDescartado = true;
      return true;
    }
  };

  // 1. Confirmar
  const resConf = await manejarRespuestaInteractiva(sock, '34600112233@s.whatsapp.net', { id: 'btn_gasto_confirmar' }, deps);
  assert.equal(resConf.gestionado, true);
  assert.equal(gastoConfirmado, true);
  assert.match(enviados[0].payload.text, /Supermercado/);

  // 2. Descartar
  const resDesc = await manejarRespuestaInteractiva(sock, '34600112233@s.whatsapp.net', { id: 'btn_gasto_descartar' }, deps);
  assert.equal(resDesc.gestionado, true);
  assert.equal(gastoDescartado, true);
  assert.match(enviados[1].payload.text, /descartado/);
});

test('manejarRespuestaInteractiva procesa upgrade de tenant con boton', async () => {
  const enviados = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      enviados.push({ jid, payload });
      return {};
    }
  };

  let planSolicitado = null;
  const deps = {
    tenantId: 'tenant_clinica',
    procesarUpgradePlan: (tid, plan) => {
      planSolicitado = plan;
      return `Upgrade a ${plan} procesado para ${tid}`;
    }
  };

  const res = await manejarRespuestaInteractiva(sock, '34600112233@s.whatsapp.net', { id: 'btn_upgrade_business' }, deps);
  assert.equal(res.gestionado, true);
  assert.equal(planSolicitado, 'business');
  assert.match(enviados[0].payload.text, /Upgrade a business/);
});

test('limpiarTextoParaVoz prepara el texto para sintesis fluida en Edge-TTS', () => {
  const textoEntrada = `
# Titulo Principal
Hola David, aqui tienes el **resumen**:
- Tarea 1: verificar base de datos en \`sqlite.db\`
- Tarea 2: consultar https://docs.google.com/doc123
\`\`\`bash
npm run build
\`\`\`
| Col1 | Col2 |
| A    | B    |
`;

  const limpio = limpiarTextoParaVoz(textoEntrada);

  // No debe contener asteriscos, backticks, tablas con pipes ni urls crudas
  assert.equal(limpio.includes('**'), false);
  assert.equal(limpio.includes('```'), false);
  assert.equal(limpio.includes('`'), false);
  assert.equal(limpio.includes('|'), false);
  assert.equal(limpio.includes('https://'), false);
  assert.match(limpio, /Hola David, aqui tienes el resumen/);
  assert.match(limpio, /enlace web/);
  assert.match(limpio, /bloque de codigo omitido/);
});
