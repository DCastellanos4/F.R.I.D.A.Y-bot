import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ROOT_DIR = __dirname;
export const DEFAULT_DATA_DIR = path.resolve(__dirname, 'data');
export const DEFAULT_BACKUP_DIR = path.resolve(DEFAULT_DATA_DIR, 'backups');

export const DAVBAK_MAGIC = Buffer.from('DAVBAK01', 'ascii');
export const HEADER_SIZE = 52;
export const SALT_SIZE = 16;
export const IV_SIZE = 12;
export const TAG_SIZE = 16;

let activeScheduledBackup = null;

/**
 * Derives a 256-bit AES key from a passphrase and salt using scrypt.
 *
 * @param {string|Buffer} passphrase
 * @param {Buffer} salt - 16-byte salt
 * @param {object} [deps]
 * @returns {Buffer} 32-byte key
 */
export function deriveKey(passphrase, salt, deps = {}) {
  const cryptoImpl = deps.crypto || crypto;
  const pass = typeof passphrase === 'string' ? passphrase : String(passphrase || '');
  if (!pass) {
    throw new Error('Passphrase is required for key derivation');
  }
  return cryptoImpl.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Generates standard backup filename with timestamp.
 * Format: backup_YYYYMMDD_HHmmss.davbak
 *
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function generateBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `backup_${yyyy}${MM}${dd}_${HH}${mm}${ss}.davbak`;
}

/**
 * Determines whether a relative file path attempts path traversal outside the destination.
 *
 * @param {string} relPath
 * @param {string} destDir
 * @returns {boolean} True if path traversal is detected
 */
export function isPathTraversal(relPath, destDir) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return true;
  }
  const normalizedSlashes = relPath.replace(/\\/g, '/');
  const segments = normalizedSlashes.split('/');
  if (segments.includes('..')) {
    return true;
  }
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || normalizedSlashes.startsWith('/')) {
    return true;
  }
  const resolvedDest = path.resolve(destDir);
  const resolvedTarget = path.resolve(resolvedDest, relPath);
  const relative = path.relative(resolvedDest, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return true;
  }
  return false;
}

/**
 * Collects default project files from data/ and configs for backup.
 *
 * @param {string} rootDir
 * @param {string} dataDir
 * @param {Array<string>} [customSourceDirs]
 * @param {Array<string>} [configFiles]
 * @param {Array<string|RegExp>} [excludePatterns]
 * @param {object} fsImpl
 * @returns {Record<string, Buffer>} Map of relative path to Buffer content
 */
function collectDefaultBackupFiles(rootDir, dataDir, customSourceDirs, configFiles, excludePatterns, fsImpl) {
  const files = {};
  const root = path.resolve(rootDir);

  function walk(currentDir) {
    if (!fsImpl.existsSync(currentDir)) return;
    const entries = fsImpl.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (
          entry.name === 'backups' ||
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'temp_downloads'
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.davbak') || entry.name.endsWith('.tmp')) {
          continue;
        }
        let excluded = false;
        if (Array.isArray(excludePatterns)) {
          for (const pattern of excludePatterns) {
            if (pattern instanceof RegExp && pattern.test(relPath)) {
              excluded = true;
              break;
            }
            if (typeof pattern === 'string' && (relPath.includes(pattern) || entry.name === pattern)) {
              excluded = true;
              break;
            }
          }
        }
        if (!excluded) {
          try {
            files[relPath] = fsImpl.readFileSync(fullPath);
          } catch {
            // Ignore unreadable file
          }
        }
      }
    }
  }

  if (dataDir && fsImpl.existsSync(dataDir)) {
    walk(dataDir);
  }

  if (Array.isArray(customSourceDirs)) {
    for (const src of customSourceDirs) {
      const resolvedSrc = path.resolve(root, src);
      if (resolvedSrc !== path.resolve(dataDir) && fsImpl.existsSync(resolvedSrc)) {
        walk(resolvedSrc);
      }
    }
  }

  const defaultConfigs = ['package.json', '.env', '.env.example'];
  const configsToScan = Array.isArray(configFiles) ? configFiles : defaultConfigs;
  for (const cfg of configsToScan) {
    const cfgPath = path.isAbsolute(cfg) ? cfg : path.resolve(root, cfg);
    if (fsImpl.existsSync(cfgPath)) {
      try {
        if (fsImpl.statSync(cfgPath).isFile()) {
          const relPath = path.relative(root, cfgPath).replace(/\\/g, '/');
          files[relPath] = fsImpl.readFileSync(cfgPath);
        }
      } catch {
        // Ignore unreadable config
      }
    }
  }

  return files;
}

