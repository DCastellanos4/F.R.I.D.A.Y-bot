/**
 * bashConsoleService.js
 *
 * Secure remote bash console with two-tier command safety classification,
 * ephemeral 6-digit OTP (120s TTL) for critical commands, secret scrubbing,
 * and state machine execution.
 *
 * Strict Policy: Zero Emojis.
 */

import crypto from 'node:crypto';
import { runCommand as sysRunCommand } from './sysCommandRunner.js';

export const DEFAULT_OTP_TTL_MS = 120000; // 120 seconds (2 minutes)
export const MAX_OTP_ATTEMPTS = 3;
export const OTP_DIGITS = 6;

/**
 * In-memory map of pending OTP authorizations: commandId -> PendingExecution
 * @type {Map<string, PendingExecution>}
 */
const pendingRequests = new Map();

/**
 * Patterns of permanently forbidden/destructive commands.
 * Under no circumstances can these be executed.
 */
const FORBIDDEN_PATTERNS = [
  // Root deletion targeting / or /* with recursive flag
  /\brm\s+.*-[a-zA-Z]*[rR][a-zA-Z]*.*\s+(\/|\/\*)(\s+|$)/,
  /\brm\s+.*--no-preserve-root\b/,
  // Filesystem formatting
  /\bmkfs(\.[a-zA-Z0-9]+)?\b/,
  // Raw block device overwriting via dd
  /\bdd\b.*of=\/dev\/(sd[a-z]|hd[a-z]|vd[a-z]|nvme[0-9]|loop|null|zero|sda)/,
  // Fork bomb variations
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  // Raw redirection to block devices
  />\s*\/dev\/(sd[a-z]|hd[a-z]|vd[a-z]|nvme[0-9]|sda)\b/
];

/**
 * Whitelist patterns for recognized safe / read-only commands.
 */
const SAFE_COMMAND_PATTERNS = [
  /^(uptime|date|whoami|id|uname|hostname)(\s+.*)?$/,
  /^(df|free|vmstat|iostat)(\s+.*)?$/,
  /^(ps|top)(\s+.*)?$/,
  /^(netstat|ss|lsof)(\s+.*)?$/,
  /^(cat|head|tail|more|less)(\s+.*)?$/,
  /^(grep|egrep|fgrep|awk|cut|sort|uniq|wc|tr)(\s+.*)?$/,
  /^pm2\s+(status|list|ls|show|describe|logs|monit|info)(\s+.*)?$/,
  /^docker\s+(ps|images|stats|logs|top|version|inspect|diff|port)(\s+.*)?$/,
  /^git\s+(status|log|diff|branch|remote|show|tag|rev-parse)(\s+.*)?$/,
  /^ping(\s+.*)?$/,
  /^ip\s+(addr|route|link|neigh)(\s+.*)?$/,
  /^(which|whereis|file|stat)(\s+.*)?$/,
  /^echo(\s+.*)?$/,
  /^ls(\s+.*)?$/,
  /^pwd$/
];

/**
 * Patterns matching mutating, administrative, or critical commands requiring OTP.
 */
const CRITICAL_PATTERNS = [
  /\bpm2\s+(restart|stop|delete|kill|start|reload|reset)\b/,
  /\b(reboot|shutdown|poweroff|halt|init\s+[06])\b/,
  /\bsystemctl\s+(restart|stop|start|reload|disable|enable|mask|unmask)\b/,
  /\bservice\s+\S+\s+(restart|stop|start|reload)\b/,
  /\bdocker\s+(restart|stop|rm|kill|pause|unpause|prune|rmi|build|run|create)\b/,
  /\bdocker-compose\s+(down|restart|stop|rm|kill|up)\b/,
  /\b(rm|rmdir|unlink|shred)\b/,
  /\b(kill|killall|pkill|fuser)\b/,
  /\b(chmod|chown|chgrp)\b/,
  /\bgit\s+(pull|checkout|reset|clean|rebase|merge|revert|push|commit)\b/,
  /\b(apt|apt-get|dpkg)\s+(update|upgrade|install|remove|purge|clean|autoremove)\b/,
  /\b(npm|yarn|pnpm)\s+(install|add|remove|uninstall|update)\b/,
  /\b(ufw|iptables|firewall-cmd)\b/,
  /\b(sed\s+-i|truncate)\b/
];

