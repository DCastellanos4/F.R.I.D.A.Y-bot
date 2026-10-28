import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoEmojis } from '../harness/validators.js';

describe('Sector 1 - Task 7: Personal Notes Transcription & Markdown Capture', () => {
  let notesService = null;
  const createdFiles = [];

  beforeEach(async () => {
    try {
      notesService = await import('../../notesService.js');
    } catch {
      notesService = null;
    }
  });

  afterEach(async () => {
    // Clean up any test files generated during tests
    for (const filePath of createdFiles) {
      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore if already deleted
      }
    }
    createdFiles.length = 0;
  });

  describe('Contract: Note Trigger Detection via isPersonalNote', () => {
    it('should classify any self-chat message as a personal note', (t) => {
      if (!notesService || typeof notesService.isPersonalNote !== 'function') {
        t.skip('notesService.isPersonalNote not yet implemented on disk');
        return;
      }

      assert.strictEqual(
        notesService.isPersonalNote('Comprar cable HDMI para el monitor del laboratorio', true),
        true,
        'Self-chat messages should automatically be identified as personal notes'
      );
    });

    it('should detect explicit note prefix triggers in general chats', (t) => {
      if (!notesService || typeof notesService.isPersonalNote !== 'function') {
        t.skip('notesService.isPersonalNote not yet implemented on disk');
        return;
      }

      const explicitNotes = [
        'nota: revisar los puertos del firewall manana',
        'Nota: cambiar contrasena de la base de datos',
        'idea: crear un modulo de clasificacion de audio para whatsapp',
        'recordar: enviar informe el viernes',
        'apunte: libro recomendado sobre microservicios'
      ];

      for (const phrase of explicitNotes) {
        assert.strictEqual(
          notesService.isPersonalNote(phrase, false),
          true,
          `Phrase "${phrase}" should be recognized as a personal note trigger`
        );
      }
    });

    it('should not flag standard conversational queries as notes', (t) => {
      if (!notesService || typeof notesService.isPersonalNote !== 'function') {
        t.skip('notesService.isPersonalNote not yet implemented on disk');
        return;
      }

      assert.strictEqual(notesService.isPersonalNote('Que hora es en Madrid?', false), false);
      assert.strictEqual(notesService.isPersonalNote('Como esta el clima hoy?', false), false);
    });
  });

  describe('Contract: Markdown Persistence via savePersonalNote', () => {
    it('should write note into data/notes/ directory in clean Markdown format with zero emojis', async (t) => {
      if (!notesService || typeof notesService.savePersonalNote !== 'function') {
        t.skip('notesService.savePersonalNote not yet implemented on disk');
        return;
      }

      const noteText = 'Reflexion sobre la escalabilidad de microservicios en el nodo perimetral.';
      const metadata = {
        category: 'arquitectura',
        source: 'audio',
        author: 'David'
      };

      const result = await notesService.savePersonalNote(noteText, metadata);

      assert.ok(result, 'Must return result object');
      assert.strictEqual(result.ok, true, 'Result ok flag must be true');
      assert.ok(typeof result.filePath === 'string', 'Must return created filePath');

      createdFiles.push(result.filePath);

      // Verify file exists on filesystem
      const stat = await fs.stat(result.filePath);
      assert.ok(stat.isFile(), 'Saved note must be a real file');

      // Verify path layout: data/notes/YYYY-MM-DD/...
      const normalizedPath = result.filePath.replace(/\\/g, '/');
      assert.ok(
        normalizedPath.includes('data/notes/'),
        `Path must reside under data/notes/: ${normalizedPath}`
      );
      assert.ok(normalizedPath.endsWith('.md'), 'Saved file must have .md extension');

      // Read content and verify schema
      const content = await fs.readFile(result.filePath, 'utf8');
      assert.ok(content.includes(noteText), 'Markdown must contain note content');
      assert.ok(content.includes('arquitectura') || content.includes('Nota'), 'Markdown must contain metadata');

      // Strict Zero-Emoji Rule
      assertNoEmojis(content, 'Personal note Markdown must not contain emojis');
      assertNoEmojis(result.filePath, 'File path must not contain emojis');
    });

    it('should sanitize filename categories and handle missing metadata', async (t) => {
      if (!notesService || typeof notesService.savePersonalNote !== 'function') {
        t.skip('notesService.savePersonalNote not yet implemented on disk');
        return;
      }

      const res = await notesService.savePersonalNote('Nota rapida sin categoria', {});
      assert.strictEqual(res.ok, true);
      assert.ok(res.filePath);
      createdFiles.push(res.filePath);

      assertNoEmojis(res);
    });

    it('should reject empty or invalid note text with descriptive error', async (t) => {
      if (!notesService || typeof notesService.savePersonalNote !== 'function') {
        t.skip('notesService.savePersonalNote not yet implemented on disk');
        return;
      }

      await assert.rejects(
        async () => {
          await notesService.savePersonalNote('', {});
        },
        /Note text must be a non-empty string/
      );
    });

    it('should extract hashtags and key points into markdown structure', async (t) => {
      if (!notesService || typeof notesService.savePersonalNote !== 'function') {
        t.skip('notesService.savePersonalNote not yet implemented on disk');
        return;
      }

      const noteText = 'recordar: Configurar cluster de kubernetes en produccion. Revisar memoria swap. #devops #k8s';
      const metadata = { category: 'proyectos', source: 'text', author: 'David' };

      const res = await notesService.savePersonalNote(noteText, metadata);
      assert.strictEqual(res.ok, true);
      createdFiles.push(res.filePath);

      const content = await fs.readFile(res.filePath, 'utf8');
      assert.ok(content.includes('devops'), 'Should include devops tag');
      assert.ok(content.includes('k8s'), 'Should include k8s tag');
      assert.ok(content.includes('Configurar cluster'), 'Should include extracted key points');
      assertNoEmojis(content);
    });
  });

  describe('Contract: Query and Retrieval via listRecentNotes & getNoteByPath', () => {
    it('should list saved notes ordered by recency and respect limit', async (t) => {
      if (!notesService || typeof notesService.listRecentNotes !== 'function') {
        t.skip('notesService.listRecentNotes not yet implemented on disk');
        return;
      }

      const res1 = await notesService.savePersonalNote('Primera nota de prueba para listado', { category: 'general' });
      createdFiles.push(res1.filePath);

      const res2 = await notesService.savePersonalNote('Segunda nota de prueba para listado', { category: 'ideas' });
      createdFiles.push(res2.filePath);

      const recentNotes = await notesService.listRecentNotes(5);
      assert.ok(Array.isArray(recentNotes), 'Result must be an array');
      assert.ok(recentNotes.length >= 2, 'Should return at least 2 notes');

      const filePaths = recentNotes.map(n => n.filePath);
      assert.ok(filePaths.includes(res1.filePath), 'Must include first note');
      assert.ok(filePaths.includes(res2.filePath), 'Must include second note');

      assertNoEmojis(recentNotes);
    });

    it('should filter recent notes by category and read via getNoteByPath', async (t) => {
      if (!notesService || typeof notesService.listRecentNotes !== 'function') {
        t.skip('notesService.listRecentNotes not yet implemented on disk');
        return;
      }

      const res = await notesService.savePersonalNote('Nota clasificada en tareas para filtro', { category: 'tareas' });
      createdFiles.push(res.filePath);

      const filtered = await notesService.listRecentNotes(10, { category: 'tareas' });
      assert.ok(filtered.length >= 1, 'Should find at least 1 note with category tareas');
      for (const item of filtered) {
        assert.strictEqual(item.category, 'tareas');
      }

      const noteDetail = await notesService.getNoteByPath(res.filePath);
      assert.ok(noteDetail, 'Should retrieve note details by path');
      assert.strictEqual(noteDetail.category, 'tareas');
      assert.ok(noteDetail.content.includes('Nota clasificada en tareas'));
      assertNoEmojis(noteDetail);
    });
  });
});
