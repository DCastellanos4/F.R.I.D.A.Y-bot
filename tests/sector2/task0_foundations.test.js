import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertNoEmojis } from '../harness/validators.js';
import {
  enqueueAlert,
  drainAlerts,
  peekAlerts,
  getQueueLength,
  clearQueue,
  formatAlertText,
  DEFAULT_QUEUE_FILE
} from '../../alertQueueService.js';
import { runCommand, runSystemCommand } from '../../sysCommandRunner.js';

describe('Sector 2 - Task 0: Foundations (Alert Queue & Command Runner)', () => {
  let tempDir;
  let testQueuePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-test-s2m0-'));
    testQueuePath = path.join(tempDir, 'data', 'alerts_queue.json');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Part 1: alertQueueService.js (Inter-process FIFO Queue)', () => {
    it('should export DEFAULT_QUEUE_FILE pointing to data/alerts_queue.json', () => {
      assert.ok(typeof DEFAULT_QUEUE_FILE === 'string');
      assert.ok(DEFAULT_QUEUE_FILE.endsWith(path.join('data', 'alerts_queue.json')));
      assertNoEmojis(DEFAULT_QUEUE_FILE);
    });

    it('should return an empty array when draining a non-existent queue', () => {
      const alerts = drainAlerts({ queuePath: testQueuePath });
      assert.ok(Array.isArray(alerts));
      assert.strictEqual(alerts.length, 0);
      assertNoEmojis(alerts);
    });

    it('should enqueue a single alert and assign standard metadata defaults', () => {
      const alert = enqueueAlert(
        {
          title: 'Fallo de contenedor Docker',
          details: 'El contenedor n8n-automation se detuvo con codigo 137',
          priority: 'urgent'
        },
        { queuePath: testQueuePath }
      );

      assert.ok(alert.id);
      assert.strictEqual(alert.title, 'Fallo de contenedor Docker');
      assert.strictEqual(alert.details, 'El contenedor n8n-automation se detuvo con codigo 137');
      assert.strictEqual(alert.priority, 'urgent');
      assert.ok(alert.timestamp);
      assertNoEmojis(alert);

      // Verify written to disk
      assert.ok(fs.existsSync(testQueuePath));
      const diskContent = JSON.parse(fs.readFileSync(testQueuePath, 'utf-8'));
      assert.strictEqual(diskContent.length, 1);
      assert.strictEqual(diskContent[0].id, alert.id);
      assertNoEmojis(diskContent);
    });

    it('should maintain strict FIFO ordering across multiple enqueued alerts', () => {
      enqueueAlert({ title: 'Alerta 1', details: 'Primero', priority: 'low' }, { queuePath: testQueuePath });
      enqueueAlert({ title: 'Alerta 2', details: 'Segundo', priority: 'normal' }, { queuePath: testQueuePath });
      enqueueAlert({ title: 'Alerta 3', details: 'Tercero', priority: 'high' }, { queuePath: testQueuePath });

      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 3);

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 3);
      assert.strictEqual(drained[0].title, 'Alerta 1');
      assert.strictEqual(drained[1].title, 'Alerta 2');
      assert.strictEqual(drained[2].title, 'Alerta 3');
      assertNoEmojis(drained);

      // Draining again must return an empty array
      const secondDrain = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(secondDrain.length, 0);
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
    });

    it('should preserve custom metadata fields passed in alert payload', () => {
      const alert = enqueueAlert(
        {
          title: 'GitHub Actions Failure',
          details: 'Workflow build-deploy failed on branch main',
          priority: 'high',
          repo: 'jarvis-vps',
          commitSha: 'a1b2c3d4e5',
          actor: 'david'
        },
        { queuePath: testQueuePath }
      );

      assert.strictEqual(alert.repo, 'jarvis-vps');
      assert.strictEqual(alert.commitSha, 'a1b2c3d4e5');
      assert.strictEqual(alert.actor, 'david');
      assertNoEmojis(alert);

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1);
      assert.strictEqual(drained[0].repo, 'jarvis-vps');
    });

    it('should peek at pending alerts without removing them', () => {
      enqueueAlert({ title: 'Mensaje pendiente', details: 'Test peek' }, { queuePath: testQueuePath });

      const peeked = peekAlerts({ queuePath: testQueuePath });
      assert.strictEqual(peeked.length, 1);
      assert.strictEqual(peeked[0].title, 'Mensaje pendiente');

      // Verify queue length remains 1
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1);

      // Drain and verify it was preserved
      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1);
    });

    it('should clear queue using clearQueue helper', () => {
      enqueueAlert({ title: 'Temp alert 1' }, { queuePath: testQueuePath });
      enqueueAlert({ title: 'Temp alert 2' }, { queuePath: testQueuePath });
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 2);

      const ok = clearQueue({ queuePath: testQueuePath });
      assert.strictEqual(ok, true);
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
    });

    it('should recover gracefully from corrupted or invalid JSON in queue file', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, 'INVALID_JSON_CONTENT{{{', 'utf-8');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.ok(Array.isArray(drained));
      assert.strictEqual(drained.length, 0);

      // Verify queue is now clean and usable
      enqueueAlert({ title: 'Post-corruption recovery' }, { queuePath: testQueuePath });
      const recovered = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(recovered.length, 1);
      assert.strictEqual(recovered[0].title, 'Post-corruption recovery');
      assertNoEmojis(recovered);
    });

    it('should recover gracefully when queue file contains non-array JSON', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, JSON.stringify({ notAnArray: true }), 'utf-8');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.ok(Array.isArray(drained));
      assert.strictEqual(drained.length, 0);
    });

    it('should reject non-object alert payload with TypeError', () => {
      assert.throws(() => enqueueAlert(null, { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert('string-payload', { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert(12345, { queuePath: testQueuePath }), TypeError);
    });

    it('should format alert text with zero emojis according to standard template', () => {
      const alert = {
        title: 'Disco Superado 85%',
        details: 'Espacio ocupado: 89%. Purga automatica completada.',
        priority: 'high',
        timestamp: '2026-10-28T16:20:00Z'
      };

      const formatted = formatAlertText(alert);
      assert.ok(formatted.includes('[ALERTA - HIGH] Disco Superado 85%'));
      assert.ok(formatted.includes('Espacio ocupado: 89%'));
      assert.ok(formatted.includes('Timestamp: 2026-10-28T16:20:00Z'));
      assertNoEmojis(formatted);
    });

    it('should format alert text when details is an object', () => {
      const alert = {
        title: 'Fail2ban Ban Event',
        details: { ip: '198.51.100.42', jail: 'sshd', attempts: 5 },
        priority: 'urgent',
        timestamp: '2026-10-28T16:25:00Z'
      };

      const formatted = formatAlertText(alert);
      assert.ok(formatted.includes('[ALERTA - URGENT] Fail2ban Ban Event'));
      assert.ok(formatted.includes('198.51.100.42'));
      assert.ok(formatted.includes('sshd'));
      assertNoEmojis(formatted);
    });
  });

  describe('Part 2: sysCommandRunner.js (Hardened Cross-Platform Runner)', () => {
    it('should throw TypeError if command is missing or not a string', async () => {
      await assert.rejects(async () => runCommand(null), TypeError);
      await assert.rejects(async () => runCommand(''), TypeError);
      await assert.rejects(async () => runCommand('   '), TypeError);
    });

    it('should execute successfully using injected deps.execFile mock', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        assert.strictEqual(cmd, 'docker');
        assert.deepStrictEqual(args, ['ps', '-a']);
        assert.strictEqual(opts.timeout, 15000);
        callback(null, 'CONTAINER ID   IMAGE\na1b2c3d4e5f6   n8n:latest\n', '');
      };

      const result = await runCommand(
        'docker',
        ['ps', '-a'],
        { timeoutMs: 15000 },
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.ok, true);
      assert.ok(result.stdout.includes('a1b2c3d4e5f6'));
      assert.strictEqual(result.stderr, '');
      assert.ok(typeof result.durationMs === 'number');
      assert.strictEqual(result.timedOut, false);
      assertNoEmojis(result);
    });

    it('should handle non-zero exit code cleanly without uncaught exception', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        const err = new Error('Command failed: exit code 2');
        err.code = 2;
        callback(err, '', 'Error: flag --unknown not recognized');
      };

      const result = await runCommand(
        'tailscale',
        ['status', '--unknown'],
        {},
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.exitCode, 2);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.stdout, '');
      assert.ok(result.stderr.includes('--unknown not recognized'));
      assert.strictEqual(result.timedOut, false);
      assertNoEmojis(result);
    });

    it('should handle timeout and flag timedOut: true with exitCode 124', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        const err = new Error('Process timed out');
        err.killed = true;
        err.signal = 'SIGTERM';
        callback(err, 'partial output', '');
      };

      const result = await runCommand(
        'sleep',
        ['60'],
        { timeoutMs: 100 },
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.exitCode, 124);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.stdout, 'partial output');
      assertNoEmojis(result);
    });

    it('should support deps.runner for promise-based deterministic mocks', async () => {
      const mockRunner = async (cmd, args, opts) => {
        assert.strictEqual(cmd, 'cloudflared');
        assert.deepStrictEqual(args, ['tunnel', 'info', 'my-tunnel']);
        return {
          exitCode: 0,
          stdout: 'Tunnel connector active and healthy',
          stderr: '',
          durationMs: 45
        };
      };

      const result = await runCommand(
        'cloudflared',
        ['tunnel', 'info', 'my-tunnel'],
        {},
        { runner: mockRunner }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.ok, true);
      assert.ok(result.stdout.includes('active and healthy'));
      assert.strictEqual(result.durationMs, 45);
      assertNoEmojis(result);
    });

    it('should support polymorphic call signatures (args omitted or merged)', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        callback(null, 'uptime ok', '');
      };

      // Signature: runCommand(cmd, options, deps)
      const res1 = await runCommand('uptime', { timeoutMs: 5000 }, { execFile: mockExecFile });
      assert.strictEqual(res1.exitCode, 0);
      assert.strictEqual(res1.stdout, 'uptime ok');

      // Signature: runCommand(cmd, args, { deps: { execFile } })
      const res2 = await runCommand('uptime', [], { deps: { execFile: mockExecFile } });
      assert.strictEqual(res2.exitCode, 0);

      // Signature: runSystemCommand alias
      const res3 = await runSystemCommand('uptime', [], {}, { execFile: mockExecFile });
      assert.strictEqual(res3.exitCode, 0);
      assertNoEmojis(res3);
    });

    it('should reject promise when rejectOnError is explicitly set to true', async () => {
      const mockExecFile = (cmd, args, opts, callback) => {
        const err = new Error('Critical failure');
        err.code = 1;
        callback(err, '', 'Fatal system failure');
      };

      await assert.rejects(
        async () => {
          await runCommand(
            'fail-cmd',
            [],
            { rejectOnError: true },
            { execFile: mockExecFile }
          );
        },
        (err) => {
          assert.ok(err.message.includes('Command failed with exit code 1'));
          assert.strictEqual(err.result.exitCode, 1);
          return true;
        }
      );
    });

    it('should execute real Node.js process and return exit code 0 (smoke test)', async () => {
      const result = await runCommand(
        process.execPath,
        ['-e', 'console.log("smoke-test-stdout"); process.stderr.write("smoke-test-stderr");'],
        { timeoutMs: 10000 }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.ok, true);
      assert.ok(result.stdout.includes('smoke-test-stdout'));
      assert.ok(result.stderr.includes('smoke-test-stderr'));
      assert.strictEqual(result.timedOut, false);
      assert.ok(result.durationMs >= 0);
      assertNoEmojis(result);
    });

    it('should execute real Node.js process with non-zero exit code (smoke test)', async () => {
      const result = await runCommand(
        process.execPath,
        ['-e', 'process.exit(42);'],
        { timeoutMs: 10000 }
      );

      assert.strictEqual(result.exitCode, 42);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.timedOut, false);
      assertNoEmojis(result);
    });

    it('should pass custom environment variables to child process (smoke test)', async () => {
      const result = await runCommand(
        process.execPath,
        ['-e', 'console.log(process.env.DAVIS_TEST_KEY || "NOT_SET");'],
        {
          env: { DAVIS_TEST_KEY: 'DAVIS_SECTOR2_FOUNDATIONS_OK' },
          timeoutMs: 10000
        }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('DAVIS_SECTOR2_FOUNDATIONS_OK'));
      assertNoEmojis(result);
    });

    it('should respect custom working directory cwd (smoke test)', async () => {
      const result = await runCommand(
        process.execPath,
        ['-e', 'console.log(process.cwd());'],
        { cwd: tempDir, timeoutMs: 10000 }
      );

      assert.strictEqual(result.exitCode, 0);
      const normalizedStdout = result.stdout.trim().toLowerCase();
      const normalizedTempDir = tempDir.toLowerCase();
      assert.strictEqual(normalizedStdout, normalizedTempDir);
      assertNoEmojis(result);
    });
  });
});
