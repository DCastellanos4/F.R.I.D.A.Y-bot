import crypto from 'node:crypto';

/**
 * GitHub Actions Webhook Test Fixtures for Task 15 (CI/CD Webhook & Alerts).
 *
 * Provides realistic GitHub workflow_run payloads, HMAC calculation helpers,
 * and valid/invalid header test vectors.
 *
 * Strict Policy: Zero Emojis.
 */

export const TEST_WEBHOOK_SECRET = 'davis_ci_webhook_secret_998877';

export const GITHUB_PAYLOADS = {
  workflowFailed: {
    action: 'completed',
    workflow: {
      id: 9876543,
      name: 'CI/CD Deploy Pipeline'
    },
    workflow_run: {
      id: 12345678,
      name: 'CI/CD Deploy Pipeline',
      head_branch: 'main',
      head_sha: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
      conclusion: 'failure',
      status: 'completed',
      html_url: 'https://github.com/davidcastellanos/jarvis/actions/runs/12345678',
      actor: {
        login: 'davidcastellanos'
      },
      head_commit: {
        id: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
        message: 'fix: optimize PM2 socket handling and timeout limits',
        author: {
          name: 'David Castellanos'
        }
      }
    },
    repository: {
      name: 'jarvis',
      full_name: 'davidcastellanos/jarvis',
      html_url: 'https://github.com/davidcastellanos/jarvis'
    },
    sender: {
      login: 'davidcastellanos'
    }
  },

  workflowSucceeded: {
    action: 'completed',
    workflow: {
      id: 9876543,
      name: 'CI/CD Deploy Pipeline'
    },
    workflow_run: {
      id: 12345679,
      name: 'CI/CD Deploy Pipeline',
      head_branch: 'main',
      head_sha: '9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c',
      conclusion: 'success',
      status: 'completed',
      html_url: 'https://github.com/davidcastellanos/jarvis/actions/runs/12345679',
      actor: {
        login: 'davidcastellanos'
      },
      head_commit: {
        id: '9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c',
        message: 'chore: bump dependencies',
        author: {
          name: 'David Castellanos'
        }
      }
    },
    repository: {
      name: 'jarvis',
      full_name: 'davidcastellanos/jarvis'
    }
  },

  workflowTimedOut: {
    action: 'completed',
    workflow: {
      id: 9876543,
      name: 'E2E Integration Tests'
    },
    workflow_run: {
      id: 12345680,
      name: 'E2E Integration Tests',
      head_branch: 'feature/s2-infra',
      head_sha: '3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
      conclusion: 'timed_out',
      status: 'completed',
      html_url: 'https://github.com/davidcastellanos/jarvis/actions/runs/12345680',
      actor: {
        login: 'davidcastellanos'
      },
      head_commit: {
        id: '3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
        message: 'test: run long-running stress test suite',
        author: {
          name: 'David Castellanos'
        }
      }
    },
    repository: {
      name: 'jarvis',
      full_name: 'davidcastellanos/jarvis'
    }
  },

  pingEvent: {
    zen: 'Keep it logically awesome.',
    hook_id: 87654321,
    hook: {
      type: 'Repository',
      id: 87654321,
      name: 'web',
      active: true,
      events: ['workflow_run']
    },
    repository: {
      full_name: 'davidcastellanos/jarvis'
    }
  }
};

/**
 * Computes a valid x-hub-signature-256 header for a given raw body.
 *
 * @param {Buffer|string} rawBody
 * @param {string} [secret=TEST_WEBHOOK_SECRET]
 * @returns {string} Formatted signature: 'sha256=<64-hex>'
 */
export function createValidSignatureHeader(rawBody, secret = TEST_WEBHOOK_SECRET) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const hmac = crypto.createHmac('sha256', secret).update(buf).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Computes an invalid / tampered signature header.
 *
 * @param {Buffer|string} rawBody
 * @param {string} [secret=TEST_WEBHOOK_SECRET]
 * @returns {string} Signature with bit-flip in digest
 */
export function createInvalidSignatureHeader(rawBody, secret = TEST_WEBHOOK_SECRET) {
  const valid = createValidSignatureHeader(rawBody, secret);
  // Replace the last character with a different hex char
  const lastChar = valid.slice(-1);
  const corruptedChar = lastChar === '0' ? '1' : '0';
  return valid.slice(0, -1) + corruptedChar;
}

/**
 * Formats a full HTTP request envelope for testing.
 *
 * @param {object} payload - JSON payload object.
 * @param {string} [eventType='workflow_run']
 * @param {string} [secret=TEST_WEBHOOK_SECRET]
 * @param {boolean} [validSignature=true]
 * @returns {{ headers: Record<string, string>, rawBody: Buffer, payload: object }}
 */
export function createWebhookRequestEnvelope(payload, eventType = 'workflow_run', secret = TEST_WEBHOOK_SECRET, validSignature = true) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signatureHeader = validSignature
    ? createValidSignatureHeader(rawBody, secret)
    : createInvalidSignatureHeader(rawBody, secret);

  const headers = {
    'content-type': 'application/json',
    'x-github-event': eventType,
    'x-github-delivery': crypto.randomUUID(),
    'x-hub-signature-256': signatureHeader
  };

  return {
    headers,
    rawBody,
    payload
  };
}
