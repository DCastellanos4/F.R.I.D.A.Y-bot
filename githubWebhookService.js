import crypto from 'node:crypto';
import { enqueueAlert } from './alertQueueService.js';

/**
 * GitHub Webhook Service for CI/CD Telemetry and Build Failure Notifications.
 *
 * Provides:
 * 1. Raw-payload timing-safe HMAC-SHA256 signature verification.
 * 2. Webhook payload handling with immediate HTTP 401 rejection on invalid signature.
 * 3. Workflow failure extraction (repo, branch, commit, actor) and alert queue dispatch.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * Verifies an incoming GitHub webhook signature using timing-safe HMAC-SHA256.
 *
 * @param {Buffer|string} rawBody - Raw request payload buffer or string.
 * @param {string} signatureHeader - Value of 'x-hub-signature-256' header (e.g. 'sha256=<hex>').
 * @param {string} secret - Shared webhook secret.
 * @returns {boolean} True if signature is valid, false otherwise.
 */
export function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return false;
  }

  if (!secret || typeof secret !== 'string') {
    return false;
  }

  if (rawBody === null || rawBody === undefined) {
    return false;
  }

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(prefix.length).trim().toLowerCase();
  if (receivedHex.length !== 64 || !/^[0-9a-f]{64}$/.test(receivedHex)) {
    return false;
  }

  try {
    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody), 'utf8');

    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(bodyBuffer)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const receivedBuf = Buffer.from(receivedHex, 'hex');

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

/**
 * Formats a clean, zero-emoji notification alert for a failed GitHub Actions workflow.
 *
 * @param {object} payload - Parsed GitHub webhook payload.
 * @returns {{ alertText: string, metadata: object }}
 */
export function formatWorkflowFailureAlert(payload) {
  const workflowRun = payload?.workflow_run || {};
  const repo = payload?.repository?.full_name || payload?.repository?.name || 'repositorio-desconocido';
  const branch = workflowRun.head_branch || 'desconocida';
  const commitSha = workflowRun.head_sha || workflowRun.head_commit?.id || 'desconocido';
  const commitShort = typeof commitSha === 'string' ? commitSha.slice(0, 7) : 'desconocido';
  const actor = workflowRun.actor?.login || payload?.sender?.login || 'desconocido';
  const workflowName = payload?.workflow?.name || workflowRun.name || 'CI/CD Pipeline';
  const runUrl = workflowRun.html_url || '';
  const commitMessage = workflowRun.head_commit?.message ? workflowRun.head_commit.message.split('\n')[0] : '';

  const lines = [
    `[ALERTA CI/CD] Fallo en pipeline de GitHub Actions`,
    `Repositorio: ${repo}`,
    `Workflow: ${workflowName}`,
    `Rama: ${branch}`,
    `Commit: ${commitShort} (${commitSha})`,
    commitMessage ? `Mensaje: ${commitMessage}` : null,
    `Actor: ${actor}`,
    runUrl ? `URL: ${runUrl}` : null
  ].filter(Boolean);

  const alertText = lines.join('\n');

  const metadata = {
    repo,
    workflow: workflowName,
    branch,
    commitSha,
    commitShort,
    actor,
    runUrl
  };

  return { alertText, metadata };
}

/**
 * Processes an incoming GitHub webhook payload.
 * Validates signature, parses workflow_run status, and dispatches alerts on failure.
 *
 * @param {object|string} payload - Webhook payload object or JSON string.
 * @param {boolean} signatureValid - Whether the request signature was verified.
 * @param {object} [deps={}] - Optional injected dependencies.
 * @param {Function} [deps.enqueueAlert] - Custom enqueueAlert implementation.
 * @returns {{ status: number, alert?: string|null, error?: string, details?: object }}
 */
export function handleWebhookPayload(payload, signatureValid, deps = {}) {
  if (!signatureValid) {
    return {
      status: 401,
      error: 'Unauthorized'
    };
  }

  let parsedPayload = payload;
  if (typeof payload === 'string') {
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      return {
        status: 400,
        error: 'Invalid JSON payload'
      };
    }
  }

  if (!parsedPayload || typeof parsedPayload !== 'object') {
    return {
      status: 400,
      error: 'Payload must be an object'
    };
  }

  const workflowRun = parsedPayload.workflow_run;

  // Check for workflow_run failure
  if (workflowRun && workflowRun.conclusion === 'failure') {
    const { alertText, metadata } = formatWorkflowFailureAlert(parsedPayload);
    const enqueueFn = deps.enqueueAlert || enqueueAlert;

    enqueueFn({
      title: 'Fallo en pipeline de GitHub Actions',
      details: alertText,
      priority: 'urgent',
      metadata
    });

    return {
      status: 200,
      alert: alertText,
      metadata
    };
  }

  return {
    status: 200,
    alert: null
  };
}

/**
 * Handles an HTTP request directly (for mounting in http.createServer or Express).
 *
 * @param {object} req - HTTP incoming request.
 * @param {string} secret - Webhook secret.
 * @param {object} [deps={}] - Injected dependencies.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function processWebhookRequest(req, secret, deps = {}) {
  return new Promise((resolve) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const signatureHeader = req.headers?.['x-hub-signature-256'] || '';
      const isValid = verifySignature(rawBody, signatureHeader, secret);

      let payload = {};
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        if (!isValid) {
          return resolve({ status: 401, body: { error: 'Unauthorized' } });
        }
        return resolve({ status: 400, body: { error: 'Invalid JSON payload' } });
      }

      const result = handleWebhookPayload(payload, isValid, deps);
      resolve({ status: result.status, body: result });
    });

    req.on('error', (err) => {
      resolve({ status: 500, body: { error: err.message || 'Stream error' } });
    });
  });
}
