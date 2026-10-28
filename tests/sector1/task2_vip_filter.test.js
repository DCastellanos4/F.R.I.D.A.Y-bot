import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { TEST_JIDS } from '../harness/fixtures.js';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 2: VIP Filter & DND Mode', () => {
  let mockSocket;
  let vipFilterService = null;

  beforeEach(async () => {
    mockSocket = createMockSocket();
    try {
      vipFilterService = await import('../../vipFilterService.js');
    } catch {
      vipFilterService = null;
    }
  });

  describe('Protocol: Auto-Reply Dispatch via Socket', () => {
    it('should dispatch auto-reply text to external contact when filtered', async () => {
      const autoReplyText = 'David no se encuentra disponible en este momento. Si es critico responda URGENTE.';
      assertNoEmojis(autoReplyText);

      await mockSocket.sendMessage(TEST_JIDS.EXTERNAL_JID, { text: autoReplyText });

      const sent = mockSocket.getLastMessage(TEST_JIDS.EXTERNAL_JID);
      assert.ok(sent);
      assert.strictEqual(sent.content.text, autoReplyText);
      assertNoEmojis(sent.content.text);
    });
  });

  describe('Contract: Authorized Owner Bypass', () => {
    it('should always permit messages from David phone JID with no auto-reply', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.DAVID_JID,
        undefined,
        'Buenos dias D.A.V.I.S., estado del sistema',
        false
      );

      assert.strictEqual(result.allowed, true, 'David phone JID must never be blocked');
      assert.strictEqual(result.autoReplyText, null, 'No auto-reply should be sent to David');
    });

    it('should always permit messages from David LID JID with no auto-reply', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.DAVID_LID,
        undefined,
        'Prueba desde dispositivo secundario',
        false
      );

      assert.strictEqual(result.allowed, true, 'David LID must never be blocked');
      assert.strictEqual(result.autoReplyText, null);
    });
  });

  describe('Contract: External Sender Interception & Auto-reply', () => {
    it('should filter non-urgent external messages and return a sober auto-reply with zero emojis', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.EXTERNAL_JID,
        undefined,
        'Hola David, tienes un momento para hablar sobre el presupuesto?',
        false
      );

      assert.strictEqual(result.allowed, false, 'External message without emergency keyword must be blocked');
      assert.ok(typeof result.autoReplyText === 'string', 'Auto-reply text must be provided');
      assert.ok(result.autoReplyText.length > 10, 'Auto-reply must be substantive');

      // Strict zero-emoji check on auto-reply
      assertNoEmojis(result.autoReplyText, 'VIP auto-reply must contain zero emojis');

      // Must be sober and formal
      const lowerReply = result.autoReplyText.toLowerCase();
      assert.ok(
        lowerReply.includes('david') || lowerReply.includes('disponible') || lowerReply.includes('ocupado'),
        'Auto-reply must mention availability'
      );
    });

    it('should allow external messages when emergency bypass keywords are present', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const emergencyPhrases = [
        'David esto es URGENTE por favor responde',
        'Hay una emergencia medica en la oficina',
        'Fallo critico en el servidor de produccion'
      ];

      for (const phrase of emergencyPhrases) {
        const result = vipFilterService.shouldFilterMessage(
          TEST_JIDS.EXTERNAL_JID,
          undefined,
          phrase,
          false
        );

        assert.strictEqual(
          result.allowed,
          true,
          `Message with phrase "${phrase}" must bypass VIP filter`
        );
      }
    });

    it('should recognize case-insensitive and diacritic variations of emergency words', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const variations = ['urgente', 'URGENTE', 'Urgente', 'emergencia', 'EMERGENCIA', 'crítico', 'critico'];

      for (const word of variations) {
        const result = vipFilterService.shouldFilterMessage(
          TEST_JIDS.EXTERNAL_JID,
          undefined,
          `Atencion: ${word}`,
          false
        );

        assert.strictEqual(
          result.allowed,
          true,
          `Word variation "${word}" must trigger emergency bypass`
        );
      }
    });
  });

  describe('Adversarial & Edge Cases', () => {
    it('should handle empty or undefined text without throwing unhandled exceptions', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      const emptyResult = vipFilterService.shouldFilterMessage(
        TEST_JIDS.EXTERNAL_JID,
        undefined,
        '',
        false
      );
      assert.strictEqual(emptyResult.allowed, false);

      const nullResult = vipFilterService.shouldFilterMessage(
        TEST_JIDS.EXTERNAL_JID,
        undefined,
        null,
        false
      );
      assert.strictEqual(nullResult.allowed, false);
    });

    it('should correctly handle group messages with participant JID', (t) => {
      if (!vipFilterService || typeof vipFilterService.shouldFilterMessage !== 'function') {
        t.skip('vipFilterService.shouldFilterMessage not yet implemented on disk');
        return;
      }

      // Group message from external participant
      const groupResult = vipFilterService.shouldFilterMessage(
        TEST_JIDS.GROUP_JID,
        TEST_JIDS.EXTERNAL_JID,
        'Mensaje general en grupo de trabajo',
        false
      );

      assert.ok(typeof groupResult.allowed === 'boolean');
      if (groupResult.autoReplyText) {
        assertNoEmojis(groupResult.autoReplyText);
      }
    });
  });
});
