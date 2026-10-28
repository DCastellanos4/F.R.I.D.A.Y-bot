import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  checkDiskUsage,
  purgeDisk,
  checkAndPurgeIfExceeded,
  cleanTempDownloads,
  formatBytes,
  parseDockerPruneReclaimedBytes,
  resolveMountPath,
  DEFAULT_STORAGE_THRESHOLD_PERCENT
} from '../../diskStorageService.js';
import { SysCommandMock } from './helpers/sysCommandMock.js';
import { AlertCaptureMock } from './helpers/alertCaptureMock.js';
import { assertNoEmojis } from './helpers/s2Validators.js';
import {
  createSyntheticStatfs,
  DISK_SCENARIOS,
  SYNTHETIC_PURGE_OUTPUTS
} from './fixtures/diskFixtures.js';

describe('Sector 2 - Task 13: Disk Storage Vigilante & Auto-Purge', () => {
  let sysMock;
  let alertMock;
  let tempTestDir;

  beforeEach(() => {
    sysMock = new SysCommandMock();
    alertMock = new AlertCaptureMock();
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-disk-test-'));
  });

  afterEach(() => {
    sysMock.reset();
    alertMock.clear();
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Part 1: Disk Inspection via Native statfsSync', () => {
    it('should compute metrics accurately from synthetic statfs object', () => {
      const mockStatfs = () => DISK_SCENARIOS.healthy60.statfs;

      const result = checkDiskUsage('/var', { statfsSync: mockStatfs });

      assert.strictEqual(typeof result.totalBytes, 'number');
      assert.strictEqual(typeof result.freeBytes, 'number');
      assert.strictEqual(typeof result.usedBytes, 'number');
      assert.strictEqual(typeof result.percentUsed, 'number');
      assert.strictEqual(Math.round(result.percentUsed), 60);
      assert.strictEqual(result.usedBytes + result.freeBytes, result.totalBytes);
      assertNoEmojis(result);
    });

    it('should calculate exact 85% boundary value correctly', () => {
      const mockStatfs = () => DISK_SCENARIOS.atThreshold85.statfs;

      const result = checkDiskUsage('/', { statfsSync: mockStatfs });

      assert.strictEqual(Math.round(result.percentUsed), 85);
      assertNoEmojis(result);
    });

    it('should calculate 88% over-threshold accurately', () => {
      const mockStatfs = () => DISK_SCENARIOS.overThreshold88.statfs;

      const result = checkDiskUsage('/', { statfsSync: mockStatfs });

      assert.strictEqual(Math.round(result.percentUsed), 88);
      assert.ok(result.percentUsed > 85);
      assertNoEmojis(result);
    });

    it('should inspect live filesystem without error (smoke test)', () => {
      const result = checkDiskUsage();

      assert.ok(result.totalBytes > 0);
      assert.ok(result.freeBytes >= 0);
      assert.ok(result.usedBytes >= 0);
      assert.ok(result.percentUsed >= 0 && result.percentUsed <= 100);
      assertNoEmojis(result);
    });

    it('should resolve mount path cleanly across platforms', () => {
      const resolved = resolveMountPath('/');
      assert.ok(typeof resolved === 'string');
      assert.ok(resolved.length > 0);
      assertNoEmojis(resolved);
    });
  });

  describe('Part 2: 4-Step Storage Purge Pipeline', () => {
    it('should execute pm2 flush, apt-get clean, docker prune, and temp cleanup in order', async () => {
      // Configure mock runner for steps 1-3
      sysMock.when('pm2 flush', {
        exitCode: 0,
        stdout: SYNTHETIC_PURGE_OUTPUTS.pm2Flush,
        stderr: ''
      });
      sysMock.when('apt-get clean', {
        exitCode: 0,
        stdout: SYNTHETIC_PURGE_OUTPUTS.aptClean,
        stderr: ''
      });
      sysMock.when('docker system prune -f', {
        exitCode: 0,
        stdout: SYNTHETIC_PURGE_OUTPUTS.dockerPrune,
        stderr: ''
      });

      // Populate real temp files for step 4
      const tempDownloadDir = path.join(tempTestDir, 'temp_downloads');
      fs.mkdirSync(tempDownloadDir, { recursive: true });
      fs.writeFileSync(path.join(tempDownloadDir, 'video1.mp4'), Buffer.alloc(1024 * 100)); // 100KB
      fs.writeFileSync(path.join(tempDownloadDir, 'audio1.mp3'), Buffer.alloc(1024 * 50)); // 50KB

      const purgeResult = await purgeDisk({
        runner: sysMock.asRunner(),
        tempDownloadsDir: tempDownloadDir
      });

      assert.strictEqual(purgeResult.steps.length, 4);

      // Step 1: pm2 flush
      assert.strictEqual(purgeResult.steps[0].step, 'pm2_flush');
      assert.strictEqual(purgeResult.steps[0].success, true);

      // Step 2: apt clean
      assert.strictEqual(purgeResult.steps[1].step, 'apt_clean');
      assert.strictEqual(purgeResult.steps[1].success, true);

      // Step 3: docker prune
      assert.strictEqual(purgeResult.steps[2].step, 'docker_prune');
      assert.strictEqual(purgeResult.steps[2].success, true);
      assert.ok(purgeResult.steps[2].reclaimedBytes > 1000000000); // > 1GB

      // Step 4: temp clean
      assert.strictEqual(purgeResult.steps[3].step, 'temp_clean');
      assert.strictEqual(purgeResult.steps[3].success, true);
      assert.strictEqual(purgeResult.steps[3].deletedCount, 2);
      assert.strictEqual(purgeResult.steps[3].reclaimedBytes, 1024 * 150);

      // Total reclaimed bytes includes docker prune (~1.842GB) + temp clean (150KB)
      assert.ok(purgeResult.reclaimedBytes > 1000000000);
      assert.strictEqual(purgeResult.details.length, 4);
      assertNoEmojis(purgeResult);

      // Verify temp files were deleted
      const remainingFiles = fs.readdirSync(tempDownloadDir);
      assert.strictEqual(remainingFiles.length, 0);
    });

    it('should continue purge pipeline even if pm2 or apt-get is missing or fails', async () => {
      sysMock.when('pm2 flush', {
        exitCode: 127,
        stdout: '',
        stderr: 'pm2: command not found'
      });
      sysMock.when('apt-get clean', {
        exitCode: 1,
        stdout: '',
        stderr: 'E: Could not open lock file'
      });
      sysMock.when('docker system prune -f', {
        exitCode: 0,
        stdout: 'Total reclaimed space: 500MB',
        stderr: ''
      });

      const purgeResult = await purgeDisk({
        runner: sysMock.asRunner(),
        tempDownloadsDir: path.join(tempTestDir, 'empty_dir')
      });

      assert.strictEqual(purgeResult.steps.length, 4);
      assert.strictEqual(purgeResult.steps[0].success, false);
      assert.strictEqual(purgeResult.steps[1].success, false);
      assert.strictEqual(purgeResult.steps[2].success, true);
      assert.strictEqual(purgeResult.steps[3].success, true);
      assert.ok(purgeResult.reclaimedBytes > 0);
      assertNoEmojis(purgeResult);
    });
  });

  describe('Part 3: Boundary Value Analysis (BVA) for Threshold Purge', () => {
    it('BVA 1: Normal storage usage (60%) must NOT trigger purge', async () => {
      const mockStatfs = () => DISK_SCENARIOS.healthy60.statfs;

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: mockStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, false);
      assert.strictEqual(report.isStillCritical, false);
      assert.strictEqual(report.alertDispatched, false);
      assert.strictEqual(report.reclaimedBytes, 0);
      assert.strictEqual(sysMock.getCallCount(), 0);
      alertMock.assertNoAlertEmitted();
      assertNoEmojis(report);
    });

    it('BVA 2: Near boundary (84%) must NOT trigger purge', async () => {
      const mockStatfs = () => DISK_SCENARIOS.nearThreshold84.statfs;

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: mockStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, false);
      assert.strictEqual(report.isStillCritical, false);
      assert.strictEqual(report.alertDispatched, false);
      assert.strictEqual(sysMock.getCallCount(), 0);
      alertMock.assertNoAlertEmitted();
      assertNoEmojis(report);
    });

    it('BVA 3: Exact threshold boundary (85%) must NOT trigger purge (strictly exceeds)', async () => {
      const mockStatfs = () => DISK_SCENARIOS.atThreshold85.statfs;

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: mockStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, false);
      assert.strictEqual(report.isStillCritical, false);
      assert.strictEqual(report.alertDispatched, false);
      assert.strictEqual(sysMock.getCallCount(), 0);
      alertMock.assertNoAlertEmitted();
      assertNoEmojis(report);
    });

    it('BVA 4: Over threshold (88%) MUST trigger 4-step purge pipeline', async () => {
      let statfsCallCount = 0;
      // First call (before): 88%
      // Second call (after): 80%
      const dynamicStatfs = () => {
        statfsCallCount++;
        return statfsCallCount === 1
          ? DISK_SCENARIOS.overThreshold88.statfs
          : DISK_SCENARIOS.postPurgeSuccess80.statfs;
      };

      sysMock.when('pm2 flush', { exitCode: 0, stdout: 'Logs flushed' });
      sysMock.when('apt-get clean', { exitCode: 0, stdout: '' });
      sysMock.when('docker system prune -f', { exitCode: 0, stdout: 'Total reclaimed space: 1.5GB' });

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: dynamicStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, true);
      assert.strictEqual(report.isStillCritical, false);
      assert.strictEqual(report.alertDispatched, true);
      assert.ok(report.reclaimedBytes > 0);

      // Verify all 3 CLI commands were invoked
      assert.strictEqual(sysMock.getCallCount('pm2 flush'), 1);
      assert.strictEqual(sysMock.getCallCount('apt-get clean'), 1);
      assert.strictEqual(sysMock.getCallCount('docker system prune -f'), 1);

      // Verify recovery alert was emitted
      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/Purga automatica de almacenamiento completada/);
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'high');
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });
  });

  describe('Part 4: Post-Purge Evaluation & Escalation', () => {
    it('Scenario A: Post-purge recovers below threshold (88% -> 80%) emits high notification', async () => {
      let callCount = 0;
      const dynamicStatfs = () => {
        callCount++;
        return callCount === 1
          ? DISK_SCENARIOS.overThreshold88.statfs
          : DISK_SCENARIOS.postPurgeSuccess80.statfs;
      };

      sysMock.when('pm2 flush', { exitCode: 0, stdout: '' });
      sysMock.when('apt-get clean', { exitCode: 0, stdout: '' });
      sysMock.when('docker system prune -f', { exitCode: 0, stdout: 'Total reclaimed space: 1.842GB' });

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: dynamicStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, true);
      assert.strictEqual(report.isStillCritical, false);
      assert.strictEqual(Math.round(report.initialUsage.percentUsed), 88);
      assert.strictEqual(Math.round(report.postUsage.percentUsed), 80);

      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'high');
      assert.ok(alert.details.includes('88.0%'));
      assert.ok(alert.details.includes('80.0%'));
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });

    it('Scenario B: Post-purge remains > 85% (95% -> 87%) escalates to CRITICAL storage alert', async () => {
      let callCount = 0;
      const dynamicStatfs = () => {
        callCount++;
        return callCount === 1
          ? DISK_SCENARIOS.critical95.statfs
          : DISK_SCENARIOS.postPurgeStillOver87.statfs;
      };

      sysMock.when('pm2 flush', { exitCode: 0, stdout: '' });
      sysMock.when('apt-get clean', { exitCode: 0, stdout: '' });
      sysMock.when('docker system prune -f', { exitCode: 0, stdout: 'Total reclaimed space: 800MB' });

      const report = await checkAndPurgeIfExceeded(85, {
        statfsSync: dynamicStatfs,
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.triggered, true);
      assert.strictEqual(report.isStillCritical, true);
      assert.strictEqual(Math.round(report.initialUsage.percentUsed), 95);
      assert.strictEqual(Math.round(report.postUsage.percentUsed), 87);

      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/ALERTA CRITICA: Espacio insuficiente tras purga/);
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'urgent');
      assert.ok(alert.details.includes('intervencion manual urgente'));
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });
  });

  describe('Part 5: Local Temp Downloads Cleanup', () => {
    it('should delete multiple files and accurately sum reclaimed bytes and deleted count', () => {
      const downloadDir = path.join(tempTestDir, 'downloads_batch');
      fs.mkdirSync(downloadDir, { recursive: true });

      const fileA = path.join(downloadDir, 'clip_1.mp4');
      const fileB = path.join(downloadDir, 'clip_2.mp4');
      const fileC = path.join(downloadDir, 'sample.mp3');

      fs.writeFileSync(fileA, Buffer.alloc(50000));
      fs.writeFileSync(fileB, Buffer.alloc(30000));
      fs.writeFileSync(fileC, Buffer.alloc(20000));

      const cleanResult = cleanTempDownloads(downloadDir);

      assert.strictEqual(cleanResult.deletedCount, 3);
      assert.strictEqual(cleanResult.reclaimedBytes, 100000);
      assert.strictEqual(fs.readdirSync(downloadDir).length, 0);
      assertNoEmojis(cleanResult);
    });

    it('should handle non-existent directory safely without throwing error', () => {
      const nonExistent = path.join(tempTestDir, 'does_not_exist_xyz');
      const cleanResult = cleanTempDownloads(nonExistent);

      assert.strictEqual(cleanResult.deletedCount, 0);
      assert.strictEqual(cleanResult.reclaimedBytes, 0);
      assertNoEmojis(cleanResult);
    });
  });

  describe('Part 6: Utility Functions & Parsing', () => {
    it('should format bytes with units and 0 emojis', () => {
      assert.strictEqual(formatBytes(0), '0 B');
      assert.strictEqual(formatBytes(512), '512.00 B');
      assert.strictEqual(formatBytes(1024), '1.00 KB');
      assert.strictEqual(formatBytes(1048576), '1.00 MB');
      assert.strictEqual(formatBytes(1073741824), '1.00 GB');
      assert.strictEqual(formatBytes(1977804062), '1.84 GB');
      assertNoEmojis(formatBytes(1977804062));
    });

    it('should parse docker system prune reclaimed bytes accurately', () => {
      assert.strictEqual(
        parseDockerPruneReclaimedBytes('Total reclaimed space: 1.842GB'),
        Math.round(1.842 * 1024 * 1024 * 1024)
      );
      assert.strictEqual(
        parseDockerPruneReclaimedBytes('Total reclaimed space: 500MB'),
        500 * 1024 * 1024
      );
      assert.strictEqual(
        parseDockerPruneReclaimedBytes('Total reclaimed space: 100KB'),
        100 * 1024
      );
      assert.strictEqual(
        parseDockerPruneReclaimedBytes('Total reclaimed space: 0B'),
        0
      );
      assert.strictEqual(parseDockerPruneReclaimedBytes(''), 0);
      assert.strictEqual(parseDockerPruneReclaimedBytes(null), 0);
    });
  });
});
