import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCertificateExpiry,
  formatSslExpiryAlert,
  checkAndAlertExpiry,
  batchCheckCertificates
} from '../../sslMonitorService.js';
import { SSL_SCENARIOS, BATCH_TEST_DOMAINS } from './fixtures/sslFixtures.js';
import { createMockTlsConnect, createSyntheticPeerCertificate } from './helpers/tlsMock.js';
import { createAlertCaptureMock } from './helpers/alertCaptureMock.js';
import { assertNoEmojis } from './helpers/s2Validators.js';

describe('Sector 2 - Task 17: Proactive SSL Certificate Expiry Verifier', () => {
  let alertMock;

  beforeEach(() => {
    alertMock = createAlertCaptureMock();
  });

  afterEach(() => {
    alertMock.clear();
  });

  describe('Part 1: Certificate Inspection and Days Calculation', () => {
    it('should correctly evaluate a healthy certificate (75 days remaining)', async () => {
      const scenario = SSL_SCENARIOS.healthy;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const result = await checkCertificateExpiry(scenario.host, 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.host, scenario.host);
      assert.strictEqual(result.port, 443);
      assert.strictEqual(result.daysRemaining, 75);
      assert.strictEqual(result.isExpiringSoon, false);
      assert.strictEqual(result.isExpired, false);
      assert.ok(result.validTo);
      assert.strictEqual(result.issuer, "Let's Encrypt");
      assertNoEmojis(result);
    });

    it('should flag warning alert when certificate has 10 days remaining (< 15 threshold)', async () => {
      const scenario = SSL_SCENARIOS.expiringSoon10Days;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const result = await checkCertificateExpiry(scenario.host, 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.host, scenario.host);
      assert.strictEqual(result.daysRemaining, 10);
      assert.strictEqual(result.isExpiringSoon, true);
      assert.strictEqual(result.isExpired, false);
      assertNoEmojis(result);
    });

    it('should flag critical warning when certificate has 3 days remaining', async () => {
      const scenario = SSL_SCENARIOS.critical3Days;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const result = await checkCertificateExpiry(scenario.host, 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.host, scenario.host);
      assert.strictEqual(result.daysRemaining, 3);
      assert.strictEqual(result.isExpiringSoon, true);
      assert.strictEqual(result.isExpired, false);
      assert.strictEqual(result.issuer, 'DigiCert Global Root G2');
      assertNoEmojis(result);
    });

    it('should identify expired certificates (negative days remaining)', async () => {
      const scenario = SSL_SCENARIOS.expiredNegative5Days;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const result = await checkCertificateExpiry(scenario.host, 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.host, scenario.host);
      assert.strictEqual(result.daysRemaining, -5);
      assert.strictEqual(result.isExpiringSoon, true);
      assert.strictEqual(result.isExpired, true);
      assertNoEmojis(result);
    });

    it('should inspect wildcard certificates correctly', async () => {
      const scenario = SSL_SCENARIOS.wildcardCert;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const result = await checkCertificateExpiry('*.davidcastellanos.dev', 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.daysRemaining, 45);
      assert.strictEqual(result.isExpiringSoon, false);
      assert.strictEqual(result.isExpired, false);
      assert.strictEqual(result.issuer, 'Cloudflare Inc ECC CA-3');
      assertNoEmojis(result);
    });
  });

  describe('Part 2: Boundary Value Analysis (BVA Thresholds)', () => {
    it('should evaluate 14 days remaining as expiring soon (below 15d boundary)', async () => {
      const cert14d = createSyntheticPeerCertificate({ host: 'boundary-14d.dev', daysRemaining: 14 });
      const mockConnect = createMockTlsConnect(cert14d);

      const result = await checkCertificateExpiry('boundary-14d.dev', 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.daysRemaining, 14);
      assert.strictEqual(result.isExpiringSoon, true);
      assert.strictEqual(result.isExpired, false);
      assertNoEmojis(result);
    });

    it('should evaluate 16 days remaining as healthy (above 15d boundary)', async () => {
      const cert16d = createSyntheticPeerCertificate({ host: 'boundary-16d.dev', daysRemaining: 16 });
      const mockConnect = createMockTlsConnect(cert16d);

      const result = await checkCertificateExpiry('boundary-16d.dev', 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.daysRemaining, 16);
      assert.strictEqual(result.isExpiringSoon, false);
      assert.strictEqual(result.isExpired, false);
      assertNoEmojis(result);
    });

    it('should evaluate exactly 0 days remaining as expired', async () => {
      const cert0d = createSyntheticPeerCertificate({ host: 'boundary-0d.dev', daysRemaining: 0 });
      const mockConnect = createMockTlsConnect(cert0d);

      const result = await checkCertificateExpiry('boundary-0d.dev', 443, {}, { tlsConnect: mockConnect });

      assert.strictEqual(result.daysRemaining, 0);
      assert.strictEqual(result.isExpiringSoon, true);
      assert.strictEqual(result.isExpired, true);
      assertNoEmojis(result);
    });

    it('should accept custom thresholdDays option', async () => {
      const cert25d = createSyntheticPeerCertificate({ host: 'custom-threshold.dev', daysRemaining: 25 });
      const mockConnect = createMockTlsConnect(cert25d);

      // Default threshold (15d) -> healthy
      const resDefault = await checkCertificateExpiry('custom-threshold.dev', 443, {}, { tlsConnect: mockConnect });
      assert.strictEqual(resDefault.isExpiringSoon, false);

      // Custom threshold (30d) -> expiring soon
      const resCustom = await checkCertificateExpiry(
        'custom-threshold.dev',
        443,
        { thresholdDays: 30 },
        { tlsConnect: mockConnect }
      );
      assert.strictEqual(resCustom.isExpiringSoon, true);
    });
  });

  describe('Part 3: Proactive Alerting and AlertQueue Integration', () => {
    it('should format clean zero-emoji SSL alert message', () => {
      const certInfo = {
        host: 'api.davidcastellanos.dev',
        daysRemaining: 10,
        validTo: 'Thu, 07 Nov 2026 12:00:00 GMT',
        issuer: "Let's Encrypt",
        isExpired: false
      };

      const { alertText, priority, title } = formatSslExpiryAlert(certInfo);

      assert.strictEqual(priority, 'high');
      assert.ok(title.includes('api.davidcastellanos.dev'));
      assert.ok(alertText.includes('api.davidcastellanos.dev'));
      assert.ok(alertText.includes('10'));
      assert.ok(alertText.includes("Let's Encrypt"));
      assert.ok(alertText.includes('PROXIMO_A_EXPIRAR'));

      assertNoEmojis(alertText);
      assertNoEmojis(title);
    });

    it('should enqueue alert when certificate is expiring soon (<15d)', async () => {
      const scenario = SSL_SCENARIOS.expiringSoon10Days;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const outcome = await checkAndAlertExpiry(
        scenario.host,
        443,
        {},
        {
          tlsConnect: mockConnect,
          enqueueAlert: (alert) => alertMock.capture(alert)
        }
      );

      assert.strictEqual(outcome.alertEnqueued, true);
      assert.strictEqual(alertMock.count(), 1);

      const captured = alertMock.getLastAlert();
      assert.strictEqual(captured.priority, 'high');
      assert.ok(captured.text.includes(scenario.host));
      assert.ok(captured.text.includes('10'));

      assertNoEmojis(outcome);
      assertNoEmojis(captured);
    });

    it('should NOT enqueue alert when certificate is healthy (>15d)', async () => {
      const scenario = SSL_SCENARIOS.healthy;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const outcome = await checkAndAlertExpiry(
        scenario.host,
        443,
        {},
        {
          tlsConnect: mockConnect,
          enqueueAlert: (alert) => alertMock.capture(alert)
        }
      );

      assert.strictEqual(outcome.alertEnqueued, false);
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(outcome);
    });

    it('should enqueue urgent alert when certificate is already expired', async () => {
      const scenario = SSL_SCENARIOS.expiredNegative5Days;
      const mockConnect = createMockTlsConnect(scenario.cert);

      const outcome = await checkAndAlertExpiry(
        scenario.host,
        443,
        {},
        {
          tlsConnect: mockConnect,
          enqueueAlert: (alert) => alertMock.capture(alert)
        }
      );

      assert.strictEqual(outcome.alertEnqueued, true);
      assert.strictEqual(alertMock.count(), 1);

      const captured = alertMock.getLastAlert();
      assert.strictEqual(captured.priority, 'urgent');
      assert.ok(captured.text.includes('EXPIRADO'));
      assertNoEmojis(captured);
    });
  });

  describe('Part 4: Batch Checking and Error Resilience', () => {
    it('should batch check multiple domains in parallel', async () => {
      const certMap = {
        'vps.davidcastellanos.dev': SSL_SCENARIOS.healthy.cert,
        'api.davidcastellanos.dev': SSL_SCENARIOS.expiringSoon10Days.cert,
        'auth.davidcastellanos.dev': SSL_SCENARIOS.critical3Days.cert,
        'old-service.davidcastellanos.dev': SSL_SCENARIOS.expiredNegative5Days.cert
      };

      const mockConnect = createMockTlsConnect((options) => {
        const h = options.host || options.servername;
        return certMap[h] || createSyntheticPeerCertificate({ host: h });
      });

      const results = await batchCheckCertificates(BATCH_TEST_DOMAINS, {}, { tlsConnect: mockConnect });

      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].daysRemaining, 75);
      assert.strictEqual(results[0].isExpiringSoon, false);

      assert.strictEqual(results[1].daysRemaining, 10);
      assert.strictEqual(results[1].isExpiringSoon, true);

      assert.strictEqual(results[2].daysRemaining, 3);
      assert.strictEqual(results[2].isExpiringSoon, true);

      assert.strictEqual(results[3].daysRemaining, -5);
      assert.strictEqual(results[3].isExpired, true);

      assertNoEmojis(results);
    });

    it('should reject when connection times out', async () => {
      const mockConnect = createMockTlsConnect({ simulateTimeout: true });

      await assert.rejects(
        async () => {
          await checkCertificateExpiry('timeout.dev', 443, { timeoutMs: 50 }, { tlsConnect: mockConnect });
        },
        {
          message: /timed out/i
        }
      );
    });

    it('should reject when TLS connection emits socket error', async () => {
      const mockConnect = createMockTlsConnect({ simulateError: new Error('ECONNREFUSED: connection refused') });

      await assert.rejects(
        async () => {
          await checkCertificateExpiry('unreachable.dev', 443, {}, { tlsConnect: mockConnect });
        },
        {
          message: /ECONNREFUSED/
        }
      );
    });

    it('should reject when empty certificate is returned', async () => {
      const mockConnect = createMockTlsConnect({});

      await assert.rejects(
        async () => {
          await checkCertificateExpiry('no-cert.dev', 443, {}, { tlsConnect: mockConnect });
        },
        {
          message: /No peer certificate found/
        }
      );
    });

    it('should throw TypeError when host argument is invalid', async () => {
      await assert.rejects(
        async () => {
          await checkCertificateExpiry('');
        },
        {
          name: 'TypeError',
          message: /Target host must be a non-empty string/
        }
      );
    });
  });
});