/**
 * Creates an encrypted backup container (.davbak) using AES-256-GCM.
 *
 * Container format:
 * - 0..7: Magic 'DAVBAK01' (8 bytes)
 * - 8..23: Salt (16 bytes)
 * - 24..35: IV (12 bytes)
 * - 36..51: Auth Tag (16 bytes)
 * - 52..end: AES-256-GCM Encrypted Gzip Manifest
 *
 * @param {object} [options]
 * @param {string} [options.passphrase]
 * @param {string} [options.password]
 * @param {string} [options.rootDir=DEFAULT_ROOT_DIR]
 * @param {string} [options.dataDir=DEFAULT_DATA_DIR]
 * @param {string} [options.backupDir=DEFAULT_BACKUP_DIR]
 * @param {string} [options.destinationPath]
 * @param {string} [options.outputPath]
 * @param {Date} [options.date]
 * @param {string} [options.timestamp]
 * @param {Record<string, string|Buffer>} [options.files]
 * @param {Record<string, string|Buffer>} [options.sourceFiles]
 * @param {Array<string>} [options.sourceDirs]
 * @param {Array<string>} [options.configFiles]
 * @param {Array<string|RegExp>} [options.excludePatterns]
 * @param {Buffer} [options.salt]
 * @param {Buffer} [options.iv]
 * @param {boolean} [options.writeToDisk=true]
 * @param {object} [deps]
 * @returns {Promise<{ backupPath: string, sizeBytes: number, sha256: string, fileCount: number, createdAt: string, container?: Buffer }>}
 */
export async function createEncryptedBackup(options = {}, deps = {}) {
  const fsImpl = deps.fs || fs;
  const cryptoImpl = deps.crypto || crypto;
  const zlibImpl = deps.zlib || zlib;

  const passphrase = options.passphrase || options.password || process.env.BACKUP_PASSPHRASE || process.env.DAVIS_BACKUP_KEY;
  if (!passphrase) {
    throw new Error('Backup passphrase is required');
  }

  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  const dataDir = options.dataDir || path.resolve(rootDir, 'data');
  const backupDir = options.backupDir || path.resolve(dataDir, 'backups');

  let sourceFilesMap = {};
  if (options.sourceFiles && typeof options.sourceFiles === 'object') {
    sourceFilesMap = options.sourceFiles;
  } else if (options.files && typeof options.files === 'object') {
    sourceFilesMap = options.files;
  } else {
    sourceFilesMap = collectDefaultBackupFiles(
      rootDir,
      dataDir,
      options.sourceDirs,
      options.configFiles,
      options.excludePatterns,
      fsImpl
    );
  }

  const manifestFiles = Object.entries(sourceFilesMap).map(([relPath, content]) => {
    const buf = Buffer.isBuffer(content)
      ? content
      : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    return {
      path: relPath.replace(/\\/g, '/'),
      content: buf.toString('base64'),
      size: buf.length
    };
  });

  const createdAt = (options.timestamp ? new Date(options.timestamp) : (options.date || new Date())).toISOString();
  const manifest = {
    version: '1.0',
    createdAt,
    files: manifestFiles
  };

  const manifestJson = JSON.stringify(manifest);
  const compressedPayload = zlibImpl.gzipSync(Buffer.from(manifestJson, 'utf8'));

  const salt = options.salt || cryptoImpl.randomBytes(SALT_SIZE);
  const iv = options.iv || cryptoImpl.randomBytes(IV_SIZE);
  const key = deriveKey(passphrase, salt, deps);

  const cipher = cryptoImpl.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(compressedPayload),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  const container = Buffer.concat([
    DAVBAK_MAGIC,
    salt,
    iv,
    authTag,
    ciphertext
  ]);

  const sha256 = cryptoImpl.createHash('sha256').update(container).digest('hex');

  let backupPath = options.destinationPath || options.outputPath;
  if (!backupPath) {
    const filename = generateBackupFilename(options.date || new Date(createdAt));
    backupPath = path.join(backupDir, filename);
  }

  if (options.writeToDisk !== false) {
    const targetDir = path.dirname(backupPath);
    if (!fsImpl.existsSync(targetDir)) {
      fsImpl.mkdirSync(targetDir, { recursive: true });
    }
    fsImpl.writeFileSync(backupPath, container);
  }

  return {
    backupPath,
    sizeBytes: container.length,
    sha256,
    fileCount: manifestFiles.length,
    createdAt,
    container: options.writeToDisk === false ? container : undefined
  };
}

