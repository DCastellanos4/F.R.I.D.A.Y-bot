import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import {
  hasNoEmojis,
  assertNoEmojis,
  isValidDavbakContainer,
  assertValidDavbak,
  isValidOtpCode,
  assertValidOtpCode,
  calculateShannonEntropy,
  assertPasswordQuality,
  assertValidHmacSignature,
  assertValidHexKey,
  assertValidUuid,
  DAVBAK_MAGIC
} from './s2Validators.js';

import {
  SysCommandMock,
  createSysCommandMock
} from './sysCommandMock.js';

import {
  createSyntheticPeerCertificate,
  MockTlsSocket,
  createMockTlsConnect
} from './tlsMock.js';

import {
  formatProcNetDev,
  ProcNetDevTimeline
} from './procNetDevMock.js';

import {
  AlertCaptureMock,
  createAlertCaptureMock
} from './alertCaptureMock.js';

import {
  DOCKER_PS_MIXED_OUTPUT,
  SYNTHETIC_CONTAINERS
} from '../fixtures/dockerFixtures.js';

import {
  BASH_COMMAND_SETS,
  SYNTHETIC_TERMINAL_OUTPUTS
} from '../fixtures/bashFixtures.js';

import {
  DISK_SCENARIOS,
  createSyntheticStatfs
} from '../fixtures/diskFixtures.js';

import {
  FAIL2BAN_LOG_SAMPLES
} from '../fixtures/fail2banFixtures.js';

import {
  GITHUB_PAYLOADS,
  TEST_WEBHOOK_SECRET,
  createValidSignatureHeader,
  createWebhookRequestEnvelope
} from '../fixtures/githubWebhookFixtures.js';

import {
  TEST_BACKUP_PASSPHRASE,
  createSyntheticBackupContainer,
  createTamperedCiphertextContainer,
  createInvalidMagicContainer,
  createTruncatedContainer,
  deriveKey
} from '../fixtures/backupFixtures.js';

import {
  SSL_SCENARIOS
} from '../fixtures/sslFixtures.js';

import {
  NETWORK_SNAPSHOT_PAIRS
} from '../fixtures/networkFixtures.js';

import {
  CLOUDFLARE_TUNNEL_OUTPUTS,
  TAILSCALE_JSON_OUTPUTS
} from '../fixtures/tunnelFixtures.js';

import {
  createMockSecondBrainMemory
} from '../fixtures/cryptoFixtures.js';