/**
 * Redirection to files (excluding standard descriptor redirections like 2>&1 or >/dev/null).
 */
const FILE_WRITE_REDIRECTION = /(?<!\b2)>(?!&1|\s*\/dev\/null)\s*[^\s]/;

/**
 * Masks sensitive tokens, API keys, credentials, and passwords in command outputs.
 *
 * @param {string} text - Raw terminal stdout or stderr
 * @returns {string} Scrubbed text with zero emojis
 */
export function scrubSecrets(text) {
  if (typeof text !== 'string') return text;
  let scrubbed = text;

  // 1. Connection strings with passwords (e.g. postgres://user:password@host:port/db)
  scrubbed = scrubbed.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:]+:)([^@\s]+)(@[^\s]+)/g,
    '$1[REDACTED]$3'
  );

  // 2. Sensitive env assignments / key-value lines
  scrubbed = scrubbed.replace(
    /(?<=(?:^|\s|[A-Z0-9_]*)(?:KEY|SECRET|PASSWORD|PASS|TOKEN|CREDENTIAL|AUTH|ENCRYPTION_KEY)[A-Z0-9_]*\s*=\s*)([^\s\r\n]+)/gi,
    '[REDACTED]'
  );

  // 3. Known high-entropy API key patterns
  scrubbed = scrubbed.replace(/\b(sk-[a-zA-Z0-9_-]{20,}|sk-proj-[a-zA-Z0-9_-]{20,})\b/g, '[REDACTED_API_KEY]');
  scrubbed = scrubbed.replace(/\b(gh[pousr]_[a-zA-Z0-9]{36,})\b/g, '[REDACTED_GITHUB_TOKEN]');
  scrubbed = scrubbed.replace(/\b(glpat-[a-zA-Z0-9_-]{20,})\b/g, '[REDACTED_GITLAB_TOKEN]');
  scrubbed = scrubbed.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]');

  // 4. Bearer tokens
  scrubbed = scrubbed.replace(/\bBearer\s+[a-zA-Z0-9_.\-]{20,}\b/gi, 'Bearer [REDACTED]');

  // 5. PEM Private keys
  scrubbed = scrubbed.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  return scrubbed;
}

/**
 * Splits a compound command string into individual subcommands.
 * Handles pipes, logical AND (&&), logical OR (||), and semicolons (;).
 * Also unpacks subshells: $(...) and `...`.
 *
 * @param {string} fullCmd
 * @returns {string[]} Array of individual command strings
 */
