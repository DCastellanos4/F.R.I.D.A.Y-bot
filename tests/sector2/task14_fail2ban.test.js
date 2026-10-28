import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertNoEmojis } from './helpers/s2Validators.js';
import { AlertCaptureMock } from './helpers/alertCaptureMock.js';
import { SysCommandMock } from './helpers/sysCommandMock.js';
import {
  FAIL2BAN_LOG_SAMPLES,
  AUTH_LOG_SAMPLES,
  FAIL2BAN_CLI_STATUS_SSHD
} from './fixtures/fail2banFixtures.js';
import {
  parseFail2banLog,
  parseAuthLog,
  queryFail2banStatus,
  formatFail2banAlert,
  scanFail2banLog,
  createFail2banScanState,
  DEFAULT_DEDUP_TTL_MS
} from '../../fail2banMonitorService.js';
import { drainAlerts } from '../../alertQueueService.js';

describe('Sector 2 - Task 14: Fail2ban & SSH Intrusion Security Surveillance', () => {
  let tempDir;
  let testQueuePath;
  let testLogPath;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'davis-test-f2b-'));
    testQueuePath = path.join(tempDir, 'data', 'alerts_queue.json');
    testLogPath = path.join(tempDir, 'fail2ban.log');
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(tempDir)) {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary directory cleanup failure
    }
  });

  describe('Part 1: Log Parsing Engine (parseFail2banLog & parseAuthLog)', () => {
    it('should extract all IPv4 and IPv6 ban events from standard fail2ban log sample', () => {
      const bans = parseFail2banLog(FAIL2BAN_LOG_SAMPLES.standardLog);

      assert.strictEqual(bans.length, 3, 'Should extract exactly 3 ban entries');
      assert.strictEqual(bans[0].ip, '198.51.100.42');
      assert.strictEqual(bans[0].jail, 'sshd');
      assert.strictEqual(bans[0].timestamp, '2026-10-28 14:23:01,123');

      assert.strictEqual(bans[1].ip, '203.0.113.19');
      assert.strictEqual(bans[1].jail, 'sshd');
      assert.strictEqual(bans[1].timestamp, '2026-10-28 14:24:15,456');

      assert.strictEqual(bans[2].ip, '2001:db8:85a3::8a2e:370:7334');
      assert.strictEqual(bans[2].jail, 'sshd');
      assert.strictEqual(bans[2].timestamp, '2026-10-28 14:28:40,789');

      assertNoEmojis(bans, 'Parsed fail2ban log entries must not contain emojis');
    });

    it('should ignore Unban and Restore Ban log entries', () => {
      const logWithUnbans = [
        '2026-10-28 15:23:01,123 fail2ban.actions [1200]: NOTICE [sshd] Unban 198.51.100.42',
        '2026-10-28 15:30:00,000 fail2ban.actions [1200]: NOTICE [sshd] Restore Ban 198.51.100.42'
      ].join('\n');

      const bans = parseFail2banLog(logWithUnbans);
      assert.strictEqual(bans.length, 0, 'Unban and Restore Ban must not produce ban events');
    });

    it('should correctly parse single IPv4 ban line', () => {
      const bans = parseFail2banLog(FAIL2BAN_LOG_SAMPLES.singleBanIpv4);
      assert.strictEqual(bans.length, 1);
      assert.strictEqual(bans[0].ip, '192.0.2.1');
      assert.strictEqual(bans[0].jail, 'sshd');
      assert.strictEqual(bans[0].timestamp, '2026-10-28 16:30:05,123');
      assertNoEmojis(bans);
    });

    it('should correctly parse single IPv6 ban line', () => {
      const bans = parseFail2banLog(FAIL2BAN_LOG_SAMPLES.singleBanIpv6);
      assert.strictEqual(bans.length, 1);
      assert.strictEqual(bans[0].ip, '2001:0db8:0000:0000:0000:ff00:0042:8329');
      assert.strictEqual(bans[0].jail, 'sshd');
      assert.strictEqual(bans[0].timestamp, '2026-10-28 16:32:10,456');
      assertNoEmojis(bans);
    });

    it('should return an empty array for non-ban lines or empty input', () => {
      assert.deepStrictEqual(parseFail2banLog(FAIL2BAN_LOG_SAMPLES.nonBanLines), []);
      assert.deepStrictEqual(parseFail2banLog(''), []);
      assert.deepStrictEqual(parseFail2banLog('   \n  \t  '), []);
      assert.deepStrictEqual(parseFail2banLog(null), []);
      assert.deepStrictEqual(parseFail2banLog(undefined), []);
    });

    it('should extract failed authentication attempts from auth.log', () => {
      const failures = parseAuthLog(AUTH_LOG_SAMPLES);
      assert.strictEqual(failures.length, 3, 'Should extract 3 failed authentication events');

      assert.strictEqual(failures[0].ip, '198.51.100.42');
      assert.strictEqual(failures[0].user, 'test');
      assert.strictEqual(failures[0].port, 48208);
      assert.strictEqual(failures[0].reason, 'invalid_user');

      assert.strictEqual(failures[1].ip, '198.51.100.42');
      assert.strictEqual(failures[1].user, 'root');
      assert.strictEqual(failures[1].port, 48210);
      assert.strictEqual(failures[1].reason, 'failed_password');

      assert.strictEqual(failures[2].ip, '198.51.100.42');
      assert.strictEqual(failures[2].user, 'admin');
      assert.strictEqual(failures[2].port, 48212);
      assert.strictEqual(failures[2].reason, 'failed_password');

      assertNoEmojis(failures);
    });
  });

  describe('Part 2: fail2ban-client CLI Querying (queryFail2banStatus)', () => {
    it('should query fail2ban-client status and parse active jail metrics', async () => {
      const mockRunner = new SysCommandMock();
      mockRunner.when(/fail2ban-client status sshd/, {
        exitCode: 0,
        stdout: FAIL2BAN_CLI_STATUS_SSHD,
        stderr: ''
      });

      const status = await queryFail2banStatus('sshd', {
        sysCommandRunner: mockRunner.asRunner()
      });

      assert.strictEqual(status.jail, 'sshd');
      assert.strictEqual(status.currentlyFailed, 2);
      assert.strictEqual(status.totalFailed, 38);
      assert.deepStrictEqual(status.fileList, ['/var/log/auth.log']);
      assert.strictEqual(status.currentlyBanned, 2);
      assert.strictEqual(status.totalBanned, 11);
      assert.deepStrictEqual(status.bannedIps, ['198.51.100.42', '203.0.113.19']);
      assertNoEmojis(status);
    });

    it('should throw an informative error when fail2ban-client command fails', async () => {
      const mockRunner = new SysCommandMock();
      mockRunner.when(/fail2ban-client/, {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: Unable to contact server: No such file or directory'
      });

      await assert.rejects(
        async () => {
          await queryFail2banStatus('sshd', { sysCommandRunner: mockRunner.asRunner() });
        },
        /Failed to query fail2ban status for jail 'sshd'/
      );
    });
  });

  describe('Part 3: Incremental Byte-Offset Tracking and Log Scanning', () => {
    it('should perform incremental scan from offset 0 and update state offset to file size', async () => {
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.standardLog, 'utf8');
      const expectedSize = Buffer.byteLength(FAIL2BAN_LOG_SAMPLES.standardLog, 'utf8');

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      const newBans = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });

      assert.strictEqual(state.offset, expectedSize, 'Offset should advance to total file size');
      assert.strictEqual(newBans.length, 3, 'Should discover all 3 bans on first pass');
      assert.strictEqual(alertCapture.count(), 3, 'Should emit 3 alerts to notifier');
      assertNoEmojis(newBans);
    });

    it('should return zero new bans when scanning an unchanged file', async () => {
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.standardLog, 'utf8');

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });
      assert.strictEqual(alertCapture.count(), 3);

      // Second scan with no file updates
      const secondScanBans = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });

      assert.strictEqual(secondScanBans.length, 0, 'No new bans should be found on unchanged file');
      assert.strictEqual(alertCapture.count(), 3, 'No additional alerts should be emitted');
    });

    it('should incrementally detect only newly appended ban lines', async () => {
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.standardLog, 'utf8');

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });
      assert.strictEqual(alertCapture.count(), 3);

      // Append new ban line
      const appendLine = '\n' + FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n';
      await fsPromises.appendFile(testLogPath, appendLine, 'utf8');

      const secondScanBans = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });

      assert.strictEqual(secondScanBans.length, 1, 'Should detect exactly the newly appended ban');
      assert.strictEqual(secondScanBans[0].ip, '192.0.2.1');
      assert.strictEqual(alertCapture.count(), 4, 'Total alerts should now be 4');
      assertNoEmojis(secondScanBans);
    });

    it('should gracefully handle non-existent log file by returning empty array', async () => {
      const state = createFail2banScanState();
      const nonExistentPath = path.join(tempDir, 'does_not_exist.log');

      const bans = await scanFail2banLog(nonExistentPath, state);
      assert.deepStrictEqual(bans, []);
      assert.strictEqual(state.offset, 0);
    });
  });

  describe('Part 4: Logrotate Handling (Shrink / Truncation Reset)', () => {
    it('should reset offset to 0 when file size is smaller than previous offset', async () => {
      // 1. Initial large log
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.standardLog, 'utf8');

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });
      const initialOffset = state.offset;
      assert.ok(initialOffset > 200);

      // 2. Simulate logrotate: file truncated and recreated with a single new ban
      const rotatedLog = '2026-10-28 17:00:00,100 fail2ban.actions [1200]: NOTICE [sshd] Ban 198.51.100.99\n';
      await fsPromises.writeFile(testLogPath, rotatedLog, 'utf8');
      const rotatedSize = Buffer.byteLength(rotatedLog, 'utf8');
      assert.ok(rotatedSize < initialOffset, 'Rotated file must be smaller than initial offset');

      // 3. Scan again
      const postRotateBans = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier()
      });

      assert.strictEqual(postRotateBans.length, 1, 'Should detect ban in rotated log');
      assert.strictEqual(postRotateBans[0].ip, '198.51.100.99');
      assert.strictEqual(state.offset, rotatedSize, 'Offset should be updated to rotated file size');
      assertNoEmojis(postRotateBans);
    });
  });

  describe('Part 5: 24-Hour Deduplication Cache', () => {
    it('should suppress duplicate alerts for the same IP within a 24-hour window', async () => {
      const baseTime = Date.now();
      let currentTime = baseTime;

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      // Scan 1 at t=0
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');
      const bans1 = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime
      });

      assert.strictEqual(bans1.length, 1);
      assert.strictEqual(alertCapture.count(), 1);

      // Advance time by 4 hours (within 24h window)
      currentTime += 4 * 60 * 60 * 1000;

      // Append same IP ban again
      await fsPromises.appendFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');
      const bans2 = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime
      });

      assert.strictEqual(bans2.length, 0, 'Duplicate ban within 24 hours must be suppressed');
      assert.strictEqual(alertCapture.count(), 1, 'No new alert should be enqueued');
    });

    it('should emit a new alert when the same IP is banned after the 24-hour window expires', async () => {
      const baseTime = Date.now();
      let currentTime = baseTime;

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();

      // Scan 1 at t=0
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');
      await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime
      });
      assert.strictEqual(alertCapture.count(), 1);

      // Advance time by 25 hours (past 24h window)
      currentTime += 25 * 60 * 60 * 1000;

      // Append same IP ban again
      await fsPromises.appendFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');
      const bansAfterExpiry = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime
      });

      assert.strictEqual(bansAfterExpiry.length, 1, 'Ban after 24h expiry must trigger new alert');
      assert.strictEqual(bansAfterExpiry[0].ip, '192.0.2.1');
      assert.strictEqual(alertCapture.count(), 2, 'Second alert must be emitted');
      assertNoEmojis(bansAfterExpiry);
    });

    it('should allow custom dedupTtlMs override', async () => {
      const baseTime = Date.now();
      let currentTime = baseTime;

      const state = createFail2banScanState();
      const alertCapture = new AlertCaptureMock();
      const shortTtl = 60 * 1000; // 1 minute

      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');
      await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime,
        dedupTtlMs: shortTtl
      });
      assert.strictEqual(alertCapture.count(), 1);

      // Advance by 65 seconds
      currentTime += 65 * 1000;
      await fsPromises.appendFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');

      const bans = await scanFail2banLog(testLogPath, state, {
        enqueueAlert: alertCapture.asNotifier(),
        now: () => currentTime,
        dedupTtlMs: shortTtl
      });

      assert.strictEqual(bans.length, 1, 'Custom TTL expired; alert should be emitted');
      assert.strictEqual(alertCapture.count(), 2);
    });
  });

  describe('Part 6: Zero-Emoji Alert Payload Formatting & alertQueueService Integration', () => {
    it('should format a structured zero-emoji alert payload', () => {
      const alert = formatFail2banAlert({
        ip: '198.51.100.42',
        jail: 'sshd',
        timestamp: '2026-10-28 14:23:01,123'
      });

      assert.strictEqual(alert.title, 'Bloqueo de seguridad Fail2ban: IP 198.51.100.42');
      assert.ok(alert.details.includes('198.51.100.42'));
      assert.ok(alert.details.includes('[sshd]'));
      assert.strictEqual(alert.priority, 'high');
      assert.strictEqual(alert.metadata.type, 'FAIL2BAN_BAN');
      assert.strictEqual(alert.metadata.ip, '198.51.100.42');
      assert.strictEqual(alert.metadata.jail, 'sshd');

      assertNoEmojis(alert, 'Alert payload must strictly contain zero emojis');
    });

    it('should persist alert to alertQueueService disk queue when using queuePath', async () => {
      await fsPromises.writeFile(testLogPath, FAIL2BAN_LOG_SAMPLES.singleBanIpv4 + '\n', 'utf8');

      const state = createFail2banScanState();

      await scanFail2banLog(testLogPath, state, {
        queuePath: testQueuePath
      });

      const queuedAlerts = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(queuedAlerts.length, 1);
      assert.strictEqual(queuedAlerts[0].title, 'Bloqueo de seguridad Fail2ban: IP 192.0.2.1');
      assert.strictEqual(queuedAlerts[0].priority, 'high');
      assertNoEmojis(queuedAlerts);
    });
  });
});
