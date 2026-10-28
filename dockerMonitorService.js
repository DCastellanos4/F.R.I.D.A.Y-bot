import { runCommand } from './sysCommandRunner.js';
import { enqueueAlert as defaultEnqueueAlert } from './alertQueueService.js';

/**
 * In-memory registry tracking container restart history for circuit-breaker
 * and flapping loop detection.
 * Maps containerIdentifier -> Array<number> (timestamps in ms).
 */
const restartHistoryRegistry = new Map();

/**
 * Resets the global container restart history registry.
 * Primarily useful for isolating tests.
 */
export function resetRestartHistory() {
  restartHistoryRegistry.clear();
}

/**
 * Evaluates whether a container is allowed to restart under the sliding-window
 * rate limiter (circuit breaker).
 *
 * Default policy: Maximum 3 restart attempts in a 10-minute (600,000 ms) window.
 *
 * @param {string} containerIdOrName - Identifier for the container
 * @param {number} [windowMs=600000] - Sliding window duration in milliseconds
 * @param {number} [maxAttempts=3] - Maximum allowed restart attempts in window
 * @param {object} [deps={}] - Dependency overrides
 * @returns {{ allowed: boolean, attempts: number, reason?: string }}
 */
export function canRestart(containerIdOrName, windowMs = 600000, maxAttempts = 3, deps = {}) {
  if (!containerIdOrName || typeof containerIdOrName !== 'string') {
    return { allowed: false, attempts: 0, reason: 'INVALID_CONTAINER_ID' };
  }

  const historyMap = deps.restartHistory || restartHistoryRegistry;
  const now = typeof deps.now === 'function' ? deps.now() : (typeof deps.now === 'number' ? deps.now : Date.now());
  const windowStart = now - windowMs;

  const pastTimestamps = historyMap.get(containerIdOrName) || [];
  const activeTimestamps = pastTimestamps.filter((ts) => ts >= windowStart);

  if (activeTimestamps.length >= maxAttempts) {
    return {
      allowed: false,
      attempts: activeTimestamps.length,
      reason: 'MAX_RESTART_ATTEMPTS_EXCEEDED'
    };
  }

  return {
    allowed: true,
    attempts: activeTimestamps.length
  };
}

/**
 * Records a restart attempt for a container in the sliding window history.
 *
 * @param {string} containerIdOrName - Identifier for the container
 * @param {number} [timestamp] - Current timestamp
 * @param {object} [deps={}] - Dependency overrides
 */
export function recordRestart(containerIdOrName, timestamp, deps = {}) {
  if (!containerIdOrName || typeof containerIdOrName !== 'string') {
    return;
  }

  const historyMap = deps.restartHistory || restartHistoryRegistry;
  const ts = typeof timestamp === 'number'
    ? timestamp
    : (typeof deps.now === 'function' ? deps.now() : (typeof deps.now === 'number' ? deps.now : Date.now()));

  const pastTimestamps = historyMap.get(containerIdOrName) || [];
  pastTimestamps.push(ts);
  historyMap.set(containerIdOrName, pastTimestamps);
}

/**
 * Extracts exit code from container status string or inspect object.
 *
 * @param {string} statusStr - Container status string (e.g. 'Exited (1) 45 seconds ago')
 * @param {object} [rawObj={}] - Raw JSON inspect/ps object
 * @returns {number}
 */
