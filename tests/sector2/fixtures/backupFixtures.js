import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DAVBAK_MAGIC } from '../helpers/s2Validators.js';

/**
 * Backup Test Fixtures for Task 16 (Encrypted Automated Backups & Restore).
 *
 * Implements genuine AES-256-GCM encryption/decryption routines and container builders
 * compliant with the DAVBAK01 binary specification.
 *
 * Strict Policy: Zero Emojis.
 */

export const TEST_BACKUP_PASSPHRASE = 'davis_master_passphrase_testing_2026';

export const SAMPLE_SOURCE_FILES = {
  'data/memories.json': JSON.stringify({
    memories: [
      { id: '1', sujeto: 'router', dato: 'password123', categoria: 'clave' }
    ]
  }),
  'data/reminders.json': JSON.stringify({
    reminders: [
      { id: 'rem-1', text: 'Revisar certificados SSL', time: '10:00' }
    ]
  }),
  'data/notes/2026-10-28_ideas.md': '# Ideas de Arquitectura\n\nOptimizar procesos en PM2 sin acoplamiento de sockets.\n'
};

/**
 * Derives a 256-bit AES key from a passphrase and salt using scrypt.
 *
 * @param {string} passphrase
 * @param {Buffer} salt - 16-byte salt
 * @returns {Buffer} 32-byte key
 */
export function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Creates a genuine, valid DAVBAK01 encrypted container buffer.
 *
 * Container format:
 * - 0..7: Magic 'DAVBAK01' (8 bytes)
 * - 8..23: Salt (16 bytes)
 * - 24..35: IV / Nonce (12 bytes)
 * - 36..51: Auth Tag (16 bytes)
 * - 52..end: AES-256-GCM Encrypted Gzip Manifest (variable)
 *
 * @param {object} [options]
 * @param {Record<string, string>} [options.files=SAMPLE_SOURCE_FILES] - Map of relative paths to contents.
 * @param {string} [options.passphrase=TEST_BACKUP_PASSPHRASE] - Master passphrase.
 * @returns {Buffer} Binary .davbak container.
 */
export function createSyntheticBackupContainer(options = {}) {
  const {
    files = SAMPLE_SOURCE_FILES,
    passphrase = TEST_BACKUP_PASSPHRASE
  } = options;

  // 1. Pack files into JSON manifest and compress with gzip
  const manifest = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    files: Object.entries(files).map(([relPath, content]) => ({
      path: relPath,
      content: Buffer.from(content, 'utf8').toString('base64'),
      size: Buffer.byteLength(content, 'utf8')
    }))
  };

  const manifestJson = JSON.stringify(manifest);
  const compressedPayload = zlib.gzipSync(Buffer.from(manifestJson, 'utf8'));

  // 2. Generate cryptographic material
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);

  // 3. Encrypt payload via AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(compressedPayload),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  // 4. Assemble container envelope
  return Buffer.concat([
    DAVBAK_MAGIC,
    salt,
    iv,
    authTag,
    encryptedPayload
  ]);
}

/**
 * Creates a container with corrupted ciphertext to test authentication tag verification failure.
 *
 * @param {string} [passphrase=TEST_BACKUP_PASSPHRASE]
 * @returns {Buffer}
 */
export function createTamperedCiphertextContainer(passphrase = TEST_BACKUP_PASSPHRASE) {
  const validContainer = createSyntheticBackupContainer({ passphrase });
  const tampered = Buffer.from(validContainer);
  // Flip a bit in the ciphertext payload (after 52-byte header)
  if (tampered.length > 55) {
    tampered[54] ^= 0xff;
  }
  return tampered;
}

/**
 * Creates a container with corrupted auth tag.
 *
 * @param {string} [passphrase=TEST_BACKUP_PASSPHRASE]
 * @returns {Buffer}
 */
export function createTamperedTagContainer(passphrase = TEST_BACKUP_PASSPHRASE) {
  const validContainer = createSyntheticBackupContainer({ passphrase });
  const tampered = Buffer.from(validContainer);
  // Flip a bit in the auth tag (bytes 36..51)
  tampered[40] ^= 0x01;
  return tampered;
}

/**
 * Creates a container with invalid magic header bytes.
 *
 * @returns {Buffer}
 */
export function createInvalidMagicContainer() {
  const validContainer = createSyntheticBackupContainer();
  const corrupted = Buffer.from(validContainer);
  Buffer.from('BADMAGIC', 'ascii').copy(corrupted, 0, 0, 8);
  return corrupted;
}

/**
 * Creates a truncated container buffer (< 52 bytes).
 *
 * @returns {Buffer}
 */
export function createTruncatedContainer() {
  return Buffer.from('DAVBAK01_SHORT_BUFFER_ONLY_28B', 'ascii');
}

/**
 * Creates a container whose manifest attempts a path traversal attack.
 *
 * @param {string} [passphrase=TEST_BACKUP_PASSPHRASE]
 * @returns {Buffer}
 */
export function createPathTraversalContainer(passphrase = TEST_BACKUP_PASSPHRASE) {
  const maliciousFiles = {
    '../../etc/passwd': 'root:x:0:0:root:/root:/bin/bash\n',
    'safe.txt': 'Safe content'
  };
  return createSyntheticBackupContainer({ files: maliciousFiles, passphrase });
}
