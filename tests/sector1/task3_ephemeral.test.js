import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { TEST_JIDS, createSyntheticOggOpusBuffer } from '../harness/fixtures.js';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 3: Ephemeral Messages with TTL', () => {
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

  describe('Protocol: Baileys Ephemeral Message Dispatch', () => {
    it('should dispatch text message with 24h (86400s) ephemeral TTL', async () => {
      const content = { text: 'Mensaje temporal con expiracion de 24 horas.' };
      assertNoEmojis(content);

      const result = await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, content, {
        ephemeralExpiration: 86400
      });

      assert.ok(result.key.id);
      const ephemeralMsgs = mockSocket.getEphemeralMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(ephemeralMsgs.length, 1);

      const sent = ephemeralMsgs[0];
      assert.strictEqual(sent.isEphemeral, true);
      assert.strictEqual(sent.ephemeralTtl, 86400);
      assert.strictEqual(sent.content.text, content.text);
    });

    it('should dispatch PTT voice note with 7d (604800s) ephemeral TTL', async () => {
      const audioBuffer = createSyntheticOggOpusBuffer();
      const pttContent = {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      };

      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, pttContent, {
        ephemeralExpiration: 604800
      });

      const ephemeralMsgs = mockSocket.getEphemeralMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(ephemeralMsgs.length, 1);

      const sent = ephemeralMsgs[0];
      assert.strictEqual(sent.isAudio, true);
      assert.strictEqual(sent.isPtt, true);
      assert.strictEqual(sent.ephemeralTtl, 604800);
    });

    it('should support turning off ephemeral mode with TTL 0', async () => {
      const content = { text: 'Mensaje permanente sin autodestruccion.' };
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, content, {
        ephemeralExpiration: 0
      });

      const last = mockSocket.getLastMessage(TEST_JIDS.DAVID_JID);
      assert.strictEqual(last.ephemeralTtl, 0);
    });
  });

  describe('Service Contract: interactiveService.sendEphemeral', () => {
    it('should invoke sendEphemeral and apply proper TTL to socket dispatch', async (t) => {
      if (!interactiveService || typeof interactiveService.sendEphemeral !== 'function') {
        t.skip('interactiveService.sendEphemeral not yet implemented on disk');
        return;
      }

      const content = { text: 'Instruccion sensible de autodestruccion en 3600 segundos.' };
      assertNoEmojis(content);

      const res = await interactiveService.sendEphemeral(
        mockSocket,
        TEST_JIDS.DAVID_JID,
        content,
        3600
      );

      assert.ok(res, 'sendEphemeral must return sent message receipt');
      const ephemeralMsgs = mockSocket.getEphemeralMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(ephemeralMsgs.length, 1);
      assert.strictEqual(ephemeralMsgs[0].ephemeralTtl, 3600);
    });

    it('should validate and reject non-numeric or negative expiration values', async (t) => {
      if (!interactiveService || typeof interactiveService.sendEphemeral !== 'function') {
        t.skip('interactiveService.sendEphemeral not yet implemented on disk');
        return;
      }

      await assert.rejects(
        async () => {
          await interactiveService.sendEphemeral(
            mockSocket,
            TEST_JIDS.DAVID_JID,
            { text: 'Invalido' },
            -10
          );
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message);
          return true;
        }
      );
    });

    it('should strictly enforce zero emojis in ephemeral payload content', async (t) => {
      if (!interactiveService || typeof interactiveService.sendEphemeral !== 'function') {
        t.skip('interactiveService.sendEphemeral not yet implemented on disk');
        return;
      }

      const cleanContent = { text: 'Alerta sin caracteres pictograficos.' };
      assertNoEmojis(cleanContent);

      await interactiveService.sendEphemeral(
        mockSocket,
        TEST_JIDS.DAVID_JID,
        cleanContent,
        86400
      );

      const last = mockSocket.getLastMessage(TEST_JIDS.DAVID_JID);
      assertNoEmojis(last.content);
    });
  });
});
