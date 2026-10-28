import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, 'data');
export const DEFAULT_QUEUE_FILE = path.join(DEFAULT_DATA_DIR, 'alerts_queue.json');

/**
 * Ensures the target directory exists before writing.
 *
 * @param {string} filePath - Target file path
 */
function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Safely reads the alerts queue from disk.
 * Handles missing files, empty files, and corrupted JSON gracefully.
 *
 * @param {string} [queuePath=DEFAULT_QUEUE_FILE]
 * @returns {Array<object>} Array of queued alerts
 */
function readAlertsRaw(queuePath = DEFAULT_QUEUE_FILE) {
  try {
    if (!fs.existsSync(queuePath)) {
      return [];
    }
    const raw = fs.readFileSync(queuePath, 'utf-8');
    if (!raw || !raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      writeAlertsRaw([], queuePath);
      return [];
    }
    return parsed;
  } catch {
    try {
      writeAlertsRaw([], queuePath);
    } catch {
      // Ignore secondary write error
    }
    return [];
  }
}

/**
 * Safely writes alerts array to disk.
 * Attempts atomic temp-file rename, falling back to direct write.
 *
 * @param {Array<object>} alerts - Array of alerts to persist
 * @param {string} [queuePath=DEFAULT_QUEUE_FILE]
 */
function writeAlertsRaw(alerts, queuePath = DEFAULT_QUEUE_FILE) {
  ensureDirectoryExists(queuePath);
  const data = JSON.stringify(alerts, null, 2);
  const tmpPath = `${queuePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, queuePath);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup error
    }
    fs.writeFileSync(queuePath, data, 'utf-8');
  }
}

/**
 * Appends an alert to the inter-process FIFO queue.
 *
 * @param {object} alertData - Alert payload
 * @param {string} [alertData.title] - Alert title
 * @param {any} [alertData.details] - Alert details or body
 * @param {string} [alertData.timestamp] - ISO timestamp
 * @param {string} [alertData.priority] - Priority ('low', 'normal', 'high', 'urgent')
 * @param {object} [options={}] - Options
 * @param {string} [options.queuePath] - Custom queue file path
 * @returns {object} The normalized enqueued alert
 */
export function enqueueAlert(alertData, options = {}) {
  if (!alertData || typeof alertData !== 'object') {
    throw new TypeError('Alert payload must be a non-null object');
  }

  const queuePath = options.queuePath || DEFAULT_QUEUE_FILE;

  const normalizedAlert = {
    id: alertData.id || crypto.randomUUID(),
    title: typeof alertData.title === 'string' && alertData.title.trim()
      ? alertData.title.trim()
      : 'Alerta del Sistema',
    details: alertData.details !== undefined ? alertData.details : (alertData.text || ''),
    timestamp: alertData.timestamp || new Date().toISOString(),
    priority: alertData.priority || 'normal',
    ...alertData
  };

  normalizedAlert.id = normalizedAlert.id || crypto.randomUUID();
  normalizedAlert.timestamp = normalizedAlert.timestamp || new Date().toISOString();
  normalizedAlert.priority = normalizedAlert.priority || 'normal';

  const currentQueue = readAlertsRaw(queuePath);
  currentQueue.push(normalizedAlert);
  writeAlertsRaw(currentQueue, queuePath);

  return normalizedAlert;
}

/**
 * Atomically reads and flushes all pending alerts in FIFO order.
 *
 * @param {object} [options={}] - Options
 * @param {string} [options.queuePath] - Custom queue file path
 * @returns {Array<object>} Array of drained alerts
 */
export function drainAlerts(options = {}) {
  const queuePath = options.queuePath || DEFAULT_QUEUE_FILE;
  const pendingAlerts = readAlertsRaw(queuePath);

  if (pendingAlerts.length > 0) {
    writeAlertsRaw([], queuePath);
  }

  return pendingAlerts;
}

/**
 * Peeks at pending alerts without removing them from the queue.
 *
 * @param {object} [options={}]
 * @param {string} [options.queuePath]
 * @returns {Array<object>}
 */
export function peekAlerts(options = {}) {
  const queuePath = options.queuePath || DEFAULT_QUEUE_FILE;
  return readAlertsRaw(queuePath);
}

/**
 * Returns current count of pending alerts in the queue.
 *
 * @param {object} [options={}]
 * @param {string} [options.queuePath]
 * @returns {number}
 */
export function getQueueLength(options = {}) {
  const queuePath = options.queuePath || DEFAULT_QUEUE_FILE;
  return readAlertsRaw(queuePath).length;
}

/**
 * Resets the queue to an empty state.
 *
 * @param {object} [options={}]
 * @param {string} [options.queuePath]
 * @returns {boolean}
 */
export function clearQueue(options = {}) {
  const queuePath = options.queuePath || DEFAULT_QUEUE_FILE;
  writeAlertsRaw([], queuePath);
  return true;
}

/**
 * Formats a queued alert into a clean, zero-emoji notification string.
 *
 * @param {object} alert
 * @returns {string}
 */
export function formatAlertText(alert) {
  if (!alert) return '[ALERTA] Sin datos';
  const title = alert.title || 'Alerta del Sistema';
  const priority = (alert.priority || 'NORMAL').toUpperCase();
  const timestamp = alert.timestamp || new Date().toISOString();
  let detailsText = '';

  if (typeof alert.details === 'object' && alert.details !== null) {
    detailsText = JSON.stringify(alert.details, null, 2);
  } else {
    detailsText = String(alert.details || alert.text || '');
  }

  const lines = [
    `[ALERTA - ${priority}] ${title}`,
    detailsText ? `Detalles: ${detailsText}` : null,
    `Timestamp: ${timestamp}`
  ].filter(Boolean);

  return lines.join('\n');
}