/**
 * Decrypts and extracts a DAVBAK01 container to destination directory with strict path traversal checks.
 *
 * @param {string|Buffer} backupPath - Absolute file path or raw Buffer.
 * @param {string} password - Master passphrase.
 * @param {string} destinationDir - Target extraction directory.
 * @param {object} [deps]
 * @returns {Promise<{ success: boolean, restoredFiles: Array<string>, manifest: { version: string, createdAt: string, fileCount: number } }>}
 */
export async function restoreEncryptedBackup(backupPath, password, destinationDir, deps = {}) {
  const fsImpl = deps.fs || fs;
  const cryptoImpl = deps.crypto || crypto;
  const zlibImpl = deps.zlib || zlib;

  if (!backupPath) {
    throw new Error('Backup path or buffer is required for restore');
  }
  if (!password || (typeof password === 'string' && !password.trim())) {
    throw new Error('Passphrase is required for restore');
  }
  if (!destinationDir) {
    throw new Error('Destination directory is required for restore');
  }

  let containerBuffer;
  if (Buffer.isBuffer(backupPath)) {
    containerBuffer = backupPath;
  } else if (typeof backupPath === 'string') {
    if (!fsImpl.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    containerBuffer = fsImpl.readFileSync(backupPath);
  } else {
    throw new Error('Invalid backupPath parameter: expected string path or Buffer');
  }

  if (containerBuffer.length < HEADER_SIZE) {
    throw new Error(`Invalid backup container: buffer too short (${containerBuffer.length} bytes, minimum ${HEADER_SIZE} bytes required)`);
  }

  const magic = containerBuffer.subarray(0, 8);
  if (!magic.equals(DAVBAK_MAGIC)) {
    throw new Error(`Invalid backup container: invalid magic bytes '${magic.toString('ascii')}', expected 'DAVBAK01'`);
  }

  const salt = containerBuffer.subarray(8, 24);
  const iv = containerBuffer.subarray(24, 36);
  const authTag = containerBuffer.subarray(36, 52);
  const ciphertext = containerBuffer.subarray(52);

  if (ciphertext.length === 0) {
    throw new Error('Invalid backup container: encrypted ciphertext payload is empty');
  }

  const key = deriveKey(password, salt, deps);

  let decryptedPayload;
  try {
    const decipher = cryptoImpl.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decryptedPayload = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
  } catch (err) {
    throw new Error(`Decryption failed: authentication tag verification failed or incorrect passphrase (${err.message})`);
  }

  let decompressed;
  try {
    decompressed = zlibImpl.gunzipSync(decryptedPayload);
  } catch (err) {
    throw new Error(`Decompression failed: archive payload corrupted (${err.message})`);
  }

  let manifest;
  try {
    manifest = JSON.parse(decompressed.toString('utf8'));
  } catch (err) {
    throw new Error(`Corrupted manifest: failed to parse JSON (${err.message})`);
  }

  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error('Corrupted manifest: missing files array');
  }

  const normalizedDest = path.resolve(destinationDir);

  // Pre-validate all file paths before writing anything to disk (atomic security check)
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string') {
      throw new Error('Manifest entry missing valid path');
    }
    if (isPathTraversal(file.path, normalizedDest)) {
      throw new Error(`Path traversal detected in backup archive: ${file.path}`);
    }
  }

  if (!fsImpl.existsSync(normalizedDest)) {
    fsImpl.mkdirSync(normalizedDest, { recursive: true });
  }

  const restoredFiles = [];
  for (const file of manifest.files) {
    const targetPath = path.resolve(normalizedDest, file.path);
    const parentDir = path.dirname(targetPath);
    if (!fsImpl.existsSync(parentDir)) {
      fsImpl.mkdirSync(parentDir, { recursive: true });
    }

    const fileContent = typeof file.content === 'string'
      ? Buffer.from(file.content, 'base64')
      : Buffer.from(file.content || '');

    fsImpl.writeFileSync(targetPath, fileContent);
    restoredFiles.push(file.path);
  }

  return {
    success: true,
    restoredFiles,
    manifest: {
      version: manifest.version || '1.0',
      createdAt: manifest.createdAt,
      fileCount: restoredFiles.length
    }
  };
}

