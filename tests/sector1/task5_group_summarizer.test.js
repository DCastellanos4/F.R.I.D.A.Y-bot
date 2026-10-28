import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_JIDS, createGroupTextMessage } from '../harness/fixtures.js';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 5: Group Chat Summarizer & Mention Extractor', () => {
  let groupSummarizerService = null;

  beforeEach(async () => {
    try {
      groupSummarizerService = await import('../../groupSummarizerService.js');
    } catch {
      groupSummarizerService = null;
    }
  });

  describe('Fixtures & Context Extraction Protocol', () => {
    it('should generate valid group message structures with mentions context', () => {
      const msg = createGroupTextMessage({
        text: 'David por favor revisa el despliegue cuando puedas',
        mentions: [TEST_JIDS.DAVID_JID],
        remoteJid: TEST_JIDS.GROUP_JID,
        senderJid: TEST_JIDS.EXTERNAL_JID
      });

      assert.strictEqual(msg.key.remoteJid, TEST_JIDS.GROUP_JID);
      assert.strictEqual(msg.key.participant, TEST_JIDS.EXTERNAL_JID);
      assert.deepStrictEqual(msg.message.extendedTextMessage.contextInfo.mentionedJid, [TEST_JIDS.DAVID_JID]);
      assertNoEmojis(msg.message.extendedTextMessage.text);
    });
  });

  describe('Service Contract: groupSummarizerService.recordGroupMessage & generateGroupSummary', () => {
    it('should record messages and extract David mentions and pending tasks', async (t) => {
      if (
        !groupSummarizerService ||
        typeof groupSummarizerService.recordGroupMessage !== 'function' ||
        typeof groupSummarizerService.generateGroupSummary !== 'function'
      ) {
        t.skip('groupSummarizerService functions not yet implemented on disk');
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const groupJid = '120363099999999999@g.us';

      // Record several messages
      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'Hola a todos en el equipo, coordinemos la reunion',
        now - 3600
      );

      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'David tenemos pendiente revisar la arquitectura del Sector 1',
        now - 1800
      );

      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'TODO: enviar informe final antes de las 18:00',
        now - 900
      );

      const summary = await groupSummarizerService.generateGroupSummary(groupJid, 24);

      assert.ok(summary, 'Summary object must be returned');
      assert.ok(typeof summary.summaryText === 'string', 'summaryText must be a string');
      assert.ok(Array.isArray(summary.davidMentions), 'davidMentions must be an array');
      assert.ok(Array.isArray(summary.pendingTasks), 'pendingTasks must be an array');

      // Zero-emoji enforcement
      assertNoEmojis(summary.summaryText, 'Group summary text must contain zero emojis');
      assertNoEmojis(summary.davidMentions, 'David mentions must contain zero emojis');
      assertNoEmojis(summary.pendingTasks, 'Pending tasks must contain zero emojis');

      // Check extracted content
      assert.ok(
        summary.davidMentions.some(m => JSON.stringify(m).toLowerCase().includes('david')),
        'Must detect mention of David'
      );
      assert.ok(
        summary.pendingTasks.length > 0,
        'Must extract pending tasks / action items'
      );
    });

    it('should respect time-window parameter and ignore outdated messages', async (t) => {
      if (
        !groupSummarizerService ||
        typeof groupSummarizerService.recordGroupMessage !== 'function' ||
        typeof groupSummarizerService.generateGroupSummary !== 'function'
      ) {
        t.skip('groupSummarizerService functions not yet implemented on disk');
        return;
      }

      const groupJid = '120363088888888888@g.us';
      const now = Math.floor(Date.now() / 1000);
      const fortyEightHoursAgo = now - 48 * 3600;

      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'David este mensaje antiguo fue hace dos dias',
        fortyEightHoursAgo
      );

      // Request summary for past 12 hours only
      const summary = await groupSummarizerService.generateGroupSummary(groupJid, 12);
      assert.ok(summary);
      assert.strictEqual(
        summary.davidMentions.length,
        0,
        'Outdated message must not appear in 12h summary'
      );
    });

    it('should handle empty groups or inactive time windows gracefully', async (t) => {
      if (
        !groupSummarizerService ||
        typeof groupSummarizerService.generateGroupSummary !== 'function'
      ) {
        t.skip('groupSummarizerService.generateGroupSummary not yet implemented on disk');
        return;
      }

      const emptyGroupJid = '120363077777777777@g.us';
      const summary = await groupSummarizerService.generateGroupSummary(emptyGroupJid, 24);

      assert.ok(summary);
      assert.ok(Array.isArray(summary.davidMentions));
      assert.ok(Array.isArray(summary.pendingTasks));
      assert.strictEqual(summary.davidMentions.length, 0);
      assert.strictEqual(summary.pendingTasks.length, 0);
      assertNoEmojis(summary);
    });
  });
});
