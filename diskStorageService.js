import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './sysCommandRunner.js';
import { enqueueAlert as defaultEnqueueAlert } from './alertQueueService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_TEMP_DOWNLOADS_DIR = path.resolve(__dirname, 'data', 'temp_downloads');
export const DEFAULT_STORAGE_THRESHOLD_PERCENT = 85;

/**
 * Normalizes mount path across operating systems (resolves root on Windows if '/' is passed).
 *
 * @param {string} [mountPath='/']
 * @returns {string}
 */
export function resolveMountPath(mountPath = '/') {
  if (process.platform === 'win32' && (mountPath === '/' || !mountPath)) {
    return path.parse(process.cwd()).root || 'C:\\';
  }
  return mountPath || '/';
}

/**
 * Formats a byte count into a human-readable string without emojis.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Parses reclaimed space from 'docker system prune -f' output.
 * Example string: "Total reclaimed space: 1.842GB"
 *
 * @param {string} stdout - Output from docker prune
 * @returns {number} Reclaimed bytes
 */
export function parseDockerPruneReclaimedBytes(stdout = '') {
  if (typeof stdout !== 'string') return 0;
  const match = stdout.match(/Total reclaimed space:\s*([\d.]+)\s*([KMGTP]?B)/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024
  };

  const multiplier = multipliers[unit] || 1;
  return Math.round(value * multiplier);
}

/**
 * Inspects disk storage metrics using native fs.statfsSync.
 *
 * @param {string} [mountPath='/'] - Mount point or path to inspect
 * @param {object} [deps={}] - Dependency injection options
 * @param {Function} [deps.statfsSync] - Injected statfsSync function
 * @returns {{ totalBytes: number, freeBytes: number, usedBytes: number, percentUsed: number, mountPath: string }}
 */
export function checkDiskUsage(mountPath = '/', deps = {}) {
  const statfsFn = deps.statfsSync || deps.fs?.statfsSync || fs.statfsSync;
  const resolvedPath = resolveMountPath(mountPath);

  const stats = statfsFn(resolvedPath);
  const bsize = stats.bsize || 4096;
  const blocks = stats.blocks || 0;
  const bfree = typeof stats.bavail === 'number' ? stats.bavail : (stats.bfree || 0);

  const totalBytes = blocks * bsize;
  const freeBytes = bfree * bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  let percentUsed = 0;
  if (totalBytes > 0) {
    percentUsed = Number(((usedBytes / totalBytes) * 100).toFixed(2));
  }

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    percentUsed,
    mountPath: resolvedPath
  };
}

/**
 * Cleans up temporary download files in the local downloads directory.
 *
 * @param {string} [dirPath] - Path to directory to clean
 * @param {object} [deps={}] - Dependency overrides
 * @returns {{ deletedCount: number, reclaimedBytes: number, directory: string }}
 */
export function cleanTempDownloads(dirPath, deps = {}) {
  const targetDir = dirPath || deps.tempDownloadsDir || DEFAULT_TEMP_DOWNLOADS_DIR;
  const fsImpl = deps.fs || fs;
  const existsSyncFn = deps.existsSync || fsImpl.existsSync.bind(fsImpl);
  const readdirSyncFn = deps.readdirSync || fsImpl.readdirSync.bind(fsImpl);
  const statSyncFn = deps.statSync || fsImpl.statSync.bind(fsImpl);
  const unlinkSyncFn = deps.unlinkSync || fsImpl.unlinkSync.bind(fsImpl);

  if (!existsSyncFn(targetDir)) {
    return {
      deletedCount: 0,
      reclaimedBytes: 0,
      directory: targetDir
    };
  }

  let deletedCount = 0;
  let reclaimedBytes = 0;

  try {
    const entries = readdirSyncFn(targetDir);
    for (const entry of entries) {
      const fullPath = path.join(targetDir, entry);
      try {
        const fileStat = statSyncFn(fullPath);
        if (fileStat.isFile()) {
          const size = fileStat.size || 0;
          unlinkSyncFn(fullPath);
          deletedCount++;
          reclaimedBytes += size;
        }
      } catch {
        // Continue cleaning other files if one fails
      }
    }
  } catch {
    // Non-fatal if directory reading fails
  }

  return {
    deletedCount,
    reclaimedBytes,
    directory: targetDir
  };
}

/**
 * Internal command runner dispatcher.
 */