/**
 * Validates container integrity and inspects manifest without extracting to disk.
 *
 * @param {string|Buffer} backupPathOrBuffer
 * @param {string} password
 * @param {object} [deps]
 * @returns {Promise<{ valid: boolean, fileCount: number, createdAt: string, version: string, files: Array<string> }>}
 */
export async function verifyBackupContainer(backupPathOrBuffer, password, deps = {}) {
  const fsImpl = deps.fs || fs;
  const cryptoImpl = deps.crypto || crypto;
  const zlibImpl = deps.zlib || zlib;

  let containerBuffer;
  if (Buffer.isBuffer(backupPathOrBuffer)) {
    containerBuffer = backupPathOrBuffer;
  } else if (typeof backupPathOrBuffer === 'string') {
    if (!fsImpl.existsSync(backupPathOrBuffer)) {
      throw new Error(`Backup file not found: ${backupPathOrBuffer}`);
    }
    containerBuffer = fsImpl.readFileSync(backupPathOrBuffer);
  } else {
    throw new Error('Invalid backup container: expected file path or Buffer');
  }

  if (containerBuffer.length < HEADER_SIZE) {
    throw new Error(`Invalid container: buffer too short (${containerBuffer.length} bytes, minimum ${HEADER_SIZE} required)`);
  }

  const magic = containerBuffer.subarray(0, 8);
  if (!magic.equals(DAVBAK_MAGIC)) {
    throw new Error(`Invalid container: magic mismatch (expected 'DAVBAK01', got '${magic.toString('ascii')}')`);
  }

  const salt = containerBuffer.subarray(8, 24);
  const iv = containerBuffer.subarray(24, 36);
  const authTag = containerBuffer.subarray(36, 52);
  const ciphertext = containerBuffer.subarray(52);

  if (ciphertext.length === 0) {
    throw new Error('Invalid container: encrypted ciphertext payload is empty');
  }

  if (!password || (typeof password === 'string' && !password.trim())) {
    throw new Error('Passphrase is required for container verification');
  }

  const key = deriveKey(password, salt, deps);

  let decrypted;
  try {
    const decipher = cryptoImpl.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new Error(`Decryption failed: authentication tag verification failed or incorrect passphrase (${err.message})`);
  }

  let decompressed;
  try {
    decompressed = zlibImpl.gunzipSync(decrypted);
  } catch (err) {
    throw new Error(`Decompression failed: archive payload corrupted (${err.message})`);
  }

  let manifest;
  try {
    manifest = JSON.parse(decompressed.toString('utf8'));
  } catch (err) {
    throw new Error(`Corrupted manifest: failed to parse JSON (${err.message})`);
  }

  return {
    valid: true,
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    createdAt: manifest.createdAt,
    version: manifest.version,
    files: Array.isArray(manifest.files) ? manifest.files.map(f => f.path) : []
  };
}