export function parseExitCode(statusStr, rawObj = {}) {
  if (typeof rawObj.ExitCode === 'number') {
    return rawObj.ExitCode;
  }
  if (rawObj.State && typeof rawObj.State.ExitCode === 'number') {
    return rawObj.State.ExitCode;
  }

  if (typeof statusStr === 'string') {
    const match = statusStr.match(/\((\d+)\)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    if (/^up\b/i.test(statusStr.trim())) {
      return 0;
    }
  }

  return 0;
}

/**
 * Normalizes container status into standard lifecycle categories:
 * 'running', 'exited', 'restarting', or 'unknown'.
 *
 * @param {string} rawState - Raw state string
 * @param {string} rawStatus - Raw status string
 * @returns {'running'|'exited'|'restarting'|'unknown'}
 */
export function normalizeContainerStatus(rawState = '', rawStatus = '') {
  const s = String(rawState).toLowerCase().trim();
  const st = String(rawStatus).toLowerCase().trim();

  if (s === 'running' || st.startsWith('up')) {
    return 'running';
  }
  if (s === 'restarting' || st.startsWith('restarting')) {
    return 'restarting';
  }
  if (s === 'exited' || st.startsWith('exited') || s === 'dead') {
    return 'exited';
  }

  return 'unknown';
}

/**
 * Internal command runner dispatcher supporting dependency injection.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} options
 * @param {object} deps
 * @returns {Promise<object>}
 */
async function executeCommand(cmd, args, options = {}, deps = {}) {
  const runner = deps.sysCommandRunner?.runCommand || deps.runCommand || runCommand;
  return runner(cmd, args, options, deps);
}

/**
 * Internal alert dispatcher supporting dependency injection.
 *
 * @param {object} alertData
 * @param {object} deps
 */
function dispatchAlert(alertData, deps = {}) {
  const enqueueFn = deps.enqueueAlert || (deps.alertCaptureMock ? (a) => deps.alertCaptureMock.capture(a) : defaultEnqueueAlert);
  return enqueueFn(alertData, { queuePath: deps.alertQueuePath });
}

/**
 * Inspects all Docker containers on the host using 'docker ps -a --format "{{json .}}"'.
 *
 * @param {object} [deps={}] - Dependency injection options
 * @param {Function} [deps.runner] - Injected async command runner
 * @param {Function} [deps.runCommand] - Injected runCommand function
 * @returns {Promise<Array<{ id: string, name: string, status: 'running'|'exited'|'restarting'|'unknown', state: string, uptime: string, exitCode: number, image: string, raw: object }>>}
 */
export async function inspectContainers(deps = {}) {
  const result = await executeCommand(
    'docker',
    ['ps', '-a', '--format', '{{json .}}'],
    { timeoutMs: 15000 },
    deps
  );

  if (!result.ok && result.exitCode !== 0) {
    if (deps.ignoreErrors) {
      return [];
    }
    throw new Error(`Fallo al inspeccionar contenedores Docker (exit code ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  const rawLines = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const containers = [];

  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line);
      const rawId = parsed.ID || parsed.Id || parsed.id || '';
      const rawName = (parsed.Names || parsed.Name || parsed.name || '').replace(/^\//, '');
      const rawState = parsed.State || parsed.state || '';
      const rawStatus = parsed.Status || parsed.status || '';
      const image = parsed.Image || parsed.image || '';
      const uptime = rawStatus || parsed.RunningFor || '';
      const exitCode = parseExitCode(rawStatus, parsed);
      const normalizedStatus = normalizeContainerStatus(rawState, rawStatus);

      containers.push({
        id: rawId,
        name: rawName,
        status: normalizedStatus,
        state: rawState,
        uptime,
        exitCode,
        image,
        raw: parsed
      });
    } catch {
      // Ignore unparseable lines
    }
  }

  return containers;
}

/**
 * Inspects a specific container state via 'docker inspect --format "{{json .State}}" <id>'.
 *
 * @param {string} containerIdOrName
 * @param {object} [deps={}]
 * @returns {Promise<object>} Parsed container State object
 */
export async function inspectContainerState(containerIdOrName, deps = {}) {
  if (!containerIdOrName || typeof containerIdOrName !== 'string') {
    throw new TypeError('Container ID or name must be a non-empty string');
  }

  const result = await executeCommand(
    'docker',
    ['inspect', '--format', '{{json .State}}', containerIdOrName],
    { timeoutMs: 15000 },
    deps
  );

  if (!result.ok && result.exitCode !== 0) {
    throw new Error(`Fallo al inspeccionar estado del contenedor ${containerIdOrName}: ${result.stderr || result.stdout}`);
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch (err) {
    throw new Error(`Respuesta JSON no valida de docker inspect para ${containerIdOrName}: ${err.message}`);
  }
}

/**
 * Attempts to restart a specific container via 'docker restart <containerIdOrName>'.
 *
 * @param {string} containerIdOrName - Identifier for the container
 * @param {object} [deps={}] - Dependency injection options
 * @returns {Promise<{ success: boolean, message: string, exitCode: number }>}
 */
export async function restartContainer(containerIdOrName, deps = {}) {
  if (!containerIdOrName || typeof containerIdOrName !== 'string') {
    return {
      success: false,
      message: 'Identificador de contenedor invalido',
      exitCode: 1
    };
  }

  const result = await executeCommand(
    'docker',
    ['restart', containerIdOrName],
    { timeoutMs: 30000 },
    deps
  );

  if (result.ok && result.exitCode === 0) {
    return {
      success: true,
      message: `Contenedor ${containerIdOrName} reiniciado correctamente.`,
      exitCode: 0
    };
  }

  return {
    success: false,
    message: `Fallo al reiniciar contenedor ${containerIdOrName}: ${result.stderr || result.stdout || 'Error desconocido'}`,
    exitCode: result.exitCode
  };
}

/**
 * Formats a clean, zero-emoji notification alert text.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.id
 * @param {string} params.status
 * @param {number} params.exitCode
 * @param {string} params.uptime
 * @param {string} params.actionResult
 * @returns {string}
 */
export function formatDockerAlertText({ name, id, status, exitCode, uptime, actionResult }) {
  const lines = [
    `[DOCKER] Incidente detectado en contenedor: ${name || id}`,
    `ID: ${id}`,
    `Estado: ${status}`,
    `Codigo de salida: ${exitCode}`,
    `Uptime / Tiempo: ${uptime}`,
    `Accion: ${actionResult}`
  ];
  return lines.join('\n');
}

/**
 * Inspects all containers, detects failures or abnormal states, applies auto-healing
 * restarts where eligible, tracks flapping / circuit breaking, and emits zero-emoji alerts.
 *
 * Categorization:
 * - running: Healthy -> No action.
 * - exited with exitCode === 0: Graceful stop (batch job or deliberate) -> Skipped, no action.
 * - exited with exitCode !== 0 OR restarting: Abnormal -> Auto-heal restart attempted.
 *   - If restart count >= maxAttempts (default 3) in window (default 10 min): Suspended flapping alert.
 *   - Otherwise: 'docker restart <id>' executed and outcome alerted.
 *
 * @param {object} [deps={}] - Dependency overrides
 * @param {number} [deps.maxRestartAttempts=3] - Maximum attempts in sliding window
 * @param {number} [deps.restartWindowMs=600000] - Window duration in ms (10 minutes)
 * @returns {Promise<{
 *   totalInspected: number,
 *   healthyCount: number,
 *   healedCount: number,
 *   failedCount: number,
 *   skippedCount: number,
 *   suspendedCount: number,
 *   actions: Array<object>
 * }>}
 */
export async function checkAndHealContainers(deps = {}) {
  const maxRestartAttempts = typeof deps.maxRestartAttempts === 'number' ? deps.maxRestartAttempts : 3;
  const restartWindowMs = typeof deps.restartWindowMs === 'number' ? deps.restartWindowMs : 600000;
  const now = typeof deps.now === 'function' ? deps.now() : (typeof deps.now === 'number' ? deps.now : Date.now());

  const containers = await inspectContainers(deps);

  let healthyCount = 0;
  let healedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let suspendedCount = 0;
  const actions = [];

  for (const c of containers) {
    // Class 1: Healthy Running
    if (c.status === 'running') {
      healthyCount++;
      actions.push({
        containerId: c.id,
        name: c.name,
        action: 'healthy',
        exitCode: c.exitCode,
        status: c.status,
        success: true
      });
      continue;
    }

    // Class 4: Gracefully Stopped (ExitCode 0)
    if (c.status === 'exited' && c.exitCode === 0) {
      skippedCount++;
      actions.push({
        containerId: c.id,
        name: c.name,
        action: 'skipped_graceful',
        exitCode: c.exitCode,
        status: c.status,
        success: true,
        details: 'Contenedor detenido con codigo 0 (salida limpia o tarea completada)'
      });
      continue;
    }

    // Class 2 & 3: Abnormal Exited (ExitCode != 0) or Restarting / Flapping
    const targetKey = c.id || c.name;
    const breakerCheck = canRestart(targetKey, restartWindowMs, maxRestartAttempts, deps);

    if (!breakerCheck.allowed) {
      suspendedCount++;
      const actionRecord = {
        containerId: c.id,
        name: c.name,
        action: 'suspended_flapping',
        exitCode: c.exitCode,
        status: c.status,
        success: false,
        attemptsInWindow: breakerCheck.attempts,
        details: `Auto-healing suspendido: superado limite de ${maxRestartAttempts} intentos en ${Math.round(restartWindowMs / 60000)} minutos`
      };
      actions.push(actionRecord);

      dispatchAlert({
        title: `[DOCKER] Contenedor en bucle de reinicios: ${c.name || c.id}`,
        details: formatDockerAlertText({
          name: c.name,
          id: c.id,
          status: c.status,
          exitCode: c.exitCode,
          uptime: c.uptime,
          actionResult: `Auto-healing suspendido. Superado limite de ${maxRestartAttempts} intentos en ${Math.round(restartWindowMs / 60000)} minutos.`
        }),
        priority: 'urgent',
        containerId: c.id,
        containerName: c.name,
        exitCode: c.exitCode,
        status: c.status
      }, deps);

      continue;
    }

    // Eligible for auto-healing restart
    recordRestart(targetKey, now, deps);
    const restartResult = await restartContainer(c.id || c.name, deps);

    if (restartResult.success) {
      healedCount++;
      const actionRecord = {
        containerId: c.id,
        name: c.name,
        action: 'restarted',
        exitCode: c.exitCode,
        status: c.status,
        success: true,
        details: restartResult.message
      };
      actions.push(actionRecord);

      dispatchAlert({
        title: `[DOCKER] Auto-healing ejecutado: ${c.name || c.id}`,
        details: formatDockerAlertText({
          name: c.name,
          id: c.id,
          status: c.status,
          exitCode: c.exitCode,
          uptime: c.uptime,
          actionResult: `Reinicio automatico ejecutado con exito: ${restartResult.message}`
        }),
        priority: 'high',
        containerId: c.id,
        containerName: c.name,
        exitCode: c.exitCode,
        status: c.status
      }, deps);
    } else {
      failedCount++;
      const actionRecord = {
        containerId: c.id,
        name: c.name,
        action: 'restart_failed',
        exitCode: c.exitCode,
        status: c.status,
        success: false,
        details: restartResult.message
      };
      actions.push(actionRecord);

      dispatchAlert({
        title: `[DOCKER] Fallo al reiniciar contenedor: ${c.name || c.id}`,
        details: formatDockerAlertText({
          name: c.name,
          id: c.id,
          status: c.status,
          exitCode: c.exitCode,
          uptime: c.uptime,
          actionResult: `Fallo durante el reinicio: ${restartResult.message}`
        }),
        priority: 'urgent',
        containerId: c.id,
        containerName: c.name,
        exitCode: c.exitCode,
        status: c.status
      }, deps);
    }
  }

  return {
    totalInspected: containers.length,
    healthyCount,
    healedCount,
    failedCount,
    skippedCount,
    suspendedCount,
    actions
  };
}