async function executeCommand(cmd, args, options = {}, deps = {}) {
  const runner = deps.sysCommandRunner?.runCommand || deps.runCommand || runCommand;
  return runner(cmd, args, options, deps);
}

/**
 * Executes the 4-step storage purge pipeline:
 * 1. pm2 flush
 * 2. apt-get clean
 * 3. docker system prune -f
 * 4. local temp downloads cleanup (data/temp_downloads/)
 *
 * @param {object} [deps={}] - Dependency injection options
 * @returns {Promise<{
 *   reclaimedBytes: number,
 *   details: Array<string>,
 *   steps: Array<{ step: string, success: boolean, output: string, reclaimedBytes?: number, deletedCount?: number }>
 * }>}
 */
export async function purgeDisk(deps = {}) {
  const details = [];
  const steps = [];
  let estimatedReclaimedBytes = 0;

  // Step 1: pm2 flush
  try {
    const pm2Res = await executeCommand('pm2', ['flush'], { timeoutMs: 15000 }, deps);
    const success = pm2Res.ok;
    steps.push({
      step: 'pm2_flush',
      success,
      output: pm2Res.stdout || pm2Res.stderr || ''
    });
    details.push(`Paso 1 (pm2 flush): ${success ? 'Completado' : 'Fallo o no instalado'}`);
  } catch (err) {
    steps.push({
      step: 'pm2_flush',
      success: false,
      output: err.message
    });
    details.push(`Paso 1 (pm2 flush): Error - ${err.message}`);
  }

  // Step 2: apt-get clean
  try {
    const aptRes = await executeCommand('apt-get', ['clean'], { timeoutMs: 15000 }, deps);
    const success = aptRes.ok;
    steps.push({
      step: 'apt_clean',
      success,
      output: aptRes.stdout || aptRes.stderr || ''
    });
    details.push(`Paso 2 (apt-get clean): ${success ? 'Completado' : 'Fallo o no disponible'}`);
  } catch (err) {
    steps.push({
      step: 'apt_clean',
      success: false,
      output: err.message
    });
    details.push(`Paso 2 (apt-get clean): Error - ${err.message}`);
  }

  // Step 3: docker system prune -f
  try {
    const dockerRes = await executeCommand('docker', ['system', 'prune', '-f'], { timeoutMs: 30000 }, deps);
    const success = dockerRes.ok;
    const dockerReclaimed = parseDockerPruneReclaimedBytes(dockerRes.stdout);
    estimatedReclaimedBytes += dockerReclaimed;
    steps.push({
      step: 'docker_prune',
      success,
      output: dockerRes.stdout || dockerRes.stderr || '',
      reclaimedBytes: dockerReclaimed
    });
    details.push(
      `Paso 3 (docker system prune): ${success ? 'Completado' : 'Fallo'} - Espacio liberado: ${formatBytes(dockerReclaimed)}`
    );
  } catch (err) {
    steps.push({
      step: 'docker_prune',
      success: false,
      output: err.message,
      reclaimedBytes: 0
    });
    details.push(`Paso 3 (docker system prune): Error - ${err.message}`);
  }

  // Step 4: Local temporary downloads cleanup
  try {
    const tempResult = cleanTempDownloads(deps.tempDownloadsDir, deps);
    estimatedReclaimedBytes += tempResult.reclaimedBytes;
    steps.push({
      step: 'temp_clean',
      success: true,
      output: `Archivos eliminados: ${tempResult.deletedCount}`,
      deletedCount: tempResult.deletedCount,
      reclaimedBytes: tempResult.reclaimedBytes
    });
    details.push(
      `Paso 4 (temp downloads): Eliminados ${tempResult.deletedCount} archivos (${formatBytes(tempResult.reclaimedBytes)})`
    );
  } catch (err) {
    steps.push({
      step: 'temp_clean',
      success: false,
      output: err.message,
      deletedCount: 0,
      reclaimedBytes: 0
    });
    details.push(`Paso 4 (temp downloads): Error - ${err.message}`);
  }

  return {
    reclaimedBytes: estimatedReclaimedBytes,
    details,
    steps
  };
}