/**
 * Lists all .davbak backup files in directory sorted newest first.
 *
 * @param {string} [backupDir=DEFAULT_BACKUP_DIR]
 * @param {object} [deps]
 * @returns {Array<{ filename: string, fullPath: string, sizeBytes: number, mtime: Date, createdAt: Date }>}
 */
export function listBackups(backupDir = DEFAULT_BACKUP_DIR, deps = {}) {
  const fsImpl = deps.fs || fs;
  if (!fsImpl.existsSync(backupDir)) {
    return [];
  }
  const entries = fsImpl.readdirSync(backupDir, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.davbak')) {
      const fullPath = path.join(backupDir, entry.name);
      try {
        const stats = fsImpl.statSync(fullPath);
        backups.push({
          filename: entry.name,
          fullPath,
          sizeBytes: stats.size,
          mtime: stats.mtime,
          createdAt: stats.birthtime || stats.mtime
        });
      } catch {
        // Skip inaccessible file
      }
    }
  }

  backups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return backups;
}

/**
 * Prunes older backups beyond keepCount threshold.
 *
 * @param {string} [backupDir=DEFAULT_BACKUP_DIR]
 * @param {number} [keepCount=5]
 * @param {object} [deps]
 * @returns {{ deletedCount: number, remainingCount: number, deletedFiles: Array<string> }}
 */
export function pruneOldBackups(backupDir = DEFAULT_BACKUP_DIR, keepCount = 5, deps = {}) {
  const fsImpl = deps.fs || fs;
  const backups = listBackups(backupDir, deps);
  const deletedFiles = [];

  if (backups.length > keepCount) {
    const toDelete = backups.slice(keepCount);
    for (const b of toDelete) {
      try {
        fsImpl.unlinkSync(b.fullPath);
        deletedFiles.push(b.filename);
      } catch {
        // Skip unlink error
      }
    }
  }

  return {
    deletedCount: deletedFiles.length,
    remainingCount: backups.length - deletedFiles.length,
    deletedFiles
  };
}

/**
 * Schedules automated periodic backups using node-cron.
 *
 * @param {object} [options]
 * @param {string} [options.cronExpression='0 3 * * *'] - Daily at 03:00 Madrid time
 * @param {string} [options.timezone='Europe/Madrid']
 * @param {boolean} [options.enabled=true]
 * @param {Function} [options.onSuccess]
 * @param {Function} [options.onError]
 * @param {number} [options.retentionCount]
 * @param {object} [deps]
 * @returns {{ cronExpression: string, timezone: string, task: object|null, stop: Function, start: Function, runNow: Function }}
 */
export function scheduleAutomatedBackup(options = {}, deps = {}) {
  const cronLib = deps.cron || cron;
  const cronExpression = options.cronExpression || '0 3 * * *';
  const timezone = options.timezone || 'Europe/Madrid';
  const enabled = options.enabled !== false;

  let task = null;
  if (enabled && cronLib && typeof cronLib.schedule === 'function') {
    task = cronLib.schedule(
      cronExpression,
      async () => {
        try {
          const result = await createEncryptedBackup(options, deps);
          if (options.retentionCount && options.retentionCount > 0) {
            const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
            pruneOldBackups(backupDir, options.retentionCount, deps);
          }
          if (typeof options.onSuccess === 'function') {
            options.onSuccess(result);
          }
          return result;
        } catch (err) {
          if (typeof options.onError === 'function') {
            options.onError(err);
          }
        }
      },
      { timezone }
    );
  }

  const controller = {
    cronExpression,
    timezone,
    task,
    stop: () => {
      if (task && typeof task.stop === 'function') {
        task.stop();
      }
    },
    start: () => {
      if (task && typeof task.start === 'function') {
        task.start();
      }
    },
    runNow: async () => {
      return await createEncryptedBackup(options, deps);
    }
  };

  activeScheduledBackup = controller;
  return controller;
}

/**
 * Stops the globally active scheduled backup task.
 *
 * @returns {boolean} True if a scheduled task was stopped
 */
export function stopScheduledBackup() {
  if (activeScheduledBackup) {
    activeScheduledBackup.stop();
    activeScheduledBackup = null;
    return true;
  }
  return false;
}