function splitCompoundCommand(fullCmd) {
  const parts = [];
  const normalized = fullCmd.trim();

  // Extract subshell contents: $(...)
  const subshellDollar = normalized.matchAll(/\$\(([^)]+)\)/g);
  for (const match of subshellDollar) {
    if (match[1]) parts.push(match[1].trim());
  }

  // Extract backtick subshell contents: `...`
  const subshellBacktick = normalized.matchAll(/`([^`]+)`/g);
  for (const match of subshellBacktick) {
    if (match[1]) parts.push(match[1].trim());
  }

  // Split top-level by chaining operators
  const topTokens = normalized.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const token of topTokens) {
    const trimmed = token.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
  }

  return parts;
}

/**
 * Classifies a single atomic command segment as SAFE, CRITICAL, or FORBIDDEN.
 *
 * @param {string} cmdSegment
 * @returns {{ isCritical: boolean, isForbidden: boolean, level: 'SAFE'|'CRITICAL'|'FORBIDDEN', reason: string }}
 */
function classifyAtomicSegment(cmdSegment) {
  const trimmed = cmdSegment.trim();

  // Check forbidden
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isCritical: true,
        isForbidden: true,
        level: 'FORBIDDEN',
        reason: 'Command contains catastrophic or permanently forbidden pattern'
      };
    }
  }

  // Check file writing redirection
  if (FILE_WRITE_REDIRECTION.test(trimmed)) {
    return {
      isCritical: true,
      isForbidden: false,
      level: 'CRITICAL',
      reason: 'Command redirects output to write or overwrite files on disk'
    };
  }

  // Check critical patterns
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isCritical: true,
        isForbidden: false,
        level: 'CRITICAL',
        reason: 'Command performs mutating, administrative, or destructive system operations'
      };
    }
  }

  // Check safe whitelist
  for (const pattern of SAFE_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isCritical: false,
        isForbidden: false,
        level: 'SAFE',
        reason: 'Command is a verified read-only diagnostic or informational tool'
      };
    }
  }

  // Default: unclassified commands are treated as CRITICAL for defense-in-depth
  return {
    isCritical: true,
    isForbidden: false,
    level: 'CRITICAL',
    reason: 'Command is not recognized in the safe whitelist; requires authorization'
  };
}

/**
 * Classifies a full command string, accounting for compound chains and subshells.
 *
 * @param {string} cmd - Command string
 * @returns {{ isCritical: boolean, isForbidden: boolean, level: 'SAFE'|'CRITICAL'|'FORBIDDEN', reason: string }}
 */
export function classifyCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return {
      isCritical: false,
      isForbidden: false,
      level: 'SAFE',
      reason: 'Empty command line'
    };
  }

  const trimmed = cmd.trim();

  // First: check forbidden patterns across the full raw string
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isCritical: true,
        isForbidden: true,
        level: 'FORBIDDEN',
        reason: 'Command contains catastrophic or permanently forbidden pattern'
      };
    }
  }

  // Split into compound subcommands
  const segments = splitCompoundCommand(trimmed);
  let foundCritical = false;
  let criticalReason = '';

  for (const segment of segments) {
    const classification = classifyAtomicSegment(segment);
    if (classification.isForbidden) {
      return classification;
    }
    if (classification.isCritical) {
      foundCritical = true;
      criticalReason = classification.reason;
    }
  }

  if (foundCritical) {
    return {
      isCritical: true,
      isForbidden: false,
      level: 'CRITICAL',
      reason: criticalReason || 'One or more compound subcommands require authorization'
    };
  }

  return {
    isCritical: false,
    isForbidden: false,
    level: 'SAFE',
    reason: 'All subcommands are verified read-only diagnostic or informational tools'
  };
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP code.
 *
 * @returns {string} 6-digit string
 */
function generateSecureOtp() {
  const code = crypto.randomInt(100000, 1000000);
  return code.toString();
}

/**
 * Executes a command via dependency-injected runner or sysCommandRunner.
 *
 * @param {string} cmd
 * @param {object} [deps={}]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, ok: boolean, durationMs: number }>}
 */
async function executeBashCommand(cmd, deps = {}) {
  const runner = deps.runner || deps.runCommand || sysRunCommand;
  const result = await runner(cmd, [], { shell: true, timeoutMs: 15000 }, deps);

  const rawStdout = typeof result.stdout === 'string' ? result.stdout : '';
  const rawStderr = typeof result.stderr === 'string' ? result.stderr : '';

  return {
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : (result.ok ? 0 : 1),
    stdout: scrubSecrets(rawStdout),
    stderr: scrubSecrets(rawStderr),
    ok: Boolean(result.ok ?? (result.exitCode === 0)),
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : 0
  };
}

/**
 * Requests execution of a bash command.
 * - Non-critical commands execute immediately and return status 'EXECUTED'.
 * - Critical commands generate a 6-digit OTP (120s TTL) and return status 'OTP_REQUIRED'.
 * - Forbidden commands are permanently rejected and return status 'FORBIDDEN'.
 *
 * @param {string} cmd - Command string
 * @param {object} [deps={}] - Optional injected dependencies
 * @param {Function} [deps.runner] - Injected command runner
 * @param {Function} [deps.otpGenerator] - Injected OTP generator
 * @param {Function} [deps.now] - Injected timestamp provider
 * @param {number} [deps.ttlMs] - Custom TTL in milliseconds
 * @returns {Promise<object>}
 */
export async function requestExecution(cmd, deps = {}) {
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return {
      status: 'INVALID_COMMAND',
      error: 'Command must be a non-empty string',
      stdout: '',
      stderr: ''
    };
  }

  const classification = classifyCommand(cmd);

  if (classification.isForbidden) {
    return {
      status: 'FORBIDDEN',
      command: cmd,
      reason: classification.reason,
      stdout: '',
      stderr: 'Command execution permanently rejected by security policy'
    };
  }

  if (!classification.isCritical) {
    const execResult = await executeBashCommand(cmd, deps);
    return {
      status: 'EXECUTED',
      command: cmd,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      exitCode: execResult.exitCode,
      durationMs: execResult.durationMs,
      ok: execResult.ok
    };
  }

  // Critical command requires 2FA OTP
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const ttlMs = typeof deps.ttlMs === 'number' ? deps.ttlMs : DEFAULT_OTP_TTL_MS;
  const otpCode = typeof deps.otpGenerator === 'function' ? deps.otpGenerator() : generateSecureOtp();
  const commandId = typeof deps.idGenerator === 'function'
    ? deps.idGenerator()
    : `cmd_${now}_${crypto.randomBytes(4).toString('hex')}`;

  const expiresAt = now + ttlMs;

  const pendingRecord = {
    commandId,
    command: cmd,
    otpCode,
    createdAt: now,
    expiresAt,
    failedAttempts: 0,
    status: 'PENDING',
    reason: classification.reason
  };

  pendingRequests.set(commandId, pendingRecord);

  return {
    status: 'OTP_REQUIRED',
    otpCode,
    commandId,
    expiresAt,
    ttlSeconds: Math.round(ttlMs / 1000),
    reason: classification.reason,
    command: cmd
  };
}

/**
 * Validates OTP and executes the pending critical command if valid.
 *
 * @param {string} commandIdOrOtp - Command ID or OTP if only 1 request is pending
 * @param {string} [otpCodeOptional] - OTP code
 * @param {object} [deps={}] - Injected dependencies
 * @returns {Promise<object>}
 */
export async function confirmAndExecute(commandIdOrOtp, otpCodeOptional, deps = {}) {
  let commandId = commandIdOrOtp;
  let otpCode = otpCodeOptional;
  let dependencies = deps;

  // Flexible call signatures:
  // confirmAndExecute(commandId, otpCode, deps) OR confirmAndExecute(otpCode, deps)
  if (typeof otpCodeOptional === 'object' && otpCodeOptional !== null) {
    dependencies = otpCodeOptional;
    otpCode = undefined;
  }

  if (!otpCode && typeof commandIdOrOtp === 'string' && /^\d{4,8}$/.test(commandIdOrOtp.trim())) {
    // If only an OTP code is passed, resolve the active pending request
    const pendingList = listPendingExecutions(dependencies);
    if (pendingList.length === 1) {
      commandId = pendingList[0].commandId;
      otpCode = commandIdOrOtp.trim();
    } else if (pendingList.length > 1) {
      return {
        status: 'AMBIGUOUS_REQUEST',
        error: 'Multiple commands are pending authorization. Please specify commandId.',
        stdout: '',
        stderr: ''
      };
    } else {
      return {
        status: 'NOT_FOUND',
        error: 'No pending command found matching authorization request',
        stdout: '',
        stderr: ''
      };
    }
  }

  if (!commandId || typeof commandId !== 'string') {
    return {
      status: 'NOT_FOUND',
      error: 'Invalid or missing commandId',
      stdout: '',
      stderr: ''
    };
  }

  const record = pendingRequests.get(commandId);
  if (!record || record.status !== 'PENDING') {
    return {
      status: 'NOT_FOUND',
      error: 'No active pending command found for specified commandId',
      stdout: '',
      stderr: ''
    };
  }

  const now = typeof dependencies.now === 'function' ? dependencies.now() : Date.now();

  // Check TTL expiration
  if (now > record.expiresAt) {
    record.status = 'EXPIRED';
    pendingRequests.delete(commandId);
    return {
      status: 'EXPIRED',
      error: 'OTP code has expired. Please re-request command execution.',
      stdout: '',
      stderr: ''
    };
  }

  // Validate OTP using timing-safe comparison
  const strOtp = typeof otpCode === 'string' ? otpCode.trim() : '';
  const expectedBuf = Buffer.from(record.otpCode, 'utf-8');
  const actualBuf = Buffer.from(strOtp, 'utf-8');

  const matches = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

  if (!matches) {
    record.failedAttempts++;

    if (record.failedAttempts >= MAX_OTP_ATTEMPTS) {
      record.status = 'LOCKED';
      pendingRequests.delete(commandId);
      return {
        status: 'INVALID_OTP',
        error: 'Maximum OTP verification attempts exceeded. Request cancelled.',
        locked: true,
        attemptsRemaining: 0,
        stdout: '',
        stderr: ''
      };
    }

    const attemptsRemaining = MAX_OTP_ATTEMPTS - record.failedAttempts;
    return {
      status: 'INVALID_OTP',
      error: `Invalid OTP code. ${attemptsRemaining} attempt(s) remaining.`,
      locked: false,
      attemptsRemaining,
      stdout: '',
      stderr: ''
    };
  }

  // OTP verified successfully; execute critical command
  record.status = 'EXECUTED';
  pendingRequests.delete(commandId);

  const execResult = await executeBashCommand(record.command, dependencies);

  return {
    status: 'EXECUTED',
    command: record.command,
    commandId,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    exitCode: execResult.exitCode,
    durationMs: execResult.durationMs,
    ok: execResult.ok
  };
}

/**
 * Cancels a pending authorization request.
 *
 * @param {string} commandId
 * @returns {{ status: 'CANCELLED'|'NOT_FOUND', commandId: string }}
 */
export function cancelPendingExecution(commandId) {
  if (typeof commandId !== 'string') {
    return { status: 'NOT_FOUND', commandId };
  }

  const record = pendingRequests.get(commandId);
  if (!record || record.status !== 'PENDING') {
    return { status: 'NOT_FOUND', commandId };
  }

  record.status = 'CANCELLED';
  pendingRequests.delete(commandId);

  return { status: 'CANCELLED', commandId };
}

/**
 * Retrieves details of a pending command execution.
 *
 * @param {string} commandId
 * @returns {object|null}
 */
export function getPendingExecution(commandId) {
  if (typeof commandId !== 'string') return null;
  const record = pendingRequests.get(commandId);
  if (!record) return null;

  return {
    commandId: record.commandId,
    command: record.command,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: record.status,
    failedAttempts: record.failedAttempts,
    reason: record.reason
  };
}

/**
 * Lists all active pending execution records, pruning expired ones.
 *
 * @param {object} [deps={}]
 * @returns {Array<object>}
 */
export function listPendingExecutions(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const active = [];

  for (const [id, record] of pendingRequests.entries()) {
    if (record.status === 'PENDING') {
      if (now > record.expiresAt) {
        record.status = 'EXPIRED';
        pendingRequests.delete(id);
      } else {
        active.push(getPendingExecution(id));
      }
    }
  }

  return active;
}

/**
 * Clears all pending executions. Primarily intended for testing isolation.
 */
export function clearPendingExecutions() {
  pendingRequests.clear();
}
