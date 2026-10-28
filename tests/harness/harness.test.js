import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from './mockSocket.js';
import {
  createSyntheticOggOpusBuffer,
  createTextMessage,
  createVoiceMessage,
  createButtonResponseMessage,
  createListResponseMessage,
  createPollVoteMessage,
  createGroupTextMessage,
  createVCardString,
  generateMessageId,
  TEST_JIDS
} from './fixtures.js';
import {
  hasNoEmojis,
  assertNoEmojis,
  isValidOggOpus,
  assertValidOggOpus,
  isValidVCard,
  assertValidVCard,
  isValidPoll,
  assertValidPoll,
  EMOJI_REGEX
} from './validators.js';

describe('Test Infrastructure: Harness, Validators & Fixtures', () => {
  describe('Zero-Emoji Validator', () => {
    it('should pass on text with zero emojis', () => {
      const clean = 'D.A.V.I.S. Sistema Operativo. Acceso concedido.';
      const res = hasNoEmojis(clean);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.violations.length, 0);
      assertNoEmojis(clean);
    });

    it('should detect emojis and pictographs accurately', () => {
      // Extended pictographics
      const dirty = 'Alerta de sistema \u{1F525} fuego detectado';
      const res = hasNoEmojis(dirty);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations.length, 1);
      assert.throws(() => assertNoEmojis(dirty), /found emoji characters/);
    });

    it('should recursively scan nested objects and arrays for emojis', () => {
      const nestedObject = {
        title: 'Reporte',
        details: {
          status: 'Activo',
          tags: ['seguridad', 'vps', 'alerta \u{1F6A8}']
        }
      };

      const res = hasNoEmojis(nestedObject);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations.length, 1);
      assert.strictEqual(res.violations[0].path, 'root.details.tags[2]');
    });
  });

  describe('OGG Opus Header Validator', () => {
    it('should validate synthetic Ogg Opus buffer with OggS magic bytes', () => {
      const buffer = createSyntheticOggOpusBuffer();
      const check = isValidOggOpus(buffer);
      assert.strictEqual(check.valid, true);
      assert.strictEqual(check.hasOpusHead, true);
      assertValidOggOpus(buffer);
    });

    it('should reject non-buffer or truncated input', () => {
      assert.strictEqual(isValidOggOpus('string').valid, false);
      assert.strictEqual(isValidOggOpus(Buffer.from([0x01, 0x02])).valid, false);
      assert.strictEqual(isValidOggOpus(Buffer.from('RIFF1234WAVE')).valid, false);
    });
  });

  describe('vCard Validator', () => {
    it('should validate correct vCard 3.0 structure', () => {
      const vcard = createVCardString({
        displayName: 'David Morales',
        phone: '34612345678',
        organization: 'Pentesting Lab'
      });

      const check = isValidVCard(vcard);
      assert.strictEqual(check.valid, true);
      assert.strictEqual(check.fields.FN, 'David Morales');
      assert.strictEqual(check.fields.ORG, 'Pentesting Lab');
      assertValidVCard(vcard);
    });

    it('should reject malformed vCard', () => {
      const invalid = 'NOT A VCARD';
      const check = isValidVCard(invalid);
      assert.strictEqual(check.valid, false);
    });
  });

  describe('WhatsApp Poll Validator', () => {
    it('should validate valid 2-to-12 options poll', () => {
      const poll = {
        name: 'Seleccione turno',
        values: ['Manana', 'Tarde', 'Noche'],
        selectableCount: 1
      };
      assertValidPoll(poll);
    });

    it('should reject poll with less than 2 options or > 12 options', () => {
      assert.strictEqual(isValidPoll({ name: 'Test', values: ['Solo'] }).valid, false);
      assert.strictEqual(
        isValidPoll({
          name: 'Test',
          values: Array.from({ length: 13 }, (_, i) => `Opt ${i}`)
        }).valid,
        false
      );
    });
  });

  describe('Mock Baileys Socket', () => {
    it('should capture sent messages, categorize them, and support event emission', async () => {
      const sock = createMockSocket();

      // Listen for mock events
      let eventFired = false;
      sock.ev.on('connection.update', (data) => {
        if (data.connection === 'open') eventFired = true;
      });
      sock.ev.emit('connection.update', { connection: 'open' });
      assert.strictEqual(eventFired, true);

      // Send text
      await sock.sendMessage(TEST_JIDS.DAVID_JID, { text: 'Mensaje de prueba' });

      // Send audio
      await sock.sendMessage(TEST_JIDS.DAVID_JID, {
        audio: createSyntheticOggOpusBuffer(),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      });

      // Send presence & read receipt
      await sock.sendPresenceUpdate('recording', TEST_JIDS.DAVID_JID);
      await sock.readMessages([{ id: 'MOCK_KEY_1' }]);

      assert.strictEqual(sock.getSentMessages().length, 2);
      assert.strictEqual(sock.getPttMessages().length, 1);
      assert.strictEqual(sock.presenceUpdates.length, 1);
      assert.strictEqual(sock.readReceipts.length, 1);

      sock.clear();
      assert.strictEqual(sock.getSentMessages().length, 0);
    });
  });
});
