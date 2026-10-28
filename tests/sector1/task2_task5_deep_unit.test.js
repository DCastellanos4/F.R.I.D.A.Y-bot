import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoEmojis } from '../harness/validators.js';
import { TEST_JIDS, createGroupTextMessage } from '../harness/fixtures.js';

describe('Sector 1 - Deep Unit Verification: Task 2 & Task 5', () => {
  let vipFilterService;
  let groupSummarizerService;

  beforeEach(async () => {
    vipFilterService = await import('../../vipFilterService.js');
    groupSummarizerService = await import('../../groupSummarizerService.js');
    vipFilterService.resetVipFilter();
    groupSummarizerService.clearAllGroupBuffers();
  });

  describe('vipFilterService - State and VIP Whitelist Management', () => {
    it('should permit all inbound messages when VIP mode is deactivated', () => {
      vipFilterService.setVipMode(false);
      assert.strictEqual(vipFilterService.isVipModeActive(), false);

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.EXTERNAL_JID,
        undefined,
        'Mensaje no urgente con filtro apagado',
        false
      );

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.autoReplyText, null);
    });

    it('should toggle VIP mode on and off correctly', () => {
      vipFilterService.setVipMode(true);
      const state1 = vipFilterService.toggleVipMode();
      assert.strictEqual(state1, false);
      const state2 = vipFilterService.toggleVipMode();
      assert.strictEqual(state2, true);
    });

    it('should allow whitelisted VIP contacts through without emergency words', () => {
      vipFilterService.addVipContact(TEST_JIDS.VIP_EXTERNAL_JID);
      assert.strictEqual(vipFilterService.isVipContact(TEST_JIDS.VIP_EXTERNAL_JID), true);

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.VIP_EXTERNAL_JID,
        undefined,
        'Hola David, revision rutinaria de presupuesto',
        false
      );

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.autoReplyText, null);
    });

    it('should correctly remove VIP contacts and filter them again', () => {
      vipFilterService.addVipContact(TEST_JIDS.VIP_EXTERNAL_JID);
      const removed = vipFilterService.removeVipContact(TEST_JIDS.VIP_EXTERNAL_JID);
      assert.strictEqual(removed, true);
      assert.strictEqual(vipFilterService.isVipContact(TEST_JIDS.VIP_EXTERNAL_JID), false);

      const result = vipFilterService.shouldFilterMessage(
        TEST_JIDS.VIP_EXTERNAL_JID,
        undefined,
        'Consulta posterior a retirada de whitelist',
        false
      );

      assert.strictEqual(result.allowed, false);
      assert.ok(typeof result.autoReplyText === 'string');
      assertNoEmojis(result.autoReplyText);
    });

    it('should identify extended emergency keywords: socorro, auxilio, peligro, hospital, s.o.s.', () => {
      const emergencyWords = ['socorro', 'auxilio', 'peligro', 'hospital', 'ambulancia', 'incendio', 's.o.s.'];

      for (const word of emergencyWords) {
        const text = `Por favor necesitamos ayuda: ${word} urgente`;
        assert.strictEqual(
          vipFilterService.isEmergencyMessage(text),
          true,
          `Expected emergency keyword "${word}" to be recognized`
        );

        const filterResult = vipFilterService.shouldFilterMessage(
          TEST_JIDS.EXTERNAL_JID,
          undefined,
          text,
          false
        );
        assert.strictEqual(filterResult.allowed, true);
      }
    });

    it('should verify David identification by phone, LID, and prefixes', () => {
      assert.strictEqual(vipFilterService.isDavid(TEST_JIDS.DAVID_JID), true);
      assert.strictEqual(vipFilterService.isDavid(TEST_JIDS.DAVID_LID), true);
      assert.strictEqual(vipFilterService.isDavid('34635605605@s.whatsapp.net'), true);
      assert.strictEqual(vipFilterService.isDavid('149868706304033@lid'), true);
      assert.strictEqual(vipFilterService.isDavid(TEST_JIDS.EXTERNAL_JID), false);
      assert.strictEqual(vipFilterService.isDavid(null), false);
      assert.strictEqual(vipFilterService.isDavid(''), false);
    });
  });

  describe('groupSummarizerService - Ingest, Buffer and Smart Summarization', () => {
    it('should ingest native Baileys message objects and extract metadata', async () => {
      const msg = createGroupTextMessage({
        text: 'David hay que preparar el despliegue del servidor para manana',
        mentions: [TEST_JIDS.DAVID_JID],
        remoteJid: TEST_JIDS.GROUP_JID,
        senderJid: TEST_JIDS.EXTERNAL_JID
      });

      const res = await groupSummarizerService.recordGroupMessage(msg);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.groupJid, TEST_JIDS.GROUP_JID);

      const summary = await groupSummarizerService.generateGroupSummary(TEST_JIDS.GROUP_JID, 24);
      assert.strictEqual(summary.messageCount, 1);
      assert.strictEqual(summary.davidMentions.length, 1);
      assert.strictEqual(summary.pendingTasks.length, 1);
      assertNoEmojis(summary.summaryText);
    });

    it('should detect mentions through contextInfo.mentionedJid array', () => {
      const mentioned = groupSummarizerService.isDavidMentioned('Mensaje sin nombre explicito', [TEST_JIDS.DAVID_JID]);
      assert.strictEqual(mentioned, true);

      const notMentioned = groupSummarizerService.isDavidMentioned('Mensaje sin mencion', [TEST_JIDS.EXTERNAL_JID]);
      assert.strictEqual(notMentioned, false);
    });

    it('should extract diverse task syntactic structures', () => {
      const t1 = groupSummarizerService.extractPendingTasks('TODO: configurar cluster de base de datos', 'user1');
      assert.strictEqual(t1.length, 1);
      assert.strictEqual(t1[0].task, 'configurar cluster de base de datos');

      const t2 = groupSummarizerService.extractPendingTasks('- [ ] documentar endpoints de la API', 'user2');
      assert.strictEqual(t2.length, 1);
      assert.strictEqual(t2[0].task, 'documentar endpoints de la API');

      const t3 = groupSummarizerService.extractPendingTasks('Tenemos pendiente revisar los certificados SSL', 'user3');
      assert.strictEqual(t3.length, 1);
      assert.ok(t3[0].task.toLowerCase().includes('revisar'));

      const t4 = groupSummarizerService.extractPendingTasks('Por favor actualiza el fichero de configuracion', 'user4');
      assert.strictEqual(t4.length, 1);
      assert.ok(t4[0].task.toLowerCase().includes('actualiza'));

      const t5 = groupSummarizerService.extractPendingTasks('Deadline: entrega de la fase 1 el viernes', 'user5');
      assert.strictEqual(t5.length, 1);
      assert.ok(t5[0].task.toLowerCase().includes('entrega'));
    });

    it('should manage group message buffer clearing and retrieval', async () => {
      const groupJid = '120363011111111111@g.us';
      const now = Math.floor(Date.now() / 1000);

      await groupSummarizerService.recordGroupMessage(groupJid, TEST_JIDS.EXTERNAL_JID, 'Primer mensaje', now);
      await groupSummarizerService.recordGroupMessage(groupJid, TEST_JIDS.EXTERNAL_JID, 'Segundo mensaje', now + 10);

      const messages = groupSummarizerService.getGroupMessages(groupJid, 1);
      assert.strictEqual(messages.length, 2);

      const bufferedGroups = groupSummarizerService.getBufferedGroups();
      assert.ok(bufferedGroups.includes(groupJid));

      groupSummarizerService.clearGroupBuffer(groupJid);
      const remainingMessages = groupSummarizerService.getGroupMessages(groupJid, 1);
      assert.strictEqual(remainingMessages.length, 0);
    });

    it('should enforce zero emojis across all generated summary properties', async () => {
      const groupJid = '120363022222222222@g.us';
      const now = Math.floor(Date.now() / 1000);

      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'David tenemos que coordinar la reunion tecnica y resolver incidencias',
        now
      );
      await groupSummarizerService.recordGroupMessage(
        groupJid,
        TEST_JIDS.EXTERNAL_JID,
        'TAREA: preparar informe de rendimiento',
        now + 10
      );

      const summary = await groupSummarizerService.generateGroupSummary(groupJid, 24);
      assertNoEmojis(summary);
      assert.ok(summary.summaryText.length > 50);
      assert.ok(summary.summaryText.includes('RESUMEN'));
      assert.ok(summary.summaryText.includes('MENCIONES'));
      assert.ok(summary.summaryText.includes('TAREAS'));
    });
  });
});
