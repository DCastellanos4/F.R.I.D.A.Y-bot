import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  verifySignature,
  formatWorkflowFailureAlert,
  handleWebhookPayload,
  processWebhookRequest
} from '../../githubWebhookService.js';
import {
  GITHUB_PAYLOADS,
  TEST_WEBHOOK_SECRET,
  createValidSignatureHeader,
  createInvalidSignatureHeader,
  createWebhookRequestEnvelope
} from './fixtures/githubWebhookFixtures.js';
import { assertNoEmojis } from './helpers/s2Validators.js';
import { createAlertCaptureMock } from './helpers/alertCaptureMock.js';

describe('Sector 2 - Task 15: GitHub Actions Webhook & CI/CD Telemetry', () => {
  let alertMock;

  beforeEach(() => {
    alertMock = createAlertCaptureMock();
  });

  afterEach(() => {
    alertMock.clear();
  });

  describe('Part 1: Timing-Safe HMAC-SHA256 Signature Verification', () => {
    it('should verify valid HMAC-SHA256 signature for Buffer payload', () => {
      const payloadBuf = Buffer.from(JSON.stringify(GITHUB_PAYLOADS.workflowFailed), 'utf8');
      const signatureHeader = createValidSignatureHeader(payloadBuf, TEST_WEBHOOK_SECRET);

      const isValid = verifySignature(payloadBuf, signatureHeader, TEST_WEBHOOK_SECRET);
      assert.strictEqual(isValid, true);
    });

    it('should verify valid HMAC-SHA256 signature for string payload', () => {
      const payloadStr = JSON.stringify(GITHUB_PAYLOADS.workflowSucceeded);
      const signatureHeader = createValidSignatureHeader(payloadStr, TEST_WEBHOOK_SECRET);

      const isValid = verifySignature(payloadStr, signatureHeader, TEST_WEBHOOK_SECRET);
      assert.strictEqual(isValid, true);
    });

    it('should reject tampered signature with bit-flipped digest', () => {
      const payloadBuf = Buffer.from(JSON.stringify(GITHUB_PAYLOADS.workflowFailed), 'utf8');
      const tamperedHeader = createInvalidSignatureHeader(payloadBuf, TEST_WEBHOOK_SECRET);

      const isValid = verifySignature(payloadBuf, tamperedHeader, TEST_WEBHOOK_SECRET);
      assert.strictEqual(isValid, false);
    });

    it('should reject signature generated with an incorrect secret', () => {
      const payloadBuf = Buffer.from(JSON.stringify(GITHUB_PAYLOADS.workflowFailed), 'utf8');
      const signatureHeader = createValidSignatureHeader(payloadBuf, 'wrong_secret_12345');

      const isValid = verifySignature(payloadBuf, signatureHeader, TEST_WEBHOOK_SECRET);
      assert.strictEqual(isValid, false);
    });

    it('should reject missing, empty, or non-string signature headers', () => {
      const payloadBuf = Buffer.from('{"test": true}', 'utf8');

      assert.strictEqual(verifySignature(payloadBuf, null, TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature(payloadBuf, undefined, TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature(payloadBuf, '', TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature(payloadBuf, 12345, TEST_WEBHOOK_SECRET), false);
    });

    it('should reject signature headers lacking the sha256= prefix', () => {
      const payloadBuf = Buffer.from('{"test": true}', 'utf8');
      const valid = createValidSignatureHeader(payloadBuf, TEST_WEBHOOK_SECRET);
      const rawHex = valid.slice(7);

      assert.strictEqual(verifySignature(payloadBuf, rawHex, TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature(payloadBuf, `sha1=${rawHex}`, TEST_WEBHOOK_SECRET), false);
    });

    it('should reject malformed or truncated hex digests', () => {
      const payloadBuf = Buffer.from('{"test": true}', 'utf8');

      assert.strictEqual(verifySignature(payloadBuf, 'sha256=abcdef', TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature(payloadBuf, 'sha256=' + 'g'.repeat(64), TEST_WEBHOOK_SECRET), false);
    });

    it('should reject null or undefined payload and missing secret', () => {
      const validHeader = 'sha256=' + 'a'.repeat(64);

      assert.strictEqual(verifySignature(null, validHeader, TEST_WEBHOOK_SECRET), false);
      assert.strictEqual(verifySignature('body', validHeader, null), false);
      assert.strictEqual(verifySignature('body', validHeader, ''), false);
    });
  });

  describe('Part 2: Payload Handling and HTTP 401 Rejection', () => {
    it('should reject unauthenticated payloads with HTTP 401 Unauthorized', () => {
      const result = handleWebhookPayload(GITHUB_PAYLOADS.workflowFailed, false);

      assert.strictEqual(result.status, 401);
      assert.strictEqual(result.error, 'Unauthorized');
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(result);
    });

    it('should process workflow failure and dispatch structured alert via alertQueue', () => {
      const payload = GITHUB_PAYLOADS.workflowFailed;
      const result = handleWebhookPayload(payload, true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 200);
      assert.ok(typeof result.alert === 'string');
      assert.strictEqual(alertMock.count(), 1);

      const captured = alertMock.getLastAlert();
      assert.strictEqual(captured.priority, 'urgent');
      assert.ok(captured.text.includes('davidcastellanos/jarvis'));
      assert.ok(captured.text.includes('CI/CD Deploy Pipeline'));
      assert.ok(captured.text.includes('main'));
      assert.ok(captured.text.includes('7a8b9c0'));
      assert.ok(captured.text.includes('davidcastellanos'));

      assertNoEmojis(result);
      assertNoEmojis(captured);
    });

    it('should extract repository, branch, commit SHA, and actor accurately', () => {
      const { alertText, metadata } = formatWorkflowFailureAlert(GITHUB_PAYLOADS.workflowFailed);

      assert.strictEqual(metadata.repo, 'davidcastellanos/jarvis');
      assert.strictEqual(metadata.branch, 'main');
      assert.strictEqual(metadata.commitSha, '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b');
      assert.strictEqual(metadata.actor, 'davidcastellanos');
      assert.strictEqual(metadata.workflow, 'CI/CD Deploy Pipeline');
      assert.ok(alertText.includes('7a8b9c0'));

      assertNoEmojis(alertText);
      assertNoEmojis(metadata);
    });

    it('should ignore successful workflow runs without triggering alerts', () => {
      const result = handleWebhookPayload(GITHUB_PAYLOADS.workflowSucceeded, true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.alert, null);
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(result);
    });

    it('should ignore timed out workflow runs without triggering failure alert', () => {
      const result = handleWebhookPayload(GITHUB_PAYLOADS.workflowTimedOut, true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.alert, null);
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(result);
    });

    it('should handle ping events gracefully without triggering alerts', () => {
      const result = handleWebhookPayload(GITHUB_PAYLOADS.pingEvent, true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.alert, null);
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(result);
    });

    it('should parse stringified JSON payload correctly', () => {
      const stringPayload = JSON.stringify(GITHUB_PAYLOADS.workflowFailed);
      const result = handleWebhookPayload(stringPayload, true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 200);
      assert.ok(typeof result.alert === 'string');
      assert.strictEqual(alertMock.count(), 1);
      assertNoEmojis(result);
    });

    it('should return HTTP 400 for malformed string JSON payload', () => {
      const result = handleWebhookPayload('not-json-content', true, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.error, 'Invalid JSON payload');
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(result);
    });
  });

  describe('Part 3: HTTP Request Processing Simulation', () => {
    function createMockRequest(bodyBuffer, headers = {}) {
      const stream = new Readable({
        read() {
          this.push(bodyBuffer);
          this.push(null);
        }
      });
      stream.headers = headers;
      return stream;
    }

    it('should process full signed HTTP request envelope end-to-end', async () => {
      const envelope = createWebhookRequestEnvelope(
        GITHUB_PAYLOADS.workflowFailed,
        'workflow_run',
        TEST_WEBHOOK_SECRET,
        true
      );

      const req = createMockRequest(envelope.rawBody, envelope.headers);
      const res = await processWebhookRequest(req, TEST_WEBHOOK_SECRET, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.alert);
      assert.strictEqual(alertMock.count(), 1);
      assertNoEmojis(res);
    });

    it('should reject request with invalid HMAC header at HTTP envelope level', async () => {
      const envelope = createWebhookRequestEnvelope(
        GITHUB_PAYLOADS.workflowFailed,
        'workflow_run',
        TEST_WEBHOOK_SECRET,
        false
      );

      const req = createMockRequest(envelope.rawBody, envelope.headers);
      const res = await processWebhookRequest(req, TEST_WEBHOOK_SECRET, {
        enqueueAlert: (alert) => alertMock.capture(alert)
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
      assert.strictEqual(alertMock.count(), 0);
      assertNoEmojis(res);
    });
  });
});