/**
 * Checks storage utilization against threshold (default 85%). If exceeded, executes
 * the 4-step purge pipeline, recalculates disk usage, computes delta of reclaimed bytes,
 * and emits a zero-emoji notification.
 *
 * Escalation:
 * - If post-purge usage remains > threshold: Emits CRITICAL_STORAGE_ALERT with priority 'urgent'.
 * - If post-purge usage drops <= threshold: Emits standard notification with priority 'high'.
 *
 * @param {number} [thresholdPercent=85] - Percentage threshold triggering purge
 * @param {object} [deps={}] - Dependency injection options
 * @param {string} [deps.mountPath='/'] - Target filesystem mount path
 * @returns {Promise<{
 *   triggered: boolean,
 *   thresholdPercent: number,
 *   initialUsage: object,
 *   postUsage: object,
 *   reclaimedBytes: number,
 *   details: Array<string>,
 *   steps?: Array<object>,
 *   isStillCritical: boolean,
 *   alertDispatched: boolean
 * }>}
 */
export async function checkAndPurgeIfExceeded(thresholdPercent = DEFAULT_STORAGE_THRESHOLD_PERCENT, deps = {}) {
  const mountPath = resolveMountPath(deps.mountPath || '/');
  const threshold = typeof thresholdPercent === 'number' ? thresholdPercent : DEFAULT_STORAGE_THRESHOLD_PERCENT;

  // Initial inspection
  const initialUsage = checkDiskUsage(mountPath, deps);

  // Boundary check: strictly greater than thresholdPercent
  if (initialUsage.percentUsed <= threshold) {
    return {
      triggered: false,
      thresholdPercent: threshold,
      initialUsage,
      postUsage: initialUsage,
      reclaimedBytes: 0,
      details: ['Uso de almacenamiento por debajo del umbral configurado. Purga no requerida.'],
      isStillCritical: false,
      alertDispatched: false
    };
  }

  // Threshold exceeded: execute 4-step purge pipeline
  const purgeResult = await purgeDisk(deps);

  // Re-inspect usage post-purge
  const postUsage = checkDiskUsage(mountPath, deps);

  // Calculate actual reclaimed bytes: prioritize physical statfs delta if available
  let reclaimedBytes = 0;
  if (initialUsage.usedBytes > postUsage.usedBytes) {
    reclaimedBytes = initialUsage.usedBytes - postUsage.usedBytes;
  } else {
    reclaimedBytes = purgeResult.reclaimedBytes;
  }

  const isStillCritical = postUsage.percentUsed > threshold;
  const enqueueFn = deps.enqueueAlert || (deps.alertCaptureMock ? (a) => deps.alertCaptureMock.capture(a) : defaultEnqueueAlert);

  if (isStillCritical) {
    enqueueFn({
      title: '[DISCO] ALERTA CRITICA: Espacio insuficiente tras purga',
      details: [
        `Uso de disco critico en ${mountPath}.`,
        `Nivel inicial: ${initialUsage.percentUsed.toFixed(1)}%`,
        `Nivel actual tras purga: ${postUsage.percentUsed.toFixed(1)}% (Umbral: ${threshold}%)`,
        `Espacio total: ${formatBytes(postUsage.totalBytes)} | Libre: ${formatBytes(postUsage.freeBytes)}`,
        `Espacio liberado durante purga: ${formatBytes(reclaimedBytes)}`,
        'Accion requerida: El sistema continua superando el 85%. Se precisa intervencion manual urgente para ampliar almacenamiento.'
      ].join('\n'),
      priority: 'urgent',
      mountPath,
      initialPercent: initialUsage.percentUsed,
      postPercent: postUsage.percentUsed,
      reclaimedBytes,
      isStillCritical: true
    }, { queuePath: deps.alertQueuePath });
  } else {
    enqueueFn({
      title: '[DISCO] Purga automatica de almacenamiento completada',
      details: [
        `Purga automatica ejecutada exitosamente en ${mountPath}.`,
        `Nivel inicial: ${initialUsage.percentUsed.toFixed(1)}%`,
        `Nivel actual recuperado: ${postUsage.percentUsed.toFixed(1)}% (Umbral: ${threshold}%)`,
        `Espacio liberado: ${formatBytes(reclaimedBytes)}`,
        'Pasos realizados: rotacion de logs PM2, limpieza apt-get, docker system prune y temporales locales.'
      ].join('\n'),
      priority: 'high',
      mountPath,
      initialPercent: initialUsage.percentUsed,
      postPercent: postUsage.percentUsed,
      reclaimedBytes,
      isStillCritical: false
    }, { queuePath: deps.alertQueuePath });
  }

  return {
    triggered: true,
    thresholdPercent: threshold,
    initialUsage,
    postUsage,
    reclaimedBytes,
    details: purgeResult.details,
    steps: purgeResult.steps,
    isStillCritical,
    alertDispatched: true
  };
}
