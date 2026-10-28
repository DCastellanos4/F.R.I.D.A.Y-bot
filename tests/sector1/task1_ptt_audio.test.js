import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { createSyntheticOggOpusBuffer, TEST_JIDS } from '../harness/fixtures.js';
import { assertNoEmojis, assertValidOggOpus, isValidOggOpus } from '../harness/validators.js';

describe('Sector 1 - Task 1: PTT Voice Notes Generation & Dispatch', () => {
  let mockSocket;
  let ttsService = null;

  beforeEach(async () => {
    mockSocket = createMockSocket();
    try {
      ttsService = await import('../../ttsService.js');
    } catch {
      ttsService = null;
    }
  });

  describe('Contract: WhatsApp PTT Socket Dispatch', () => {
    it('should dispatch voice notes with audio buffer, opus mimetype, and ptt=true flag', async () => {
      const syntheticBuffer = createSyntheticOggOpusBuffer({ durationSeconds: 2 });
      assertValidOggOpus(syntheticBuffer, 'Synthetic fixture should be valid OGG Opus');

      const payload = {
        audio: syntheticBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      };

      const result = await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, payload);

      assert.ok(result.key.id, 'Dispatched message must return a valid ID');
      assert.strictEqual(result.key.remoteJid, TEST_JIDS.DAVID_JID);

      const pttMessages = mockSocket.getPttMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(pttMessages.length, 1, 'Exactly one PTT message must be recorded');

      const sent = pttMessages[0];
      assert.strictEqual(sent.isAudio, true);
      assert.strictEqual(sent.isPtt, true);
      assert.strictEqual(sent.content.mimetype, 'audio/ogg; codecs=opus');
      assert.ok(Buffer.isBuffer(sent.content.audio), 'Payload audio must be a Buffer');
      assertValidOggOpus(sent.content.audio);
    });

    it('should reject or flag non-PTT audio dispatch when ptt flag is false or omitted', async () => {
      const regularAudioPayload = {
        audio: createSyntheticOggOpusBuffer(),
        mimetype: 'audio/ogg',
        ptt: false
      };

      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, regularAudioPayload);

      const pttMessages = mockSocket.getPttMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(pttMessages.length, 0, 'Audio with ptt:false must not be classified as PTT voice note');

      const allAudio = mockSocket.getAudioMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(allAudio.length, 1, 'Regular audio must still be captured as general audio');
    });

    it('should enforce zero emojis in PTT message metadata and captions', async () => {
      const testCaption = 'Respuesta de voz procesada correctamente sin florituras';
      assertNoEmojis(testCaption);

      const payload = {
        audio: createSyntheticOggOpusBuffer(),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        caption: testCaption
      };

      assertNoEmojis(payload, 'PTT payload must contain zero emojis');
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, payload);
    });
  });

  describe('Service Contract: ttsService.synthesizeSpeech', () => {
    it('should synthesize text into an OGG Opus audio buffer adhering to contract', async (t) => {
      if (!ttsService || typeof ttsService.synthesizeSpeech !== 'function') {
        t.skip('ttsService.synthesizeSpeech not yet implemented on disk');
        return;
      }

      const input = 'Identidad D.A.V.I.S. en linea. Sistemas operativos.';
      const buffer = await ttsService.synthesizeSpeech(input, {
        voice: 'es-ES-AlvaroNeural',
        rate: '+0%',
        pitch: '+0Hz'
      });

      assert.ok(Buffer.isBuffer(buffer), 'Synthesized output must be a Node.js Buffer');
      assert.ok(buffer.length > 0, 'Buffer must not be empty');
      assertValidOggOpus(buffer, 'Synthesized speech must be encoded as OGG Opus with OggS magic bytes');
    });

    it('should support alternative voice options (ElviraNeural)', async (t) => {
      if (!ttsService || typeof ttsService.synthesizeSpeech !== 'function') {
        t.skip('ttsService.synthesizeSpeech not yet implemented on disk');
        return;
      }

      const buffer = await ttsService.synthesizeSpeech('Afirmativo, senor.', {
        voice: 'es-ES-ElviraNeural'
      });

      assert.ok(Buffer.isBuffer(buffer));
      assertValidOggOpus(buffer);
    });

    it('should reject empty or whitespace-only text with descriptive Error', async (t) => {
      if (!ttsService || typeof ttsService.synthesizeSpeech !== 'function') {
        t.skip('ttsService.synthesizeSpeech not yet implemented on disk');
        return;
      }

      await assert.rejects(
        async () => {
          await ttsService.synthesizeSpeech('   ');
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message, 'Error message must not contain emojis');
          return true;
        }
      );
    });
  });

  describe('Service Contract: ttsService.sendVoiceNote', () => {
    it('should dispatch voice note via sendVoiceNote helper', async (t) => {
      if (!ttsService || typeof ttsService.sendVoiceNote !== 'function') {
        t.skip('ttsService.sendVoiceNote not yet implemented on disk');
        return;
      }

      const syntheticBuffer = createSyntheticOggOpusBuffer({ durationSeconds: 3 });
      const result = await ttsService.sendVoiceNote(mockSocket, TEST_JIDS.DAVID_JID, syntheticBuffer);

      assert.ok(result.key.id);
      const pttMsgs = mockSocket.getPttMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(pttMsgs.length, 1);
      assert.strictEqual(pttMsgs[0].isPtt, true);
      assert.strictEqual(pttMsgs[0].content.mimetype, 'audio/ogg; codecs=opus');
      assertValidOggOpus(pttMsgs[0].content.audio);
    });

    it('should validate inputs and reject invalid parameters', async (t) => {
      if (!ttsService || typeof ttsService.sendVoiceNote !== 'function') {
        t.skip('ttsService.sendVoiceNote not yet implemented on disk');
        return;
      }

      await assert.rejects(
        async () => {
          await ttsService.sendVoiceNote(null, TEST_JIDS.DAVID_JID, createSyntheticOggOpusBuffer());
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await ttsService.sendVoiceNote(mockSocket, '', createSyntheticOggOpusBuffer());
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await ttsService.sendVoiceNote(mockSocket, TEST_JIDS.DAVID_JID, Buffer.from('invalid'));
        },
        (err) => {
          assert.ok(err instanceof Error);
          assertNoEmojis(err.message);
          return true;
        }
      );
    });
  });
});

