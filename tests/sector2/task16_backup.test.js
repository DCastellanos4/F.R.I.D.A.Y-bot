import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import {
  createEncryptedBackup,
  restoreEncryptedBackup,
  verifyBackupContainer,
  listBackups,
  pruneOldBackups,
  scheduleAutomatedBackup,
  stopScheduledBackup,
  generateBackupFilename,
  deriveKey,
  isPathTraversal,
  DAVBAK_MAGIC,
  HEADER_SIZE,
  SALT_SIZE,
  IV_SIZE,
  TAG_SIZE
} from '../../backupService.js';

import {
  TEST_BACKUP_PASSPHRASE,
  SAMPLE_SOURCE_FILES,
  createSyntheticBackupContainer,
  createTamperedCiphertextContainer,
  createTamperedTagContainer,
  createInvalidMagicContainer,
  createTruncatedContainer,
  createPathTraversalContainer
} from './fixtures/backupFixtures.js';

import {
  assertNoEmojis,
  assertValidDavbak,
  isValidDavbakContainer
} from './helpers/s2Validators.js';

describe('Sector 2 - Task 16: Encrypted Automated Backups and Restore (backupService.js)', () => {
  let tempDir;
  let testBackupDir;
  let testRestoreDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-backup-test-'));
    testBackupDir = path.join(tempDir, 'data', 'backups');
    testRestoreDir = path.join(tempDir, 'restore');
    fs.mkdirSync(testBackupDir, { recursive: true });
    fs.mkdirSync(testRestoreDir, { recursive: true });
  });

  afterEach(() => {
    stopScheduledBackup();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary directory cleanup error
    }
  });

  describe('Part 1: DAVBAK01 Container Envelope & Cryptographic Integrity', () => {
    it('should export DAVBAK_MAGIC as 8-byte Buffer matching DAVBAK01', () => {
      assert.ok(Buffer.isBuffer(DAVBAK_MAGIC));
      assert.strictEqual(DAVBAK_MAGIC.length, 8);
      assert.strictEqual(DAVBAK_MAGIC.toString('ascii'), 'DAVBAK01');
      assertNoEmojis(DAVBAK_MAGIC.toString('ascii'));
    });

    it('should export standard header and cryptographic constants', () => {
      assert.strictEqual(HEADER_SIZE, 52);
      assert.strictEqual(SALT_SIZE, 16);
      assert.strictEqual(IV_SIZE, 12);
      assert.strictEqual(TAG_SIZE, 16);
    });

    it('should generate valid DAVBAK01 container with 52-byte header and non-empty ciphertext', async () => {
      const result = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        sourceFiles: SAMPLE_SOURCE_FILES
      });

      assert.ok(result.backupPath);
      assert.ok(fs.existsSync(result.backupPath));
      assert.strictEqual(result.fileCount, 3);
      assert.ok(result.sizeBytes > HEADER_SIZE);
      assert.strictEqual(typeof result.sha256, 'string');
      assert.strictEqual(result.sha256.length, 64);
      assertNoEmojis(result);

      const containerBuffer = fs.readFileSync(result.backupPath);
      assertValidDavbak(containerBuffer, 'Container must comply with DAVBAK01 specification');

      const computedSha256 = crypto.createHash('sha256').update(containerBuffer).digest('hex');
      assert.strictEqual(result.sha256, computedSha256);
    });

    it('should use distinct random salts and IVs on consecutive runs (no nonce reuse)', async () => {
      const run1 = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        destinationPath: path.join(testBackupDir, 'run1.davbak'),
        sourceFiles: { 'file.txt': 'Identical content' }
      });
      const run2 = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        destinationPath: path.join(testBackupDir, 'run2.davbak'),
        sourceFiles: { 'file.txt': 'Identical content' }
      });

      const buf1 = fs.readFileSync(run1.backupPath);
      const buf2 = fs.readFileSync(run2.backupPath);

      const salt1 = buf1.subarray(8, 24);
      const salt2 = buf2.subarray(8, 24);
      const iv1 = buf1.subarray(24, 36);
      const iv2 = buf2.subarray(24, 36);

      assert.notDeepStrictEqual(salt1, salt2, 'Salts must be randomly generated');
      assert.notDeepStrictEqual(iv1, iv2, 'IV nonces must be uniquely generated');
      assert.notStrictEqual(run1.sha256, run2.sha256, 'Ciphertexts must differ due to distinct salts and IVs');
    });

    it('should derive consistent 32-byte key from passphrase and salt via scrypt', () => {
      const salt = crypto.randomBytes(16);
      const key1 = deriveKey('my_secret_pass', salt);
      const key2 = deriveKey('my_secret_pass', salt);

      assert.strictEqual(key1.length, 32);
      assert.deepStrictEqual(key1, key2);

      const keyDiffPass = deriveKey('different_pass', salt);
      assert.notDeepStrictEqual(key1, keyDiffPass);
    });

    it('should throw an error if deriveKey is called with empty passphrase', () => {
      const salt = crypto.randomBytes(16);
      assert.throws(
        () => deriveKey('', salt),
        /passphrase is required/i
      );
    });
  });

  describe('Part 2: End-to-End Encryption & Decryption Roundtrip', () => {
    it('should successfully back up and restore sample files byte-for-byte', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        sourceFiles: SAMPLE_SOURCE_FILES
      });

      const restoreResult = await restoreEncryptedBackup(
        backupResult.backupPath,
        TEST_BACKUP_PASSPHRASE,
        testRestoreDir
      );

      assert.strictEqual(restoreResult.success, true);
      assert.strictEqual(restoreResult.restoredFiles.length, 3);
      assertNoEmojis(restoreResult);

      for (const [relPath, originalContent] of Object.entries(SAMPLE_SOURCE_FILES)) {
        const restoredFilePath = path.join(testRestoreDir, relPath);
        assert.ok(fs.existsSync(restoredFilePath), `Expected restored file: ${relPath}`);
        const restoredContent = fs.readFileSync(restoredFilePath, 'utf8');
        assert.strictEqual(restoredContent, originalContent, `Content mismatch for file: ${relPath}`);
      }
    });

    it('should restore from an in-memory Buffer directly without requiring disk path', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        sourceFiles: { 'notes/quick.txt': 'Quick reminder' }
      });

      const containerBuffer = fs.readFileSync(backupResult.backupPath);
      const restoreResult = await restoreEncryptedBackup(
        containerBuffer,
        TEST_BACKUP_PASSPHRASE,
        testRestoreDir
      );

      assert.strictEqual(restoreResult.success, true);
      assert.deepStrictEqual(restoreResult.restoredFiles, ['notes/quick.txt']);
      const content = fs.readFileSync(path.join(testRestoreDir, 'notes', 'quick.txt'), 'utf8');
      assert.strictEqual(content, 'Quick reminder');
    });

    it('should restore synthetic containers generated by backupFixtures.js', async () => {
      const syntheticContainer = createSyntheticBackupContainer({
        passphrase: TEST_BACKUP_PASSPHRASE,
        files: SAMPLE_SOURCE_FILES
      });

      const restoreResult = await restoreEncryptedBackup(
        syntheticContainer,
        TEST_BACKUP_PASSPHRASE,
        testRestoreDir
      );

      assert.strictEqual(restoreResult.success, true);
      assert.strictEqual(restoreResult.restoredFiles.length, 3);
      for (const [relPath, originalContent] of Object.entries(SAMPLE_SOURCE_FILES)) {
        const restoredFilePath = path.join(testRestoreDir, relPath);
        assert.ok(fs.existsSync(restoredFilePath));
        assert.strictEqual(fs.readFileSync(restoredFilePath, 'utf8'), originalContent);
      }
    });

    it('should inspect and verify container manifest without extracting via verifyBackupContainer', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        sourceFiles: SAMPLE_SOURCE_FILES
      });

      const verification = await verifyBackupContainer(
        backupResult.backupPath,
        TEST_BACKUP_PASSPHRASE
      );

      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.fileCount, 3);
      assert.strictEqual(verification.version, '1.0');
      assert.ok(Array.isArray(verification.files));
      assert.strictEqual(verification.files.length, 3);
      assertNoEmojis(verification);
    });
  });

  describe('Part 3: Cryptographic Authentication & Tampering Resistance', () => {
    it('should reject corrupted ciphertext and throw an authentication error', async () => {
      const tamperedCiphertext = createTamperedCiphertextContainer(TEST_BACKUP_PASSPHRASE);

      await assert.rejects(
        () => restoreEncryptedBackup(tamperedCiphertext, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /authentication tag verification failed|decryption failed/i
      );

      // Verify no files were extracted to destination
      const filesInRestore = fs.readdirSync(testRestoreDir);
      assert.strictEqual(filesInRestore.length, 0);
    });

    it('should reject tampered authentication tag and throw an authentication error', async () => {
      const tamperedTag = createTamperedTagContainer(TEST_BACKUP_PASSPHRASE);

      await assert.rejects(
        () => restoreEncryptedBackup(tamperedTag, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /authentication tag verification failed|decryption failed/i
      );

      const filesInRestore = fs.readdirSync(testRestoreDir);
      assert.strictEqual(filesInRestore.length, 0);
    });

    it('should fail verification via verifyBackupContainer on tampered ciphertext', async () => {
      const tamperedCiphertext = createTamperedCiphertextContainer(TEST_BACKUP_PASSPHRASE);

      await assert.rejects(
        () => verifyBackupContainer(tamperedCiphertext, TEST_BACKUP_PASSPHRASE),
        /decryption failed|authentication tag verification failed/i
      );
    });
  });

  describe('Part 4: Passphrase Rejection & Error Handling', () => {
    it('should reject restore when an incorrect passphrase is provided', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: 'correct_master_passphrase',
        backupDir: testBackupDir,
        sourceFiles: { 'test.json': '{"auth":"valid"}' }
      });

      await assert.rejects(
        () => restoreEncryptedBackup(backupResult.backupPath, 'wrong_passphrase', testRestoreDir),
        /authentication tag verification failed|decryption failed/i
      );

      const filesInRestore = fs.readdirSync(testRestoreDir);
      assert.strictEqual(filesInRestore.length, 0);
    });

    it('should throw an error when passphrase is missing in createEncryptedBackup', async () => {
      const originalPass = process.env.BACKUP_PASSPHRASE;
      const originalKey = process.env.DAVIS_BACKUP_KEY;
      delete process.env.BACKUP_PASSPHRASE;
      delete process.env.DAVIS_BACKUP_KEY;

      try {
        await assert.rejects(
          () => createEncryptedBackup({ backupDir: testBackupDir }),
          /backup passphrase is required/i
        );
      } finally {
        if (originalPass) process.env.BACKUP_PASSPHRASE = originalPass;
        if (originalKey) process.env.DAVIS_BACKUP_KEY = originalKey;
      }
    });

    it('should throw an error when passphrase or destinationDir is missing in restoreEncryptedBackup', async () => {
      const validBuffer = createSyntheticBackupContainer();

      await assert.rejects(
        () => restoreEncryptedBackup(validBuffer, '', testRestoreDir),
        /passphrase is required for restore/i
      );

      await assert.rejects(
        () => restoreEncryptedBackup(validBuffer, TEST_BACKUP_PASSPHRASE, ''),
        /destination directory is required for restore/i
      );
    });

    it('should throw an error if target backup file does not exist on disk', async () => {
      const nonExistentPath = path.join(testBackupDir, 'non_existent.davbak');
      await assert.rejects(
        () => restoreEncryptedBackup(nonExistentPath, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /backup file not found/i
      );
    });
  });

  describe('Part 5: Malformed & Truncated Container Handling', () => {
    it('should reject container with invalid magic bytes (not DAVBAK01)', async () => {
      const invalidMagicContainer = createInvalidMagicContainer();

      await assert.rejects(
        () => restoreEncryptedBackup(invalidMagicContainer, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /invalid magic bytes/i
      );
    });

    it('should reject truncated container buffer shorter than 52 bytes', async () => {
      const truncatedContainer = createTruncatedContainer();

      await assert.rejects(
        () => restoreEncryptedBackup(truncatedContainer, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /buffer too short/i
      );
    });

    it('should reject container with exactly 52 bytes header but empty ciphertext payload', async () => {
      const headerOnly = Buffer.concat([
        DAVBAK_MAGIC,
        crypto.randomBytes(16),
        crypto.randomBytes(12),
        crypto.randomBytes(16)
      ]);

      await assert.rejects(
        () => restoreEncryptedBackup(headerOnly, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /encrypted ciphertext payload is empty/i
      );
    });
  });

  describe('Part 6: Path Traversal Protection', () => {
    it('should identify various path traversal attack strings via isPathTraversal', () => {
      assert.strictEqual(isPathTraversal('../../etc/passwd', testRestoreDir), true);
      assert.strictEqual(isPathTraversal('../evil.sh', testRestoreDir), true);
      assert.strictEqual(isPathTraversal('folder/../../evil.sh', testRestoreDir), true);
      assert.strictEqual(isPathTraversal('..\\windows\\system32', testRestoreDir), true);
      assert.strictEqual(isPathTraversal('/etc/shadow', testRestoreDir), true);
      assert.strictEqual(isPathTraversal('C:\\secret.txt', testRestoreDir), true);

      // Safe relative paths
      assert.strictEqual(isPathTraversal('data/memories.json', testRestoreDir), false);
      assert.strictEqual(isPathTraversal('safe.txt', testRestoreDir), false);
      assert.strictEqual(isPathTraversal('notes/2026/note.md', testRestoreDir), false);
    });

    it('should reject malicious backup container containing path traversal (../../etc/passwd)', async () => {
      const maliciousContainer = createPathTraversalContainer(TEST_BACKUP_PASSPHRASE);

      await assert.rejects(
        () => restoreEncryptedBackup(maliciousContainer, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /path traversal detected/i
      );

      // Verify atomic behavior: neither malicious nor safe file is extracted
      const extractedFiles = fs.readdirSync(testRestoreDir);
      assert.strictEqual(extractedFiles.length, 0);

      // Verify no file was written to parent directory
      const parentDir = path.dirname(testRestoreDir);
      assert.ok(!fs.existsSync(path.join(parentDir, 'etc', 'passwd')));
    });

    it('should block extraction of backslash path traversal attempts', async () => {
      const evilFiles = {
        '..\\escaped.txt': 'evil content',
        'valid.txt': 'good content'
      };
      const container = createSyntheticBackupContainer({
        files: evilFiles,
        passphrase: TEST_BACKUP_PASSPHRASE
      });

      await assert.rejects(
        () => restoreEncryptedBackup(container, TEST_BACKUP_PASSPHRASE, testRestoreDir),
        /path traversal detected/i
      );

      assert.strictEqual(fs.readdirSync(testRestoreDir).length, 0);
    });
  });

  describe('Part 7: Scheduled Backup Routine & Cron Automation', () => {
    it('should schedule backup with default cron 0 3 * * * and timezone Europe/Madrid', () => {
      let registeredExpression = null;
      let registeredOptions = null;
      const mockCron = {
        schedule: (expr, fn, opts) => {
          registeredExpression = expr;
          registeredOptions = opts;
          return {
            start: () => {},
            stop: () => {}
          };
        }
      };

      const controller = scheduleAutomatedBackup(
        { passphrase: TEST_BACKUP_PASSPHRASE, backupDir: testBackupDir },
        { cron: mockCron }
      );

      assert.strictEqual(registeredExpression, '0 3 * * *');
      assert.strictEqual(registeredOptions.timezone, 'Europe/Madrid');
      assert.strictEqual(controller.cronExpression, '0 3 * * *');
      assert.strictEqual(typeof controller.stop, 'function');
      assert.strictEqual(typeof controller.runNow, 'function');
      assertNoEmojis(controller);
    });

    it('should execute backup immediately via controller.runNow', async () => {
      const mockCron = {
        schedule: () => ({ start: () => {}, stop: () => {} })
      };

      const controller = scheduleAutomatedBackup(
        {
          passphrase: TEST_BACKUP_PASSPHRASE,
          backupDir: testBackupDir,
          sourceFiles: { 'manual.json': '{"triggered":"now"}' }
        },
        { cron: mockCron }
      );

      const result = await controller.runNow();
      assert.ok(result.backupPath);
      assert.ok(fs.existsSync(result.backupPath));
      assert.strictEqual(result.fileCount, 1);
    });

    it('should invoke onSuccess callback when scheduled job executes successfully', async () => {
      let jobCallback = null;
      const mockCron = {
        schedule: (expr, fn) => {
          jobCallback = fn;
          return { start: () => {}, stop: () => {} };
        }
      };

      let successPayload = null;
      scheduleAutomatedBackup(
        {
          passphrase: TEST_BACKUP_PASSPHRASE,
          backupDir: testBackupDir,
          sourceFiles: { 'auto.txt': 'automated payload' },
          onSuccess: (res) => {
            successPayload = res;
          }
        },
        { cron: mockCron }
      );

      assert.ok(typeof jobCallback === 'function');
      await jobCallback();

      assert.ok(successPayload);
      assert.ok(successPayload.backupPath);
      assert.strictEqual(successPayload.fileCount, 1);
      assertNoEmojis(successPayload);
    });

    it('should invoke onError callback when scheduled job encounters an error', async () => {
      let jobCallback = null;
      const mockCron = {
        schedule: (expr, fn) => {
          jobCallback = fn;
          return { start: () => {}, stop: () => {} };
        }
      };

      let capturedError = null;
      scheduleAutomatedBackup(
        {
          // Missing passphrase causes createEncryptedBackup to fail
          backupDir: testBackupDir,
          onError: (err) => {
            capturedError = err;
          }
        },
        { cron: mockCron }
      );

      await jobCallback();
      assert.ok(capturedError instanceof Error);
      assert.match(capturedError.message, /passphrase is required/i);
      assertNoEmojis(capturedError);
    });

    it('should stop globally active scheduled backup via stopScheduledBackup', () => {
      let stopped = false;
      const mockCron = {
        schedule: () => ({
          start: () => {},
          stop: () => {
            stopped = true;
          }
        })
      };

      scheduleAutomatedBackup(
        { passphrase: TEST_BACKUP_PASSPHRASE },
        { cron: mockCron }
      );

      const stoppedResult = stopScheduledBackup();
      assert.strictEqual(stoppedResult, true);
      assert.strictEqual(stopped, true);

      // Calling stop again should return false (no active task)
      assert.strictEqual(stopScheduledBackup(), false);
    });
  });

  describe('Part 8: Backup Management, Listing & Retention Pruning', () => {
    it('should list backups sorted descending by modification time', async () => {
      const file1 = path.join(testBackupDir, 'backup_20261028_100000.davbak');
      const file2 = path.join(testBackupDir, 'backup_20261028_110000.davbak');
      const file3 = path.join(testBackupDir, 'backup_20261028_120000.davbak');

      fs.writeFileSync(file1, createSyntheticBackupContainer());
      fs.writeFileSync(file2, createSyntheticBackupContainer());
      fs.writeFileSync(file3, createSyntheticBackupContainer());

      // Artificially space mtimes
      const now = Date.now();
      fs.utimesSync(file1, new Date(now - 30000), new Date(now - 30000));
      fs.utimesSync(file2, new Date(now - 20000), new Date(now - 20000));
      fs.utimesSync(file3, new Date(now - 10000), new Date(now - 10000));

      const backups = listBackups(testBackupDir);
      assert.strictEqual(backups.length, 3);
      assert.strictEqual(backups[0].filename, 'backup_20261028_120000.davbak');
      assert.strictEqual(backups[1].filename, 'backup_20261028_110000.davbak');
      assert.strictEqual(backups[2].filename, 'backup_20261028_100000.davbak');
      assertNoEmojis(backups);
    });

    it('should prune old backups beyond keepCount threshold', async () => {
      for (let i = 1; i <= 6; i++) {
        const filePath = path.join(testBackupDir, `backup_20261028_0${i}0000.davbak`);
        fs.writeFileSync(filePath, createSyntheticBackupContainer());
        const time = new Date(Date.now() + i * 1000);
        fs.utimesSync(filePath, time, time);
      }

      assert.strictEqual(listBackups(testBackupDir).length, 6);

      const pruneResult = pruneOldBackups(testBackupDir, 3);
      assert.strictEqual(pruneResult.deletedCount, 3);
      assert.strictEqual(pruneResult.remainingCount, 3);
      assert.strictEqual(pruneResult.deletedFiles.length, 3);
      assertNoEmojis(pruneResult);

      const remaining = listBackups(testBackupDir);
      assert.strictEqual(remaining.length, 3);
      assert.strictEqual(remaining[0].filename, 'backup_20261028_060000.davbak');
      assert.strictEqual(remaining[1].filename, 'backup_20261028_050000.davbak');
      assert.strictEqual(remaining[2].filename, 'backup_20261028_040000.davbak');
    });

    it('should format filename correctly via generateBackupFilename', () => {
      const fixedDate = new Date('2026-10-28T14:30:45.000Z');
      const filename = generateBackupFilename(fixedDate);
      assert.match(filename, /^backup_\d{8}_\d{6}\.davbak$/);
      assertNoEmojis(filename);
    });
  });

  describe('Part 9: Strict Zero-Emoji Verification', () => {
    it('should verify zero emojis in all service functions and return envelopes', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: TEST_BACKUP_PASSPHRASE,
        backupDir: testBackupDir,
        sourceFiles: SAMPLE_SOURCE_FILES
      });
      assertNoEmojis(backupResult, 'createEncryptedBackup output');

      const restoreResult = await restoreEncryptedBackup(
        backupResult.backupPath,
        TEST_BACKUP_PASSPHRASE,
        testRestoreDir
      );
      assertNoEmojis(restoreResult, 'restoreEncryptedBackup output');

      const verification = await verifyBackupContainer(
        backupResult.backupPath,
        TEST_BACKUP_PASSPHRASE
      );
      assertNoEmojis(verification, 'verifyBackupContainer output');

      const listResult = listBackups(testBackupDir);
      assertNoEmojis(listResult, 'listBackups output');

      const pruneResult = pruneOldBackups(testBackupDir, 5);
      assertNoEmojis(pruneResult, 'pruneOldBackups output');
    });
  });
});
