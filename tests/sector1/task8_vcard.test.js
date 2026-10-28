import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSocket } from '../harness/mockSocket.js';
import { TEST_JIDS, createVCardString } from '../harness/fixtures.js';
import { assertNoEmojis, assertValidVCard, isValidVCard } from '../harness/validators.js';

describe('Sector 1 - Task 8: Digital vCard (.vcf) Generation & Sharing', () => {
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

  describe('Protocol: vCard Schema & WhatsApp Contact Payload', () => {
    it('should generate RFC-compliant vCard 3.0 string and pass schema validation', () => {
      const vcard = createVCardString({
        displayName: 'Carlos Rodriguez',
        phone: '+34611223344',
        organization: 'Ciberseguridad Avanzada S.L.'
      });

      assertValidVCard(vcard, {
        displayName: 'Carlos Rodriguez',
        phone: '+34611223344',
        organization: 'Ciberseguridad Avanzada S.L.'
      });

      assertNoEmojis(vcard, 'vCard must not contain emojis');
    });

    it('should dispatch valid contacts payload through Baileys socket', async () => {
      const vcard = createVCardString({
        displayName: 'Elena Martin',
        phone: '34655443322',
        organization: 'Sistemas Operativos'
      });

      const payload = {
        contacts: {
          displayName: 'Elena Martin',
          contacts: [{ vcard }]
        }
      };

      assertNoEmojis(payload);
      await mockSocket.sendMessage(TEST_JIDS.DAVID_JID, payload);

      const vcardMsgs = mockSocket.getVCardMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(vcardMsgs.length, 1);

      const sent = vcardMsgs[0];
      assert.strictEqual(sent.content.contacts.displayName, 'Elena Martin');
      const innerVCard = sent.content.contacts.contacts[0].vcard;
      assertValidVCard(innerVCard);
    });

    it('should reject malformed vCard missing mandatory fields', () => {
      const brokenVCard = 'BEGIN:VCARD\nFN:Solo Nombre\nEND:VCARD';
      const check = isValidVCard(brokenVCard);
      assert.strictEqual(check.valid, false, 'vCard missing VERSION and TEL must fail validation');
      assert.ok(check.errors.length > 0);
    });
  });

  describe('Service Contract: interactiveService.sendVCard', () => {
    it('should construct and dispatch vCard via sendVCard function', async (t) => {
      if (!interactiveService || typeof interactiveService.sendVCard !== 'function') {
        t.skip('interactiveService.sendVCard not yet implemented on disk');
        return;
      }

      const contactData = {
        displayName: 'Doctor Miguel Sanchez',
        phone: '+34600998877',
        organization: 'Hospital General'
      };
      assertNoEmojis(contactData);

      const res = await interactiveService.sendVCard(
        mockSocket,
        TEST_JIDS.DAVID_JID,
        contactData
      );

      assert.ok(res);
      const vcardMsgs = mockSocket.getVCardMessages(TEST_JIDS.DAVID_JID);
      assert.strictEqual(vcardMsgs.length, 1);

      const sentVCard = vcardMsgs[0].content.contacts.contacts[0].vcard;
      assertValidVCard(sentVCard, contactData);
    });

    it('should handle contact without optional organization field', async (t) => {
      if (!interactiveService || typeof interactiveService.sendVCard !== 'function') {
        t.skip('interactiveService.sendVCard not yet implemented on disk');
        return;
      }

      await interactiveService.sendVCard(mockSocket, TEST_JIDS.DAVID_JID, {
        displayName: 'Laura Gomez',
        phone: '+34612345678'
      });

      const last = mockSocket.getLastMessage(TEST_JIDS.DAVID_JID);
      assert.ok(last);
      assertNoEmojis(last.content);
    });
  });
});
