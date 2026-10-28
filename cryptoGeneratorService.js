/**
 * cryptoGeneratorService.js
 *
 * High-Entropy Cryptographic Generator and Second Brain Credential Persistence.
 * Provides CSPRNG password generation with Shannon entropy calculation,
 * numeric PINs, hex/base64/base62 tokens, cryptographic keys (AES-256, AES-512),
 * and persistent storage to Second Brain (category: 'clave').
 *
 * Strict Policy: Zero Emojis.
 */

import crypto from 'node:crypto';
import { guardarMemoria as defaultGuardarMemoria } from './memoryService.js';

export const CHARACTER_POOLS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
  ambiguous: '0O1lI'
};

/**
 * Calculates theoretical Shannon entropy in bits for a secret string given character pool size.
 * Formula: H = length * log2(poolSize)
 *
 * @param {string} secret - Secret string
 * @param {number} [poolSize=94] - Available character pool size
 * @returns {number} Information entropy in bits
 */
export function calculateShannonEntropy(secret, poolSize = 94) {
  if (typeof secret !== 'string' || secret.length === 0) return 0;
  const pSize = poolSize > 1 ? poolSize : 2;
  return Number((secret.length * Math.log2(pSize)).toFixed(2));
}

/**
 * Estimates the effective character pool size from a generated or provided secret.
 *
 * @param {string} secret
 * @returns {number} Pool size
 */
export function estimatePoolSize(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return 0;
  let pool = 0;
  if (/[A-Z]/.test(secret)) pool += 26;
  if (/[a-z]/.test(secret)) pool += 26;
  if (/[0-9]/.test(secret)) pool += 10;
  if (/[^A-Za-z0-9]/.test(secret)) pool += 32;
  return pool || 10;
}

/**
 * Generates a high-entropy password using cryptographically secure random integers.
 *
 * @param {number} [length=16] - Password length (minimum 4)
 * @param {object} [options={}] - Custom configuration
 * @param {boolean} [options.uppercase=true] - Include uppercase letters
 * @param {boolean} [options.lowercase=true] - Include lowercase letters
 * @param {boolean} [options.digits=true] - Include numeric digits
 * @param {boolean} [options.symbols=true] - Include special symbols
 * @param {boolean} [options.excludeAmbiguous=false] - Exclude ambiguous characters (0, O, 1, l, I)
 * @param {string} [options.customSymbols] - Custom symbol pool override
 * @param {boolean} [options.detailed=false] - Return detailed object instead of raw string
 * @returns {string|{ password: string, entropy: number, length: number, poolSize: number }}
 */
export function generatePassword(length = 16, options = {}) {
  const pwdLength = Math.max(4, Math.floor(Number(length) || 16));

  const {
    uppercase = true,
    lowercase = true,
    digits = true,
    symbols = true,
    excludeAmbiguous = false,
    customSymbols,
    detailed = false
  } = options;

  let poolUpper = uppercase ? CHARACTER_POOLS.uppercase : '';
  let poolLower = lowercase ? CHARACTER_POOLS.lowercase : '';
  let poolDigits = digits ? CHARACTER_POOLS.digits : '';
  let poolSymbols = symbols ? (customSymbols || CHARACTER_POOLS.symbols) : '';

  if (excludeAmbiguous) {
    const ambigSet = new Set(CHARACTER_POOLS.ambiguous.split(''));
    poolUpper = poolUpper.split('').filter(c => !ambigSet.has(c)).join('');
    poolLower = poolLower.split('').filter(c => !ambigSet.has(c)).join('');
    poolDigits = poolDigits.split('').filter(c => !ambigSet.has(c)).join('');
  }

  const enabledSets = [];
  if (poolUpper) enabledSets.push(poolUpper);
  if (poolLower) enabledSets.push(poolLower);
  if (poolDigits) enabledSets.push(poolDigits);
  if (poolSymbols) enabledSets.push(poolSymbols);

  if (enabledSets.length === 0) {
    throw new Error('At least one character set must be enabled');
  }

  const fullPool = enabledSets.join('');
  const passwordChars = [];

  // Guarantee inclusion of at least one character from each enabled set if length permits
  if (pwdLength >= enabledSets.length) {
    for (const set of enabledSets) {
      const idx = crypto.randomInt(0, set.length);
      passwordChars.push(set[idx]);
    }
  }

  // Fill remainder of password length from the full combined pool
  while (passwordChars.length < pwdLength) {
    const idx = crypto.randomInt(0, fullPool.length);
    passwordChars.push(fullPool[idx]);
  }

  // Fisher-Yates cryptographically secure shuffle
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const temp = passwordChars[i];
    passwordChars[i] = passwordChars[j];
    passwordChars[j] = temp;
  }

  const password = passwordChars.join('');
  const entropy = calculateShannonEntropy(password, fullPool.length);

  if (detailed) {
    return {
      password,
      entropy,
      length: password.length,
      poolSize: fullPool.length
    };
  }

  return password;
}

