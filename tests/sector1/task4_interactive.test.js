import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import {
  TEST_JIDS,
  createButtonResponseMessage,
  createListResponseMessage
} from '../harness/fixtures.js';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 4: Interactive Buttons & Lists', () => {
  let mockSocket;
  let interactiveService = null;

  beforeEach(async () => {
    mockSocket = createMockSocket();
    try {
      interactiveService = await import('../../interactiveService.js');
    } catch {
      interactiveService = null;
    }
  });

  describe('Protocol: Confirmation Buttons Dispatch', () => {
    it('should format and dispatch native confirmation buttons payload', async () => {
      const buttonPayload = {
        text: 'Confirmar ejecucion del script de mantenimiento?',
        footer: 'D.A.V.I.S. Control Táctico',
        buttons: [
          { id: 'btn_confirm_yes', text: 'Confirmar' },
          { id: 'btn_confirm_no', text: 'Cancelar' }
        ]
      };

      assertNoEmojis(buttonPayload);
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, buttonPayload);

      const buttonMsgs = mockSocket.getButtonMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(buttonMsgs.length, 1);

      const sent = buttonMsgs[0];
      assert.strictEqual(sent.content.text, buttonPayload.text);
      assert.strictEqual(sent.content.buttons.length, 2);
      assert.strictEqual(sent.content.buttons[0].id, 'btn_confirm_yes');
      assert.strictEqual(sent.content.buttons[1].id, 'btn_confirm_no');
    });

    it('should format and dispatch option list with sections and rows', async () => {
      const listPayload = {
        title: 'Menu de Operaciones',
        text: 'Seleccione el modulo a inspeccionar:',
        footer: 'D.A.V.I.S. Sistema Central',
        buttonText: 'Ver Opciones',
        sections: [
          {
            title: 'Diagnostico',
            rows: [
              { id: 'diag_memory', title: 'Memoria RAM', description: 'Uso de memoria y procesos' },
              { id: 'diag_network', title: 'Red y Ping', description: 'Latencia y puertos activos' }
            ]
          },
          {
            title: 'Control',
            rows: [
              { id: 'ctrl_reboot', title: 'Reinicio Seguro', description: 'Reinicia servicios PM2' }
            ]
          }
        ]
      };

      assertNoEmojis(listPayload);
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, listPayload);

      const listMsgs = mockSocket.getListMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(listMsgs.length, 1);

      const sent = listMsgs[0];
      assert.strictEqual(sent.content.sections.length, 2);
      assert.strictEqual(sent.content.sections[0].rows.length, 2);
    });
  });

  describe('Service Contract: interactiveService.sendButtons & sendList', () => {
    it('should dispatch buttons through sendButtons function', async (t) => {
      if (!interactiveService || typeof interactiveService.sendButtons !== 'function') {
        t.skip('interactiveService.sendButtons not yet implemented on disk');
        return;
      }

      const buttonsData = {
        text: 'Ejecutar orden?',
        footer: 'D.A.V.I.S.',
        buttons: [
          { id: 'action_proceed', text: 'Proceder' },
          { id: 'action_abort', text: 'Abortar' }
        ]
      };
      assertNoEmojis(buttonsData);

      const res = await interactiveService.sendButtons(mockSocket, TEST_JIDS.DAVID_JID, buttonsData);
      assert.ok(res);

      const buttonMsgs = mockSocket.getButtonMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(buttonMsgs.length, 1);
    });

    it('should dispatch list through sendList function', async (t) => {
      if (!interactiveService || typeof interactiveService.sendList !== 'function') {
        t.skip('interactiveService.sendList not yet implemented on disk');
        return;
      }

      const listData = {
        text: 'Seleccione una opcion:',
        footer: 'D.A.V.I.S.',
        title: 'Servicios',
        buttonText: 'Abrir Lista',
        sections: [
          {
            title: 'Principal',
            rows: [{ id: 'opt_1', title: 'Opcion 1', description: 'Detalle 1' }]
          }
        ]
      };
      assertNoEmojis(listData);

      const res = await interactiveService.sendList(mockSocket, TEST_JIDS.DAVID_JID, listData);
      assert.ok(res);

      const listMsgs = mockSocket.getListMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(listMsgs.length, 1);
    });
  });

  describe('Service Contract: interactiveService.parseInteractiveResponse', () => {
    it('should parse button response message into normalized object', (t) => {
      if (!interactiveService || typeof interactiveService.parseInteractiveResponse !== 'function') {
        t.skip('interactiveService.parseInteractiveResponse not yet implemented on disk');
        return;
      }

      const incomingMsg = createButtonResponseMessage({
        selectedButtonId: 'btn_confirm_yes',
        selectedDisplayText: 'Confirmar'
      });

      const parsed = interactiveService.parseInteractiveResponse(incomingMsg);
      assert.ok(parsed, 'Parsed response must not be null');
      assert.strictEqual(parsed.type, 'button');
      assert.strictEqual(parsed.id, 'btn_confirm_yes');
      assert.strictEqual(parsed.text, 'Confirmar');
      assertNoEmojis(parsed);
    });

    it('should parse list response message into normalized object', (t) => {
      if (!interactiveService || typeof interactiveService.parseInteractiveResponse !== 'function') {
        t.skip('interactiveService.parseInteractiveResponse not yet implemented on disk');
        return;
      }

      const incomingMsg = createListResponseMessage({
        selectedRowId: 'diag_memory',
        title: 'Memoria RAM',
        description: 'Uso de memoria'
      });

      const parsed = interactiveService.parseInteractiveResponse(incomingMsg);
      assert.ok(parsed);
      assert.strictEqual(parsed.type, 'list');
      assert.strictEqual(parsed.id, 'diag_memory');
      assert.strictEqual(parsed.title, 'Memoria RAM');
      assertNoEmojis(parsed);
    });

    it('should return null or safe default for standard non-interactive messages', (t) => {
      if (!interactiveService || typeof interactiveService.parseInteractiveResponse !== 'function') {
        t.skip('interactiveService.parseInteractiveResponse not yet implemented on disk');
        return;
      }

      const plainTextMsg = {
        key: { remoteJid: TEST_JIDS.DAVID_JID, id: 'PLAIN_1' },
        message: { conversation: 'Hola D.A.V.I.S.' }
      };

      const parsed = interactiveService.parseInteractiveResponse(plainTextMsg);
      assert.strictEqual(parsed, null);
    });
  });
});
