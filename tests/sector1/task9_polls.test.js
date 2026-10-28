import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { TEST_JIDS, createPollVoteMessage } from '../harness/fixtures.js';
import { assertNoEmojis, assertValidPoll, isValidPoll } from '../harness/validators.js';

describe('Sector 1 - Task 9: Native WhatsApp Polls & Vote Tracking', () => {
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

  describe('Protocol: Native Poll Schema & WhatsApp Limits', () => {
    it('should validate and dispatch a valid 3-option single-choice poll', async () => {
      const pollData = {
        name: 'Prioridad de la siguiente tarea del sprint',
        values: ['Frontend Web', 'Backend API', 'Infraestructura VPS'],
        selectableCount: 1
      };

      assertValidPoll(pollData);
      assertNoEmojis(pollData);

      const payload = { poll: pollData };
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, payload);

      const pollMsgs = mockSocket.getPollMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(pollMsgs.length, 1);

      const sent = pollMsgs[0];
      assert.strictEqual(sent.content.poll.name, pollData.name);
      assert.strictEqual(sent.content.poll.values.length, 3);
      assert.strictEqual(sent.content.poll.selectableCount, 1);
    });

    it('should reject poll with fewer than 2 options', () => {
      const invalidPoll = {
        name: 'Pregunta invalida',
        values: ['Unica opcion']
      };

      const check = isValidPoll(invalidPoll);
      assert.strictEqual(check.valid, false);
      assert.ok(check.errors.some(e => e.includes('at least 2 options')));
    });

    it('should reject poll exceeding WhatsApp 12 options limit', () => {
      const invalidPoll = {
        name: 'Pregunta con demasiadas opciones',
        values: Array.from({ length: 13 }, (_, i) => `Opcion ${i + 1}`)
      };

      const check = isValidPoll(invalidPoll);
      assert.strictEqual(check.valid, false);
      assert.ok(check.errors.some(e => e.includes('cannot exceed 12 options')));
    });

    it('should support multiple choice poll with selectableCount > 1', async () => {
      const multiPoll = {
        name: 'Que tecnologias domina el equipo?',
        values: ['Node.js', 'Python', 'Rust', 'Go'],
        selectableCount: 3
      };

      assertValidPoll(multiPoll);
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, { poll: multiPoll });

      const sent = mockSocket.getLastMessage(TEST_JIDS.DAVID_JID);
      assert.strictEqual(sent.content.poll.selectableCount, 3);
    });
  });

  describe('Service Contract: interactiveService.sendPoll', () => {
    it('should dispatch poll through sendPoll function', async (t) => {
      if (!interactiveService || typeof interactiveService.sendPoll !== 'function') {
        t.skip('interactiveService.sendPoll not yet implemented on disk');
        return;
      }

      const pollOptions = {
        name: 'Hora de la reunion tecnica',
        values: ['10:00 AM', '12:00 PM', '16:00 PM'],
        selectableCount: 1
      };
      assertNoEmojis(pollOptions);

      const res = await interactiveService.sendPoll(mockSocket, TEST_JIDS.DAVID_JID, pollOptions);
      assert.ok(res);

      const pollMsgs = mockSocket.getPollMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(pollMsgs.length, 1);
      assertValidPoll(pollMsgs[0].content.poll);
    });

    it('should throw validation Error when poll options are invalid', async (t) => {
      if (!interactiveService || typeof interactiveService.sendPoll !== 'function') {
        t.skip('interactiveService.sendPoll not yet implemented on disk');
        return;
      }

      await assert.rejects(
        async () => {
          await interactiveService.sendPoll(mockSocket, TEST_JIDS.DAVID_JID, {
            name: 'Pregunta vacia',
            values: ['Opcion sola']
          });
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message);
          return true;
        }
      );
    });
  });

  describe('Protocol: Incoming Poll Vote Message Ingestion', () => {
    it('should create and validate incoming poll vote fixture', () => {
      const pollKey = { remoteJid: TEST_JIDS.DAVID_JID, id: 'MOCK_POLL_123' };
      const voteMsg = createPollVoteMessage({
        pollCreationMessageKey: pollKey,
        selectedOptions: ['Node.js']
      });

      assert.strictEqual(voteMsg.key.remoteJid, TEST_JIDS.DAVID_JID);
      assert.ok(voteMsg.message.pollUpdateMessage);
      assert.deepStrictEqual(
        voteMsg.message.pollUpdateMessage.pollCreationMessageKey,
        pollKey
      );
      assertNoEmojis(voteMsg);
    });
  });
});