/**
 * Generates a numeric PIN string using CSPRNG.
 *
 * @param {number} [digits=6] - Number of digits (default: 6)
 * @returns {string} Numeric PIN
 */
export function generatePin(digits = 6) {
  const count = Math.max(1, Math.floor(Number(digits) || 6));
  const chars = [];
  for (let i = 0; i < count; i++) {
    chars.push(crypto.randomInt(0, 10).toString());
  }
  return chars.join('');
}

/**
 * Generates a cryptographically random token in specified encoding.
 *
 * @param {number} [byteLength=32] - Number of random bytes
 * @param {string} [encoding='hex'] - 'hex' | 'base64' | 'base64url' | 'base62'
 * @returns {string} Generated token string
 */
export function generateToken(byteLength = 32, encoding = 'hex') {
  const bytes = Math.max(1, Math.floor(Number(byteLength) || 32));
  const rawBytes = crypto.randomBytes(bytes);

  switch (encoding.toLowerCase()) {
    case 'base64':
      return rawBytes.toString('base64');
    case 'base64url':
      return rawBytes.toString('base64url');
    case 'base62': {
      const base62Chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      const result = [];
      for (let i = 0; i < bytes; i++) {
        const idx = crypto.randomInt(0, base62Chars.length);
        result.push(base62Chars[idx]);
      }
      return result.join('');
    }
    case 'hex':
    default:
      return rawBytes.toString('hex');
  }
}

/**
 * Generates a cryptographic key (e.g. 256-bit or 512-bit AES key).
 *
 * @param {string} [algorithm='aes-256-gcm'] - Key type or bit size ('aes-256-gcm', '256', '512', etc.)
 * @param {object} [options={}] - Options
 * @param {string} [options.encoding='hex'] - Output encoding ('hex' or 'base64')
 * @param {boolean} [options.detailed=false] - Return metadata object
 * @returns {string|{ key: string, bitLength: number, byteLength: number, algorithm: string }}
 */
export function generateCryptoKey(algorithm = 'aes-256-gcm', options = {}) {
  const algo = String(algorithm).toLowerCase();
  const encoding = options.encoding === 'base64' ? 'base64' : 'hex';
  const detailed = Boolean(options.detailed);

  let bitLength = 256;
  if (algo.includes('512') || algo === '512') {
    bitLength = 512;
  } else if (algo.includes('128') || algo === '128') {
    bitLength = 128;
  } else {
    bitLength = 256;
  }

  const byteLength = bitLength / 8;
  const keyBytes = crypto.randomBytes(byteLength);
  const key = encoding === 'base64' ? keyBytes.toString('base64') : keyBytes.toString('hex');

  if (detailed) {
    return {
      key,
      bitLength,
      byteLength,
      algorithm: algo
    };
  }

  return key;
}

/**
 * Generates an RFC 4122 v4 UUID string using CSPRNG.
 *
 * @returns {string} UUID v4
 */
export function generateUuid() {
  return crypto.randomUUID();
}

/**
 * Saves a generated credential into Second Brain via memoryService.
 * Always categorized strictly under 'clave'.
 *
 * @param {string} keyName - Name or subject of the credential (e.g. 'Servidor VPS Root')
 * @param {string} secretValue - Secret value (password, token, or key)
 * @param {string} [notes=''] - Additional description or context
 * @param {object} [deps={}] - Dependency injection for test isolation
 * @param {object} [deps.memoryService] - Injected memoryService instance
 * @returns {Promise<{ ok: boolean, id?: string, keyName: string, category: 'clave', timestamp: number, error?: string }>}
 */
export async function saveCredentialToMemory(keyName, secretValue, notes = '', deps = {}) {
  if (!keyName || typeof keyName !== 'string' || !keyName.trim()) {
    return {
      ok: false,
      error: 'Missing required credential keyName',
      keyName: '',
      category: 'clave',
      timestamp: Date.now()
    };
  }

  if (!secretValue || typeof secretValue !== 'string' || !secretValue.trim()) {
    return {
      ok: false,
      error: 'Missing required secretValue',
      keyName: keyName.trim(),
      category: 'clave',
      timestamp: Date.now()
    };
  }

  const memoriaPayload = {
    sujeto: keyName.trim(),
    dato: secretValue.trim(),
    categoria: 'clave',
    tags: ['clave', 'credencial', 'crypto', ...(notes ? [notes.trim()] : [])]
  };

  try {
    let result;
    if (deps.memoryService && typeof deps.memoryService.guardarMemoria === 'function') {
      result = await deps.memoryService.guardarMemoria(memoriaPayload);
    } else {
      result = defaultGuardarMemoria(memoriaPayload);
    }

    const id = result?.id || result?.memoria?.id || `mem_clave_${Date.now()}`;

    return {
      ok: Boolean(result?.ok ?? true),
      id,
      keyName: keyName.trim(),
      category: 'clave',
      timestamp: Date.now()
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Failed to save credential to Second Brain',
      keyName: keyName.trim(),
      category: 'clave',
      timestamp: Date.now()
    };
  }
}
