import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { enqueueAlert } from './alertQueueService.js';
import { runCommand } from './sysCommandRunner.js';

export const DEFAULT_FAIL2BAN_LOG = '/var/log/fail2ban.log';
export const DEFAULT_AUTH_LOG = '/var/log/auth.log';
export const DEFAULT_DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Regex matching Fail2ban log lines indicating an IP ban event.
 * Captures timestamp, jail name, and banned IP (IPv4 or IPv6).
 */
const FAIL2BAN_BAN_LINE_REGEX =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,\.]\d+)?).*?\[([^\]]+)\]\s+Ban\s+([0-9a-fA-F:.]+)/;

/**
 * Regex matching SSH authentication failure lines in auth.log.
 */
const AUTH_LOG_FAILURE_REGEX =
  /^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+\S+\s+sshd\[\d+\]:\s+(Failed password for (?:invalid user )?(\S+)|Invalid user (\S+))\s+from\s+([0-9a-fA-F:.]+)\s+port\s+(\d+)/;

/**
 * Parses raw Fail2ban log content and extracts all ban events.
 *
 * @param {string} logContent - Raw log text.
 * @returns {Array<{ ip: string, jail: string, timestamp: string, rawLine: string }>}
 */
export function parseFail2banLog(logContent) {
  if (typeof logContent !== 'string' || !logContent.trim()) {
    return [];
  }

  const lines = logContent.split(/\r?\n/);
  const banEvents = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Filter out Unban and Restore Ban explicitly to prevent false positives
    if (trimmed.includes('Restore Ban') || trimmed.includes('Unban')) {
      continue;
    }

    const match = trimmed.match(FAIL2BAN_BAN_LINE_REGEX);
    if (match) {
      const timestamp = match[1];
      const jail = match[2];
      const ip = match[3];

      banEvents.push({
        ip,
        jail,
        timestamp,
        rawLine: trimmed
      });
    }
  }

  return banEvents;
}

/**
 * Parses raw auth.log content and extracts failed authentication attempts.
 *
 * @param {string} logContent - Raw auth.log text.
 * @returns {Array<{ timestamp: string, user: string, ip: string, port: number, reason: string, rawLine: string }>}
 */
export function parseAuthLog(logContent) {
  if (typeof logContent !== 'string' || !logContent.trim()) {
    return [];
  }

  const lines = logContent.split(/\r?\n/);
  const failures = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(AUTH_LOG_FAILURE_REGEX);
    if (match) {
      const timestamp = match[1];
      const user = match[3] || match[4] || 'unknown';
      const ip = match[5];
      const port = Number(match[6]) || 0;
      const reason = match[2].startsWith('Invalid user') ? 'invalid_user' : 'failed_password';

      failures.push({
        timestamp,
        user,
        ip,
        port,
        reason,
        rawLine: trimmed
      });
    }
  }

  return failures;
}

/**
 * Queries fail2ban-client CLI for current jail status and active bans.
 *
 * @param {string} [jail='sshd'] - Target jail name.
 * @param {object} [deps={}] - Dependency injection.
 * @returns {Promise<{ jail: string, currentlyFailed: number, totalFailed: number, fileList: string[], currentlyBanned: number, totalBanned: number, bannedIps: string[] }>}
 */
export async function queryFail2banStatus(jail = 'sshd', deps = {}) {
  const runner = deps.sysCommandRunner || deps.runCommand || runCommand;

  const result = await runner('fail2ban-client', ['status', jail], {
    timeoutMs: 5000
  });

  if (!result.ok) {
    throw new Error(`Failed to query fail2ban status for jail '${jail}': ${result.stderr || result.stdout}`);
  }

  const stdout = result.stdout || '';

  const currentlyFailedMatch = stdout.match(/Currently failed:\s+(\d+)/);
  const totalFailedMatch = stdout.match(/Total failed:\s+(\d+)/);
  const fileListMatch = stdout.match(/File list:\s+(.+)/);
  const currentlyBannedMatch = stdout.match(/Currently banned:\s+(\d+)/);
  const totalBannedMatch = stdout.match(/Total banned:\s+(\d+)/);
  const bannedIpsMatch = stdout.match(/Banned IP list:\s*(.*)/);

  const currentlyFailed = currentlyFailedMatch ? Number(currentlyFailedMatch[1]) : 0;
  const totalFailed = totalFailedMatch ? Number(totalFailedMatch[1]) : 0;
  const fileList = fileListMatch ? fileListMatch[1].trim().split(/\s+/).filter(Boolean) : [];
  const currentlyBanned = currentlyBannedMatch ? Number(currentlyBannedMatch[1]) : 0;
  const totalBanned = totalBannedMatch ? Number(totalBannedMatch[1]) : 0;
  const bannedIps = bannedIpsMatch && bannedIpsMatch[1].trim()
    ? bannedIpsMatch[1].trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    jail,
    currentlyFailed,
    totalFailed,
    fileList,
    currentlyBanned,
    totalBanned,
    bannedIps
  };
}

