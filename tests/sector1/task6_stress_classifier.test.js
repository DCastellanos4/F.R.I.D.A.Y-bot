import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 6: Audio Urgency & Stress Classifier', () => {
  let urgencyService = null;

  beforeEach(async () => {
    try {
      urgencyService = await import('../../urgencyService.js');
    } catch {
      urgencyService = null;
    }
  });

  describe('Contract: Return Schema & Zero-Emoji Enforcement', () => {
    it('should validate baseline schema on classification output', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      const res = urgencyService.classifyUrgency('David buenos dias, cuando puedas revisamos el correo.', 5);
      assert.ok(typeof res.isUrgent === 'boolean');
      assert.ok(['normal', 'high', 'critical'].includes(res.level));
      assert.ok(typeof res.speechRate === 'number');
      assert.ok(typeof res.reason === 'string');
      assertNoEmojis(res, 'Classification result must contain zero emojis');
    });
  });

  describe('Contract: Lexical & Acoustic Stress Classification', () => {
    it('should classify calm conversational speech as normal', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      const text = 'Hola David, te comento que manana pasare por el taller a dejar las llaves sin prisa.';
      const res = urgencyService.classifyUrgency(text, 10);

      assert.strictEqual(res.isUrgent, false);
      assert.strictEqual(res.level, 'normal');
      assert.ok(res.speechRate > 0 && res.speechRate < 3.0);
      assertNoEmojis(res.reason);
    });

    it('should classify audio with urgent keywords as high urgency', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      const text = 'David necesito que revises esto urgente, es un asunto de alta prioridad';
      const res = urgencyService.classifyUrgency(text, 6);

      assert.strictEqual(res.isUrgent, true);
      assert.ok(res.level === 'high' || res.level === 'critical');
      assert.ok(res.reason.toLowerCase().includes('urgente') || res.reason.toLowerCase().includes('palabra'));
      assertNoEmojis(res);
    });

    it('should classify high speech rate combined with emergency keywords as critical', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      // 20 words in 3 seconds = 6.66 words/sec (extremely fast speech)
      const fastText = 'Emergencia David se cayo el servidor principal de produccion y todos los clientes estan llamando ahora mismo urgente rapido ya';
      const res = urgencyService.classifyUrgency(fastText, 3);

      assert.strictEqual(res.isUrgent, true);
      assert.strictEqual(res.level, 'critical');
      assert.ok(res.speechRate > 4.0, 'Speech rate must be high');
      assertNoEmojis(res);
    });
  });

  describe('Adversarial & Boundary Conditions', () => {
    it('should handle zero duration without dividing by zero or throwing NaN', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      const res = urgencyService.classifyUrgency('Mensaje rapido', 0);
      assert.ok(typeof res.speechRate === 'number');
      assert.ok(!Number.isNaN(res.speechRate), 'speechRate must not be NaN');
      assert.ok(Number.isFinite(res.speechRate), 'speechRate must be finite');
      assertNoEmojis(res);
    });

    it('should handle empty or whitespace text safely', (t) => {
      if (!urgencyService || typeof urgencyService.classifyUrgency !== 'function') {
        t.skip('urgencyService.classifyUrgency not yet implemented on disk');
        return;
      }

      const res = urgencyService.classifyUrgency('', 5);
      assert.strictEqual(res.isUrgent, false);
      assert.strictEqual(res.level, 'normal');
      assert.strictEqual(res.speechRate, 0);
      assertNoEmojis(res);
    });
  });

  describe('Contract: Prompt Directives via getUrgencyPromptDirective', () => {
    it('should return empty directive for normal urgency', (t) => {
      if (!urgencyService || typeof urgencyService.getUrgencyPromptDirective !== 'function') {
        t.skip('urgencyService.getUrgencyPromptDirective not yet implemented on disk');
        return;
      }

      const normal = urgencyService.classifyUrgency('Hola David', 3);
      const directive = urgencyService.getUrgencyPromptDirective(normal);
      assert.strictEqual(directive, '');
    });

    it('should return concise directive without emojis for high and critical urgency', (t) => {
      if (!urgencyService || typeof urgencyService.getUrgencyPromptDirective !== 'function') {
        t.skip('urgencyService.getUrgencyPromptDirective not yet implemented on disk');
        return;
      }

      const urgent = urgencyService.classifyUrgency('Revisa esto urgente', 2);
      const dirUrgent = urgencyService.getUrgencyPromptDirective(urgent);
      assert.ok(dirUrgent.length > 0);
      assertNoEmojis(dirUrgent);

      const critical = urgencyService.classifyUrgency('Emergencia caida total del servidor ahora mismo rapido ya', 1);
      const dirCrit = urgencyService.getUrgencyPromptDirective(critical);
      assert.ok(dirCrit.includes('DIRECTIVA CRITICA'));
      assertNoEmojis(dirCrit);
    });
  });
});

