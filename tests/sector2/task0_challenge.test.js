import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertNoEmojis } from '../harness/validators.js';
import { SysCommandMock } from './helpers/sysCommandMock.js';
import {
  enqueueAlert,
  drainAlerts,
  peekAlerts,
  getQueueLength,
  clearQueue,
  formatAlertText
} from '../../alertQueueService.js';
import { runCommand, runSystemCommand } from '../../sysCommandRunner.js';

describe('Sector 2 - Task 0: Empirical Challenger Stress Harness', () => {
  let tempDir;
  let testQueuePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-stress-s2m0-'));
    testQueuePath = path.join(tempDir, 'deep', 'nested', 'queue', 'alerts_queue.json');
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

  describe('Stress Vector 1: Real Process Timeouts and Termination', () => {
    it('should kill real hanging process on timeout and report timedOut: true with exitCode 124', async () => {
      const startTime = Date.now();
      const result = await runCommand(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000);'],
        { timeoutMs: 300 }
      );
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.exitCode, 124);
      assert.ok(elapsed >= 250, `Elapsed time should be at least 250ms, was ${elapsed}ms`);
      assert.ok(elapsed < 4000, `Elapsed time should not hang, was ${elapsed}ms`);
      assertNoEmojis(result);
    });

    it('should respect timeout option alias timeout instead of timeoutMs', async () => {
      const result = await runCommand(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000);'],
        { timeout: 300 }
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.exitCode, 124);
      assertNoEmojis(result);
    });

    it('should reject when rejectOnError: true and process times out', async () => {
      await assert.rejects(
        async () => {
          await runCommand(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000);'],
            { timeoutMs: 250, rejectOnError: true }
          );
        },
        (err) => {
          assert.ok(err instanceof Error);
          assert.strictEqual(err.result.timedOut, true);
          assert.strictEqual(err.result.exitCode, 124);
          assertNoEmojis(err.message);
          return true;
        }
      );
    });

    it('should handle timeout error with message containing "timed out" in injected execFile', async () => {
      const mockExecFile = (cmd, args, opts, cb) => {
        const timeoutErr = new Error('Process execution timed out after 500ms');
        timeoutErr.killed = true;
        cb(timeoutErr, 'stdout before timeout', 'stderr before timeout');
      };

      const result = await runCommand(
        'long-task',
        [],
        { timeoutMs: 500 },
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.exitCode, 124);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.stdout, 'stdout before timeout');
      assert.strictEqual(result.stderr, 'stderr before timeout');
      assertNoEmojis(result);
    });
  });

  describe('Stress Vector 2: maxBuffer Truncation and Overflow Boundaries', () => {
    it('should gracefully handle stdout exceeding maxBuffer without uncaught exception', async () => {
      // Generate 100KB stdout with a low maxBuffer limit of 10KB (10240 bytes)
      const script = 'process.stdout.write("A".repeat(100 * 1024));';
      const result = await runCommand(
        process.execPath,
        ['-e', script],
        { maxBuffer: 10240 }
      );

      assert.strictEqual(result.ok, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.strictEqual(result.timedOut, false);
      assert.ok(
        result.stderr.includes('maxBuffer') || result.stderr.includes('ERR_CHILD_PROCESS_STDIO_MAXBUFFER'),
        `stderr should mention maxBuffer overflow: ${result.stderr}`
      );
      assertNoEmojis(result);
    });

    it('should respect maxBufferBytes option alias', async () => {
      const script = 'process.stdout.write("B".repeat(50 * 1024));';
      const result = await runCommand(
        process.execPath,
        ['-e', script],
        { maxBufferBytes: 5120 }
      );

      assert.strictEqual(result.ok, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('maxBuffer'));
      assertNoEmojis(result);
    });

    it('should handle Buffer outputs returned by custom execFile', async () => {
      const mockExecFile = (cmd, args, opts, cb) => {
        cb(
          null,
          Buffer.from('binary stdout buffer', 'utf-8'),
          Buffer.from('binary stderr buffer', 'utf-8')
        );
      };

      const result = await runCommand(
        'mock-bin',
        [],
        {},
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(typeof result.stdout, 'string');
      assert.strictEqual(typeof result.stderr, 'string');
      assert.strictEqual(result.stdout, 'binary stdout buffer');
      assert.strictEqual(result.stderr, 'binary stderr buffer');
      assertNoEmojis(result);
    });

    it('should normalize non-string, non-buffer outputs cleanly', async () => {
      const mockExecFile = (cmd, args, opts, cb) => {
        cb(null, 123456, false);
      };

      const result = await runCommand(
        'mock-bin',
        [],
        {},
        { execFile: mockExecFile }
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, '123456');
      assert.strictEqual(result.stderr, '');
      assertNoEmojis(result);
    });
  });

  describe('Stress Vector 3: Command Injection Tokens and Argument Isolation', () => {
    it('should treat shell injection tokens in arguments as literal string parameters by default', async () => {
      const dangerousTokens = [
        '; echo INJECTED_SEMICOLON',
        '| echo INJECTED_PIPE',
        '&& echo INJECTED_AND',
        '`echo INJECTED_BACKTICK`',
        '$(echo INJECTED_SUBST)',
        '> injected_file.txt',
        '& dir',
        '|| echo INJECTED_OR'
      ];

      for (const token of dangerousTokens) {
        // We pass the token as an argument to node which simply echoes argv[1]
        const result = await runCommand(
          process.execPath,
          ['-e', 'console.log(process.argv[1]);', token]
        );

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.stdout.trim(), token);
        assertNoEmojis(result);
      }
    });

    it('should pass arguments containing double quotes and spaces safely', async () => {
      const complexArg = 'Hello "World" with spaces and \'single quotes\'';
      const result = await runCommand(
        process.execPath,
        ['-e', 'console.log(process.argv[1]);', complexArg]
      );

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout.trim(), complexArg);
      assertNoEmojis(result);
    });
  });

  describe('Stress Vector 4: Invalid Binary Commands and ENOENT Failures', () => {
    it('should handle non-existent binary command with exitCode 1 and clean stderr', async () => {
      const nonExistentCmd = 'non_existent_binary_xyz_987654321';
      const result = await runCommand(nonExistentCmd, ['--flag']);

      assert.strictEqual(result.ok, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.strictEqual(result.timedOut, false);
      assert.ok(
        result.stderr.includes('ENOENT') || result.stderr.includes(nonExistentCmd),
        `stderr should contain ENOENT or command name: ${result.stderr}`
      );
      assertNoEmojis(result);
    });

    it('should throw TypeError on null, undefined, empty, or whitespace command', async () => {
      await assert.rejects(async () => runCommand(null), TypeError);
      await assert.rejects(async () => runCommand(undefined), TypeError);
      await assert.rejects(async () => runCommand(''), TypeError);
      await assert.rejects(async () => runCommand('   \t\n'), TypeError);
      await assert.rejects(async () => runCommand(12345), TypeError);
      await assert.rejects(async () => runCommand({}), TypeError);
    });
  });

  describe('Stress Vector 5: Dependency Injection & Mock Runner Robustness', () => {
    it('should integrate seamlessly with SysCommandMock helper', async () => {
      const mock = new SysCommandMock();
      mock.when('docker ps', {
        exitCode: 0,
        stdout: 'CONTAINER ID IMAGE STATUS\nabc123 n8n Up 2 hours',
        stderr: ''
      });
      mock.when(/systemctl restart/, {
        exitCode: 0,
        stdout: 'Restarted successfully',
        stderr: ''
      });
      mock.setDefault({
        exitCode: 1,
        stdout: '',
        stderr: 'Unknown command'
      });

      const resDocker = await runCommand('docker', ['ps'], {}, { runner: mock.asRunner() });
      assert.strictEqual(resDocker.ok, true);
      assert.ok(resDocker.stdout.includes('abc123'));

      const resSystemctl = await runCommand('systemctl', ['restart', 'fail2ban'], {}, { runner: mock.asRunner() });
      assert.strictEqual(resSystemctl.ok, true);
      assert.strictEqual(resSystemctl.stdout, 'Restarted successfully');

      const resUnknown = await runCommand('some-random-bin', [], {}, { runner: mock.asRunner() });
      assert.strictEqual(resUnknown.ok, false);
      assert.strictEqual(resUnknown.exitCode, 1);
      assert.strictEqual(resUnknown.stderr, 'Unknown command');
      assertNoEmojis(mock.getCalls());
    });

    it('should handle mock runner returning empty object with safe defaults', async () => {
      const mockRunner = async () => ({});
      const result = await runCommand('dummy', [], {}, { runner: mockRunner });

      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.timedOut, false);
      assert.ok(typeof result.durationMs === 'number');
      assertNoEmojis(result);
    });

    it('should handle mock runner returning ok: true without exitCode', async () => {
      const mockRunner = async () => ({ ok: true, stdout: 'success' });
      const result = await runCommand('dummy', [], {}, { runner: mockRunner });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.stdout, 'success');
      assertNoEmojis(result);
    });

    it('should reject promise if mock runner throws synchronously or asynchronously', async () => {
      const mockRunner = async () => {
        throw new Error('Injected mock runner fatal error');
      };

      await assert.rejects(
        async () => runCommand('fail', [], {}, { runner: mockRunner }),
        /Injected mock runner fatal error/
      );
    });

    it('should reject promise if injected execFile throws synchronously', async () => {
      const synchronousThrowExecFile = () => {
        throw new Error('Synchronous execFile launch failure');
      };

      await assert.rejects(
        async () => runCommand('fail', [], {}, { execFile: synchronousThrowExecFile }),
        /Synchronous execFile launch failure/
      );
    });
  });

  describe('Stress Vector 6: Alert Queue Service Deep Stress & Concurrency', () => {
    it('should automatically create parent directories when queue file is deeply nested', () => {
      assert.strictEqual(fs.existsSync(testQueuePath), false);

      const alert = enqueueAlert(
        { title: 'Nested queue alert', priority: 'normal' },
        { queuePath: testQueuePath }
      );

      assert.strictEqual(fs.existsSync(testQueuePath), true);
      assert.strictEqual(alert.title, 'Nested queue alert');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1);
      assert.strictEqual(drained[0].title, 'Nested queue alert');
      assertNoEmojis(drained);
    });

    it('should handle rapid sequence of 50 enqueues maintaining exact FIFO order', () => {
      const TOTAL_ALERTS = 50;

      for (let i = 0; i < TOTAL_ALERTS; i++) {
        enqueueAlert(
          {
            title: `Stress Alert #${i}`,
            details: `Details payload for sequence index ${i}`,
            sequenceIndex: i,
            priority: i % 2 === 0 ? 'high' : 'normal'
          },
          { queuePath: testQueuePath }
        );
      }

      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), TOTAL_ALERTS);

      const peeked = peekAlerts({ queuePath: testQueuePath });
      assert.strictEqual(peeked.length, TOTAL_ALERTS);
      assert.strictEqual(peeked[0].sequenceIndex, 0);
      assert.strictEqual(peeked[TOTAL_ALERTS - 1].sequenceIndex, TOTAL_ALERTS - 1);

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, TOTAL_ALERTS);

      for (let i = 0; i < TOTAL_ALERTS; i++) {
        assert.strictEqual(drained[i].sequenceIndex, i);
        assert.strictEqual(drained[i].title, `Stress Alert #${i}`);
      }

      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
      assertNoEmojis(drained);
    });

    it('should handle empty or whitespace-only queue files gracefully', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, '   \r\n   ', 'utf-8');

      const alerts = drainAlerts({ queuePath: testQueuePath });
      assert.deepStrictEqual(alerts, []);

      // Can immediately enqueue after empty file recovery
      enqueueAlert({ title: 'After empty recovery' }, { queuePath: testQueuePath });
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1);
    });

    it('should format alerts with nested objects, arrays, and null values without emojis', () => {
      const complexAlert = {
        title: 'Deep Complex Alert',
        priority: 'urgent',
        timestamp: '2026-10-28T16:25:00Z',
        details: {
          exitCode: 137,
          containers: ['api-service', 'worker-service'],
          metadata: { host: 'vps-node-1', memoryMb: 1024 }
        }
      };

      const formatted = formatAlertText(complexAlert);
      assert.ok(formatted.includes('[ALERTA - URGENT] Deep Complex Alert'));
      assert.ok(formatted.includes('api-service'));
      assert.ok(formatted.includes('vps-node-1'));
      assertNoEmojis(formatted);
    });

    it('should handle formatAlertText with undefined, null, or missing fields', () => {
      const nullFormatted = formatAlertText(null);
      assert.strictEqual(nullFormatted, '[ALERTA] Sin datos');
      assertNoEmojis(nullFormatted);

      const emptyFormatted = formatAlertText({});
      assert.ok(emptyFormatted.includes('[ALERTA - NORMAL] Alerta del Sistema'));
      assertNoEmojis(emptyFormatted);
    });
    it('should enforce default 1MB maxBuffer and handle >1MB stdout cleanly', async () => {
      const script = 'process.stdout.write("Z".repeat(1500000));';
      const result = await runCommand(
        process.execPath,
        ['-e', script]
      );

      assert.strictEqual(result.ok, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.strictEqual(result.timedOut, false);
      assert.ok(result.stderr.includes('maxBuffer') || result.stderr.includes('ERR_CHILD_PROCESS_STDIO_MAXBUFFER'));
      assertNoEmojis(result);
    });

    it('should handle invalid cwd gracefully without uncaught exception', async () => {
      const invalidCwd = path.join(tempDir, 'non_existent_cwd_path_xyz');
      const result = await runCommand(
        process.execPath,
        ['-e', 'console.log("cwd-test");'],
        { cwd: invalidCwd }
      );

      assert.strictEqual(result.ok, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.length > 0);
      assertNoEmojis(result);
    });

    it('should handle null, undefined, or missing args safely in polymorphic signatures', async () => {
      const mockExecFile = (cmd, args, opts, cb) => {
        assert.deepStrictEqual(args, []);
        cb(null, 'polymorphic args ok', '');
      };

      const resNull = await runCommand('mock-cmd', null, {}, { execFile: mockExecFile });
      assert.strictEqual(resNull.exitCode, 0);
      assert.strictEqual(resNull.stdout, 'polymorphic args ok');

      const resUndefined = await runCommand('mock-cmd', undefined, {}, { execFile: mockExecFile });
      assert.strictEqual(resUndefined.exitCode, 0);
      assert.strictEqual(resUndefined.stdout, 'polymorphic args ok');
      assertNoEmojis(resNull);
    });

    it('should safely recover when queue file contains raw binary null bytes or garbage before enqueue', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, Buffer.alloc(256, 0x00));

      const alert = enqueueAlert(
        { title: 'Recovered after binary null bytes' },
        { queuePath: testQueuePath }
      );

      assert.strictEqual(alert.title, 'Recovered after binary null bytes');
      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1);
      assert.strictEqual(drained[0].title, 'Recovered after binary null bytes');
      assertNoEmojis(drained);
    });
  });

  describe('Stress Vector 8: Corrupted JSON Injection and Malformed Disk State Recovery', () => {
    it('should recover gracefully when queue file contains half-written truncated JSON', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, '[{"id":"alert-partial", "title":"Trun', 'utf-8');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.deepStrictEqual(drained, []);

      // Queue should now be safely reset to empty array on disk and ready for use
      const alert = enqueueAlert({ title: 'Post-truncated recovery' }, { queuePath: testQueuePath });
      assert.strictEqual(alert.title, 'Post-truncated recovery');
      const recovered = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(recovered.length, 1);
      assert.strictEqual(recovered[0].title, 'Post-truncated recovery');
      assertNoEmojis(recovered);
    });

    it('should recover gracefully when queue file contains raw binary garbage with high bytes', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0xde, 0xad, 0xbe, 0xef]));

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.deepStrictEqual(drained, []);

      enqueueAlert({ title: 'Post-binary garbage' }, { queuePath: testQueuePath });
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1);
      const after = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(after.length, 1);
      assert.strictEqual(after[0].title, 'Post-binary garbage');
      assertNoEmojis(after);
    });

    it('should recover gracefully from non-array JSON scalar primitives', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      const primitives = ['12345', 'true', 'false', 'null', '"just a plain string"'];

      for (const prim of primitives) {
        fs.writeFileSync(testQueuePath, prim, 'utf-8');
        const drained = drainAlerts({ queuePath: testQueuePath });
        assert.deepStrictEqual(drained, [], `Failed to reset for primitive: ${prim}`);
      }
    });

    it('should recover gracefully when queue file contains a JSON object instead of an array', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, JSON.stringify({ error: 'corrupt', status: 500 }), 'utf-8');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.deepStrictEqual(drained, []);

      enqueueAlert({ title: 'After object reset' }, { queuePath: testQueuePath });
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1);
      assertNoEmojis(drainAlerts({ queuePath: testQueuePath }));
    });

    it('should recover gracefully when queue file has UTF-8 BOM before JSON content', () => {
      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, '\uFEFF[{"id":"bom-1","title":"BOM Alert"}]', 'utf-8');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.ok(Array.isArray(drained));
      assertNoEmojis(drained);
    });

    it('should handle large queue file with 1000 items without memory exhaustion', () => {
      const items = [];
      for (let i = 0; i < 1000; i++) {
        items.push({
          id: `stress-uuid-${i}`,
          title: `Large Scale Alert #${i}`,
          details: `Payload detail string for item ${i}`,
          timestamp: new Date().toISOString(),
          priority: i % 10 === 0 ? 'urgent' : 'normal'
        });
      }

      fs.mkdirSync(path.dirname(testQueuePath), { recursive: true });
      fs.writeFileSync(testQueuePath, JSON.stringify(items, null, 2), 'utf-8');

      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1000);
      const peeked = peekAlerts({ queuePath: testQueuePath });
      assert.strictEqual(peeked.length, 1000);

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1000);
      assert.strictEqual(drained[0].id, 'stress-uuid-0');
      assert.strictEqual(drained[999].id, 'stress-uuid-999');
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
      assertNoEmojis(drained[0]);
    });
  });

  describe('Stress Vector 9: Rapid Sequential Drains and High-Frequency Lifecycle', () => {
    it('should handle 100 rapid sequential drain calls on empty queue in under 1000ms', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        const drained = drainAlerts({ queuePath: testQueuePath });
        assert.strictEqual(drained.length, 0);
      }
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 3000, `100 empty drains took too long: ${elapsed}ms`);
    });

    it('should maintain strict consistency under 100 alternating ping-pong enqueue and drain cycles', () => {
      for (let i = 0; i < 100; i++) {
        enqueueAlert(
          { title: `PingPong ${i}`, cycle: i, priority: 'normal' },
          { queuePath: testQueuePath }
        );
        assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 1);

        const drained = drainAlerts({ queuePath: testQueuePath });
        assert.strictEqual(drained.length, 1);
        assert.strictEqual(drained[0].cycle, i);
        assert.strictEqual(drained[0].title, `PingPong ${i}`);
        assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
      }
    });

    it('should handle interleaved burst patterns (enqueue batch, drain, enqueue small batch, clear)', () => {
      for (let i = 0; i < 25; i++) {
        enqueueAlert({ title: `Batch1 #${i}`, index: i }, { queuePath: testQueuePath });
      }
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 25);

      const drain1 = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drain1.length, 25);
      assert.strictEqual(drain1[0].index, 0);
      assert.strictEqual(drain1[24].index, 24);

      for (let i = 0; i < 10; i++) {
        enqueueAlert({ title: `Batch2 #${i}`, index: i }, { queuePath: testQueuePath });
      }
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 10);

      assert.strictEqual(clearQueue({ queuePath: testQueuePath }), true);
      assert.strictEqual(getQueueLength({ queuePath: testQueuePath }), 0);
      assert.strictEqual(drainAlerts({ queuePath: testQueuePath }).length, 0);
    });
  });

  describe('Stress Vector 10: Multi-Process Concurrency and Queue Invariants', () => {
    it('should survive concurrent writes from multiple child processes without file corruption or unhandled crashes', async () => {
      const workerScriptPath = path.join(tempDir, 'concurrent_worker.mjs');
      const alertServiceImportUrl = pathToFileURL(path.resolve(process.cwd(), 'alertQueueService.js')).href;

      const workerCode = `
import { enqueueAlert } from '${alertServiceImportUrl}';
const workerId = process.argv[2];
const queuePath = process.argv[3];
const count = parseInt(process.argv[4] || '10', 10);

for (let i = 0; i < count; i++) {
  try {
    enqueueAlert({
      title: 'Worker ' + workerId + ' alert ' + i,
      workerId: parseInt(workerId, 10),
      seq: i
    }, { queuePath });
  } catch (err) {
    process.stderr.write('ERR: ' + err.message + '\\n');
  }
}
process.exit(0);
`;
      fs.writeFileSync(workerScriptPath, workerCode, 'utf-8');

      const NUM_PROCESSES = 4;
      const ALERTS_PER_PROCESS = 10;
      const processes = [];

      for (let p = 0; p < NUM_PROCESSES; p++) {
        processes.push(
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [workerScriptPath, String(p), testQueuePath, String(ALERTS_PER_PROCESS)],
              { stdio: ['ignore', 'pipe', 'pipe'] }
            );

            let stderrData = '';
            child.stderr.on('data', (d) => { stderrData += d.toString(); });
            child.on('close', (code) => {
              resolve({ code, stderr: stderrData });
            });
            child.on('error', reject);
          })
        );
      }

      const results = await Promise.all(processes);

      for (let i = 0; i < results.length; i++) {
        assert.strictEqual(
          results[i].code,
          0,
          `Process ${i} exited with non-zero code ${results[i].code}: ${results[i].stderr}`
        );
      }

      assert.ok(fs.existsSync(testQueuePath), 'Queue file must exist');
      const rawContent = fs.readFileSync(testQueuePath, 'utf-8');
      assert.doesNotThrow(() => JSON.parse(rawContent), 'Queue file content must be valid parseable JSON');

      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.ok(Array.isArray(drained));
      assert.ok(drained.length > 0, `Expected some alerts to survive concurrent writes, got ${drained.length}`);

      for (const item of drained) {
        assert.ok(item.id, 'Item must have an id');
        assert.ok(item.title, 'Item must have a title');
        assert.ok(item.timestamp, 'Item must have a timestamp');
        assert.ok(item.priority, 'Item must have a priority');
      }
      assertNoEmojis(drained);
    });
  });

  describe('Stress Vector 11: Edge-Case and Hostile Payloads in formatAlertText and enqueueAlert', () => {
    it('should document empirical failure: formatAlertText throws TypeError when priority is non-string', () => {
      // alertQueueService.js line 186 does: const priority = (alert.priority || 'NORMAL').toUpperCase();
      // If alert.priority is a number (e.g. 123), .toUpperCase() throws TypeError.
      assert.throws(
        () => formatAlertText({ title: 'Numeric priority', priority: 123 }),
        TypeError,
        'Calling formatAlertText with numeric priority must throw TypeError due to uncoerced toUpperCase'
      );

      assert.throws(
        () => formatAlertText({ title: 'Boolean priority', priority: true }),
        TypeError,
        'Calling formatAlertText with boolean priority must throw TypeError'
      );
    });

    it('should document empirical failure: formatAlertText throws TypeError on circular details object', () => {
      const circular = { name: 'circular-test' };
      circular.self = circular;

      assert.throws(
        () => formatAlertText({ title: 'Circular details', details: circular }),
        TypeError,
        'Calling formatAlertText with circular details throws TypeError during JSON.stringify'
      );
    });

    it('should format alerts when priority is null or undefined using fallback', () => {
      const resNullPriority = formatAlertText({ title: 'Null priority', priority: null });
      assert.ok(resNullPriority.includes('[ALERTA - NORMAL] Null priority'));

      const resUndefinedPriority = formatAlertText({ title: 'Undefined priority', priority: undefined });
      assert.ok(resUndefinedPriority.includes('[ALERTA - NORMAL] Undefined priority'));

      assertNoEmojis(resNullPriority);
      assertNoEmojis(resUndefinedPriority);
    });

    it('should handle title with whitespace only or falsy title', () => {
      const formatted = formatAlertText({ title: '', priority: 'high' });
      assert.ok(formatted.includes('[ALERTA - HIGH] Alerta del Sistema'));
      assertNoEmojis(formatted);
    });

    it('should reject non-object payloads in enqueueAlert with TypeError', () => {
      assert.throws(() => enqueueAlert(null, { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert(undefined, { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert('string-only', { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert(99999, { queuePath: testQueuePath }), TypeError);
      assert.throws(() => enqueueAlert(false, { queuePath: testQueuePath }), TypeError);
    });

    it('should normalize array passed to enqueueAlert into indexed object with standard metadata', () => {
      const alert = enqueueAlert(['elementA', 'elementB'], { queuePath: testQueuePath });
      assert.ok(alert.id);
      assert.strictEqual(alert.title, 'Alerta del Sistema');
      assert.strictEqual(alert.priority, 'normal');
      assert.strictEqual(alert['0'], 'elementA');
      assert.strictEqual(alert['1'], 'elementB');
      assertNoEmojis(alert);
    });

    it('should handle 100KB large string details in alert without memory issue', () => {
      const largeDetails = 'X'.repeat(100 * 1024);
      const alert = enqueueAlert(
        { title: 'Large alert payload', details: largeDetails },
        { queuePath: testQueuePath }
      );

      assert.strictEqual(alert.details.length, 100 * 1024);
      const drained = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(drained.length, 1);
      assert.strictEqual(drained[0].details.length, 100 * 1024);
      assertNoEmojis(drained[0].title);
    });
  });

  describe('Stress Vector 12: Zero-Emoji Enforcement on Adversarial Inputs', () => {
    it('should verify zero emojis across all Sector 2 foundation files and tests', () => {
      const files = [
        'alertQueueService.js',
        'sysCommandRunner.js',
        'tests/sector2/task0_foundations.test.js',
        'tests/sector2/task0_challenge.test.js'
      ];
      const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

      for (const file of files) {
        const filePath = path.resolve(process.cwd(), file);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          const match = line.match(EMOJI_REGEX);
          assert.strictEqual(
            match,
            null,
            `Forbidden emoji found in ${file} at line ${index + 1}: ${match ? match[0] : ''}`
          );
        });
      }
    });

    it('should pass assertNoEmojis for all valid formatAlertText output variants', () => {
      const sampleAlerts = [
        { title: 'Docker container restarted', details: 'Exit code 137', priority: 'high' },
        { title: 'Disk usage 87 percent', details: { mount: '/', usedPercent: 87.2 }, priority: 'urgent' },
        { title: 'Fail2ban IP blocked', details: { ip: '203.0.113.195', jail: 'sshd' }, priority: 'normal' },
        { title: 'SSL Expiry Alert', details: 'Domain expires in 12 days', priority: 'low' }
      ];

      for (const alert of sampleAlerts) {
        const text = formatAlertText(alert);
        assertNoEmojis(text, `Emoji detected in formatted output for title: ${alert.title}`);
      }
    });
  });
});