/**
 * Formats a Fail2ban ban event into a zero-emoji structured alert payload.
 *
 * @param {object} banEvent
 * @param {string} banEvent.ip
 * @param {string} [banEvent.jail='sshd']
 * @param {string} [banEvent.timestamp]
 * @returns {object} Formatted alert payload ready for alertQueueService.
 */
export function formatFail2banAlert(banEvent) {
  const ip = banEvent.ip || 'desconocida';
  const jail = banEvent.jail || 'sshd';
  const timestamp = banEvent.timestamp || new Date().toISOString();

  return {
    title: `Bloqueo de seguridad Fail2ban: IP ${ip}`,
    details: `La direccion IP ${ip} ha sido bloqueada en la carcel [${jail}] tras multiples intentos fallidos de autenticacion.`,
    timestamp,
    priority: 'high',
    metadata: {
      type: 'FAIL2BAN_BAN',
      ip,
      jail,
      timestamp
    }
  };
}

/**
 * Creates an empty initial state container for incremental log scanning.
 *
 * @returns {{ offset: number, deduplicationCache: Map<string, number> }}
 */
export function createFail2banScanState() {
  return {
    offset: 0,
    deduplicationCache: new Map()
  };
}

/**
 * Scans a Fail2ban log file incrementally using byte offsets.
 * Handles logrotate automatically when file size shrinks.
 * Deduplicates IP alerts across a sliding 24-hour window.
 * Dispatches structured zero-emoji alerts to alertQueueService.
 *
 * @param {string} logPath - Path to fail2ban.log
 * @param {object} state - Persistent state ({ offset: number, deduplicationCache: Map|object })
 * @param {object} [deps={}] - Dependency injection
 * @returns {Promise<Array<{ ip: string, jail: string, timestamp: string }>>} Array of newly alerted bans
 */
export async function scanFail2banLog(logPath, state, deps = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('State object must be provided to maintain incremental scan offset');
  }

  if (typeof state.offset !== 'number' || state.offset < 0) {
    state.offset = 0;
  }

  if (!state.deduplicationCache) {
    state.deduplicationCache = new Map();
  }

  const statFn = deps.stat || (async (p) => fsPromises.stat(p));
  let fileStats;
  try {
    fileStats = await statFn(logPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const currentSize = fileStats.size;

  // Logrotate detection: if file size is less than previous offset, reset to 0
  if (currentSize < state.offset) {
    state.offset = 0;
  }

  // No new bytes written
  if (currentSize === state.offset) {
    return [];
  }

  const bytesToRead = currentSize - state.offset;
  let chunkText = '';

  if (typeof deps.readChunk === 'function') {
    chunkText = await deps.readChunk(logPath, state.offset, bytesToRead);
  } else if (typeof deps.readFile === 'function') {
    const rawContent = await deps.readFile(logPath, 'utf8');
    const buf = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(rawContent, 'utf8');
    chunkText = buf.subarray(state.offset, currentSize).toString('utf8');
  } else {
    const fileHandle = await fsPromises.open(logPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, state.offset);
      chunkText = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fileHandle.close();
    }
  }

  state.offset = currentSize;

  const banEvents = parseFail2banLog(chunkText);
  if (banEvents.length === 0) {
    return [];
  }

  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
  const dedupTtlMs = typeof deps.dedupTtlMs === 'number' ? deps.dedupTtlMs : DEFAULT_DEDUP_TTL_MS;
  const newBans = [];

  for (const ban of banEvents) {
    const ip = ban.ip;
    let lastSeenTime = null;

    if (state.deduplicationCache instanceof Map) {
      lastSeenTime = state.deduplicationCache.get(ip);
    } else if (typeof state.deduplicationCache === 'object') {
      lastSeenTime = state.deduplicationCache[ip];
    }

    const isDuplicate = lastSeenTime !== null && lastSeenTime !== undefined && (nowMs - lastSeenTime < dedupTtlMs);

    if (!isDuplicate) {
      if (state.deduplicationCache instanceof Map) {
        state.deduplicationCache.set(ip, nowMs);
      } else if (typeof state.deduplicationCache === 'object') {
        state.deduplicationCache[ip] = nowMs;
      }

      if (deps.emitAlerts !== false) {
        const alertPayload = formatFail2banAlert(ban);
        if (typeof deps.enqueueAlert === 'function') {
          await deps.enqueueAlert(alertPayload);
        } else {
          enqueueAlert(alertPayload, { queuePath: deps.queuePath });
        }
      }

      newBans.push({
        ip: ban.ip,
        jail: ban.jail,
        timestamp: ban.timestamp
      });
    }
  }

  return newBans;
}