describe('Sector 2 Test Infrastructure: Helpers and Fixtures Verification', () => {

  describe('s2Validators Helper', () => {
    it('hasNoEmojis returns true for pure ASCII and standard text', () => {
      const cleanString = 'Command execution successful: exit code 0';
      const result = hasNoEmojis(cleanString);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.violations.length, 0);
      assert.doesNotThrow(() => assertNoEmojis(cleanString));
    });

    it('hasNoEmojis detects emoji characters in strings and objects', () => {
      // Test with emoji character without literal embedding in code
      const emojiChar = String.fromCodePoint(0x1F680); // Rocket
      const contaminatedString = `Process started ${emojiChar}`;
      const result = hasNoEmojis(contaminatedString);
      assert.strictEqual(result.valid, false);
      assert.ok(result.violations.length > 0);
      assert.throws(() => assertNoEmojis(contaminatedString), /Zero-emoji validation failed/);
    });

    it('assertValidDavbak validates genuine container and rejects corrupted headers', () => {
      const validContainer = createSyntheticBackupContainer();
      assert.doesNotThrow(() => assertValidDavbak(validContainer));

      const truncated = createTruncatedContainer();
      const checkTruncated = isValidDavbakContainer(truncated);
      assert.strictEqual(checkTruncated.valid, false);

      const invalidMagic = createInvalidMagicContainer();
      const checkMagic = isValidDavbakContainer(invalidMagic);
      assert.strictEqual(checkMagic.valid, false);
      assert.ok(checkMagic.reason.includes('Invalid magic header'));
    });

    it('assertValidOtpCode validates 6-digit numeric codes and rejects invalid strings', () => {
      assert.strictEqual(isValidOtpCode('123456', 6), true);
      assert.strictEqual(isValidOtpCode('000123', 6), true);
      assert.strictEqual(isValidOtpCode('12345', 6), false);
      assert.strictEqual(isValidOtpCode('1234567', 6), false);
      assert.strictEqual(isValidOtpCode('123a56', 6), false);
      assert.doesNotThrow(() => assertValidOtpCode('987654', 6));
    });

    it('assertPasswordQuality calculates entropy and enforces diversity requirements', () => {
      const strongPassword = 'K9#mQ!2xL$8vP@1wZ%4n';
      assert.doesNotThrow(() => assertPasswordQuality(strongPassword, 80));

      const weakPassword = 'password123';
      assert.throws(() => assertPasswordQuality(weakPassword, 120));
    });

    it('assertValidHmacSignature validates correct HMAC and rejects tampered header', () => {
      const rawPayload = Buffer.from(JSON.stringify({ event: 'test' }), 'utf8');
      const validHeader = createValidSignatureHeader(rawPayload, TEST_WEBHOOK_SECRET);
      assert.doesNotThrow(() => assertValidHmacSignature(rawPayload, validHeader, TEST_WEBHOOK_SECRET));

      const tamperedHeader = validHeader.slice(0, -1) + (validHeader.endsWith('0') ? '1' : '0');
      assert.throws(() => assertValidHmacSignature(rawPayload, tamperedHeader, TEST_WEBHOOK_SECRET));
    });

    it('assertValidHexKey and assertValidUuid validate correct formats', () => {
      const hex256 = crypto.randomBytes(32).toString('hex');
      assert.doesNotThrow(() => assertValidHexKey(hex256, 256));
      assert.throws(() => assertValidHexKey(hex256.slice(0, 30), 256));

      const uuid = crypto.randomUUID();
      assert.doesNotThrow(() => assertValidUuid(uuid));
      assert.throws(() => assertValidUuid('not-a-uuid'));
    });
  });

  describe('SysCommandMock Helper', () => {
    it('matches exact commands, substrings, and regexes', async () => {
      const mock = createSysCommandMock();

      mock.when('docker ps', {
        exitCode: 0,
        stdout: DOCKER_PS_MIXED_OUTPUT
      });

      mock.when(/^pm2 restart/, {
        exitCode: 0,
        stdout: 'Process jarvis-api restarted'
      });

      mock.setDefault({
        exitCode: 127,
        stderr: 'command not found'
      });

      const resDocker = await mock.runCommand('docker ps', ['-a', '--format', '{{json .}}']);
      assert.strictEqual(resDocker.ok, true);
      assert.strictEqual(resDocker.exitCode, 0);
      assert.strictEqual(resDocker.stdout, DOCKER_PS_MIXED_OUTPUT);

      const resPm2 = await mock.runCommand('pm2 restart', ['jarvis-api']);
      assert.strictEqual(resPm2.ok, true);
      assert.strictEqual(resPm2.stdout, 'Process jarvis-api restarted');

      const resUnknown = await mock.runCommand('nonexistent-binary');
      assert.strictEqual(resUnknown.ok, false);
      assert.strictEqual(resUnknown.exitCode, 127);
    });

    it('records call history, counts, and arguments accurately', async () => {
      const mock = createSysCommandMock();
      await mock.runCommand('df', ['-Pk', '/']);
      await mock.runCommand('pm2', ['flush']);

      assert.strictEqual(mock.getCallCount(), 2);
      assert.strictEqual(mock.getCallCount('df'), 1);
      assert.strictEqual(mock.getCallCount('pm2'), 1);

      const lastCall = mock.getLastCall();
      assert.strictEqual(lastCall.command, 'pm2');
      assert.deepStrictEqual(lastCall.args, ['flush']);
    });
  });

  describe('TlsMock Helper', () => {
    it('createSyntheticPeerCertificate generates compliant certificate properties', () => {
      const cert = createSyntheticPeerCertificate({
        host: 'api.davidcastellanos.dev',
        daysRemaining: 12,
        issuer: "Let's Encrypt"
      });

      assert.strictEqual(cert.subject.CN, 'api.davidcastellanos.dev');
      assert.strictEqual(cert.issuer.O, "Let's Encrypt");
      assert.ok(cert.valid_to);
      assert.ok(cert.fingerprint256);

      const remainingDays = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000);
      assert.ok(remainingDays >= 11 && remainingDays <= 13);
    });

    it('MockTlsSocket emits secureConnect and returns configured cert', async () => {
      const syntheticCert = createSyntheticPeerCertificate({ host: 'test.dev', daysRemaining: 30 });
      const socket = new MockTlsSocket({ cert: syntheticCert, connectDelayMs: 2 });

      await new Promise((resolve) => {
        socket.once('secureConnect', () => {
          const peer = socket.getPeerCertificate();
          assert.strictEqual(peer.subject.CN, 'test.dev');
          resolve();
        });
      });
    });
  });

  describe('ProcNetDevMock Helper', () => {
    it('formatProcNetDev formats valid Linux kernel table', () => {
      const raw = formatProcNetDev([
        { name: 'eth0', rxBytes: 1000000, txBytes: 500000 }
      ]);

      assert.ok(raw.includes('Inter-|   Receive'));
      assert.ok(raw.includes('eth0:'));
      assert.ok(raw.includes('1000000'));
    });

    it('ProcNetDevTimeline advances time and accumulates throughput accurately', () => {
      const timeline = new ProcNetDevTimeline([
        { name: 'eth0', rxBytes: 10000000, txBytes: 10000000 }
      ]);

      // Simulate 10 seconds of 15 MB/s outbound transfer
      const snapshot = timeline.simulateTrafficRate(10, 'eth0', 0, 15.0);
      assert.ok(snapshot.includes('eth0:'));
      // 10M + (15M * 10) = 160M bytes
      assert.ok(snapshot.includes('160000000'));
    });
  });

  describe('AlertCaptureMock Helper', () => {
    it('captures text and object alerts and validates zero emojis', () => {
      const alertMock = createAlertCaptureMock();
      alertMock.capture('[DOCKER HEALING] Container restarted successfully');
      alertMock.capture({
        title: 'CI_FAILURE',
        text: 'Build failed in repo davidcastellanos/jarvis',
        priority: 'HIGH'
      });

      assert.strictEqual(alertMock.count(), 2);
      assert.doesNotThrow(() => alertMock.assertAlertEmitted('Container restarted'));
      assert.doesNotThrow(() => alertMock.assertAlertEmitted('Build failed'));
      assert.throws(() => alertMock.assertNoAlertEmitted());

      alertMock.clear();
      assert.strictEqual(alertMock.count(), 0);
      assert.doesNotThrow(() => alertMock.assertNoAlertEmitted());
    });
  });

  describe('Sector 2 Fixtures Integrity Verification', () => {
    it('Docker fixtures provide parseable multi-container JSON lines', () => {
      const lines = DOCKER_PS_MIXED_OUTPUT.trim().split('\n');
      assert.strictEqual(lines.length, 5);

      const parsed = lines.map(l => JSON.parse(l));
      const states = parsed.map(c => c.State);
      assert.ok(states.includes('running'));
      assert.ok(states.includes('exited'));
      assert.ok(states.includes('restarting'));
    });

    it('Bash fixtures contain categorized command sets and terminal outputs', () => {
      assert.ok(BASH_COMMAND_SETS.safe.length >= 10);
      assert.ok(BASH_COMMAND_SETS.critical.length >= 10);
      assert.ok(BASH_COMMAND_SETS.forbidden.length >= 5);
      assert.ok(SYNTHETIC_TERMINAL_OUTPUTS.uptime.includes('load average'));
    });

    it('Disk fixtures provide accurate statfs blocks calculations', () => {
      const statfs88 = DISK_SCENARIOS.overThreshold88.statfs;
      const totalBytes = statfs88.blocks * statfs88.bsize;
      const freeBytes = statfs88.bavail * statfs88.bsize;
      const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
      assert.strictEqual(usedPercent, 88);
    });

    it('Fail2ban fixtures match standard log format', () => {
      const log = FAIL2BAN_LOG_SAMPLES.standardLog;
      assert.ok(log.includes('[sshd] Ban 198.51.100.42'));
      assert.ok(log.includes('[sshd] Ban 2001:db8:85a3::8a2e:370:7334'));
    });

    it('GitHub webhook fixtures build signed envelopes verified by HMAC', () => {
      const envelope = createWebhookRequestEnvelope(GITHUB_PAYLOADS.workflowFailed, 'workflow_run');
      assert.strictEqual(envelope.headers['x-github-event'], 'workflow_run');
      assert.doesNotThrow(() => {
        assertValidHmacSignature(envelope.rawBody, envelope.headers['x-hub-signature-256'], TEST_WEBHOOK_SECRET);
      });
    });

    it('Backup fixtures create genuine DAVBAK01 containers that decrypt and unpack correctly', () => {
      const container = createSyntheticBackupContainer({ passphrase: TEST_BACKUP_PASSPHRASE });
      assert.strictEqual(container.subarray(0, 8).equals(DAVBAK_MAGIC), true);

      // Decrypt container directly using AES-256-GCM
      const salt = container.subarray(8, 24);
      const iv = container.subarray(24, 36);
      const authTag = container.subarray(36, 52);
      const ciphertext = container.subarray(52);

      const key = deriveKey(TEST_BACKUP_PASSPHRASE, salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decryptedGzip = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const unpackedJson = zlib.gunzipSync(decryptedGzip).toString('utf8');
      const manifest = JSON.parse(unpackedJson);

      assert.strictEqual(manifest.version, '1.0');
      assert.ok(manifest.files.length >= 3);

      // Tampered container must throw on authentication tag check
      const tampered = createTamperedCiphertextContainer();
      const tamperedTag = tampered.subarray(36, 52);
      const tamperedCiphertext = tampered.subarray(52);
      const decipherTampered = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipherTampered.setAuthTag(tamperedTag);
      assert.throws(() => {
        Buffer.concat([decipherTampered.update(tamperedCiphertext), decipherTampered.final()]);
      });
    });

    it('SSL fixtures scenario metadata aligns with expiry flags', () => {
      assert.strictEqual(SSL_SCENARIOS.healthy.expected.isExpiringSoon, false);
      assert.strictEqual(SSL_SCENARIOS.expiringSoon10Days.expected.isExpiringSoon, true);
      assert.strictEqual(SSL_SCENARIOS.expiredNegative5Days.expected.isExpired, true);
    });

    it('Network fixtures define expected rates and spike flags', () => {
      const txSpike = NETWORK_SNAPSHOT_PAIRS.txSpike18MBps;
      assert.strictEqual(txSpike.expected.isTxSpike, true);
      assert.strictEqual(txSpike.expected.isRxSpike, false);

      const rxSpike = NETWORK_SNAPSHOT_PAIRS.rxSpike25MBps;
      assert.strictEqual(rxSpike.expected.isRxSpike, true);
      assert.strictEqual(rxSpike.expected.isTxSpike, false);
    });

    it('Tunnel fixtures provide valid cloudflared status and JSON Tailscale structures', () => {
      assert.ok(CLOUDFLARE_TUNNEL_OUTPUTS.runningHealthy.includes('STATUS: HEALTHY'));
      const tailscaleParsed = JSON.parse(TAILSCALE_JSON_OUTPUTS.running);
      assert.strictEqual(tailscaleParsed.BackendState, 'Running');
      assert.strictEqual(tailscaleParsed.Self.Online, true);
    });

    it('Crypto fixtures provide Second Brain mock memory recording', async () => {
      const memory = createMockSecondBrainMemory();
      await memory.guardarMemoria({
        sujeto: 'database',
        dato: 'secretPass987',
        categoria: 'clave'
      });

      const creds = memory.getSavedCredentials();
      assert.strictEqual(creds.length, 1);
      assert.strictEqual(creds[0].sujeto, 'database');
      assert.strictEqual(creds[0].categoria, 'clave');
    });
  });
});
