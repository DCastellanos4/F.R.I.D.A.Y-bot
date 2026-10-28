import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/**
 * Zero-emoji validator regex matching Unicode Extended Pictographic characters.
 */
export const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Magic bytes for the DAVBAK encrypted container format: 'DAVBAK01' (8 bytes ASCII).
 */
export const DAVBAK_MAGIC = Buffer.from('DAVBAK01', 'ascii');

/**
 * Checks if a target (string, object, array, or error) contains any emoji characters.
 *
 * @param {any} target - Target to scan.
 * @param {string} [path='root'] - Current JSON property path.
 * @returns {{ valid: boolean, violations: Array<{ path: string, char: string, codePoint: string }> }}
 */
export function hasNoEmojis(target, path = 'root') {
  const violations = [];

  function scan(val, curPath) {
    if (val === null || val === undefined) {
      return;
    }

    if (typeof val === 'string') {
      const match = val.match(EMOJI_REGEX);
      if (match) {
        for (const ch of val) {
          if (EMOJI_REGEX.test(ch)) {
            violations.push({
              path: curPath,
              char: ch,
              codePoint: 'U+' + ch.codePointAt(0).toString(16).toUpperCase()
            });
          }
        }
      }
      return;
    }

    if (Buffer.isBuffer(val)) {
      return;
    }

    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        scan(val[i], `${curPath}[${i}]`);
      }
      return;
    }

    if (val instanceof Error) {
      scan(val.message, `${curPath}.message`);
      return;
    }

    if (typeof val === 'object') {
      for (const [key, propVal] of Object.entries(val)) {
        scan(propVal, `${curPath}.${key}`);
      }
    }
  }

  scan(target, path);

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Asserts that the provided target contains zero emojis.
 *
 * @param {any} target - Text or data structure to inspect.
 * @param {string} [contextMessage='Zero-emoji validation failed'] - Context descriptor.
 */
export function assertNoEmojis(target, contextMessage = 'Zero-emoji validation failed') {
  const result = hasNoEmojis(target);
  if (!result.valid) {
    const details = result.violations
      .map(v => `${v.path}: character '${v.char}' (${v.codePoint})`)
      .join(', ');
    assert.fail(`${contextMessage}: found forbidden emoji characters [${details}]`);
  }
}

/**
 * Validates a DAVBAK01 encrypted container buffer structure.
 * Header layout:
 * - 0..7: Magic 'DAVBAK01' (8 bytes)
 * - 8..23: Salt (16 bytes)
 * - 24..35: IV / Nonce (12 bytes)
 * - 36..51: Auth Tag (16 bytes)
 * - 52..end: Encrypted ciphertext (variable length)
 *
 * @param {Buffer} buffer - Binary container buffer.
 * @returns {{ valid: boolean, reason?: string, details?: { magic: string, salt: Buffer, iv: Buffer, tag: Buffer, payloadLength: number } }}
 */
export function isValidDavbakContainer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { valid: false, reason: 'Container is not a Buffer' };
  }

  if (buffer.length < 52) {
    return { valid: false, reason: `Container buffer too short: ${buffer.length} bytes (minimum 52 bytes required)` };
  }

  const magic = buffer.subarray(0, 8);
  if (!magic.equals(DAVBAK_MAGIC)) {
    return {
      valid: false,
      reason: `Invalid magic header bytes: got '${magic.toString('ascii')}', expected 'DAVBAK01'`
    };
  }

  const salt = buffer.subarray(8, 24);
  const iv = buffer.subarray(24, 36);
  const tag = buffer.subarray(36, 52);
  const payloadLength = buffer.length - 52;

  if (payloadLength <= 0) {
    return { valid: false, reason: 'Encrypted ciphertext payload is empty' };
  }

  return {
    valid: true,
    details: {
      magic: magic.toString('ascii'),
      salt,
      iv,
      tag,
      payloadLength
    }
  };
}

/**
 * Asserts that a buffer is a valid DAVBAK01 container.
 *
 * @param {Buffer} buffer - Buffer to validate.
 * @param {string} [contextMessage='DAVBAK01 container validation failed']
 */
export function assertValidDavbak(buffer, contextMessage = 'DAVBAK01 container validation failed') {
  const result = isValidDavbakContainer(buffer);
  assert.ok(result.valid, `${contextMessage}: ${result.reason || 'Invalid container format'}`);
}

/**
 * Validates a numeric OTP string.
 *
 * @param {string} otp - OTP code to validate.
 * @param {number} [expectedDigits=6] - Expected digit count.
 * @returns {boolean}
 */
export function isValidOtpCode(otp, expectedDigits = 6) {
  if (typeof otp !== 'string') return false;
  const regex = new RegExp(`^\\d{${expectedDigits}}$`);
  return regex.test(otp.trim());
}

/**
 * Asserts that the code is a valid numeric OTP.
 *
 * @param {string} otp
 * @param {number} [expectedDigits=6]
 */
export function assertValidOtpCode(otp, expectedDigits = 6) {
  assert.ok(
    isValidOtpCode(otp, expectedDigits),
    `Expected valid ${expectedDigits}-digit numeric OTP code, received '${otp}'`
  );
  assertNoEmojis(otp, 'OTP code contains forbidden characters');
}

/**
 * Calculates theoretical Shannon entropy in bits for a given secret string and character pool size.
 * Formula: H = length * log2(poolSize)
 *
 * @param {string} secret - Generated secret.
 * @param {number} [poolSize=94] - Size of character pool used.
 * @returns {number} Entropy in bits.
 */
export function calculateShannonEntropy(secret, poolSize = 94) {
  if (typeof secret !== 'string' || secret.length === 0) return 0;
  return secret.length * Math.log2(poolSize);
}

/**
 * Asserts that a generated password meets minimum Shannon entropy and character set diversity.
 *
 * @param {string} password - Password string to check.
 * @param {number} [minEntropyBits=80] - Minimum acceptable entropy bits.
 * @param {object} [requirements]
 * @param {boolean} [requirements.hasUpper=true]
 * @param {boolean} [requirements.hasLower=true]
 * @param {boolean} [requirements.hasDigit=true]
 * @param {boolean} [requirements.hasSymbol=true]
 */
export function assertPasswordQuality(password, minEntropyBits = 80, requirements = {}) {
  const {
    hasUpper = true,
    hasLower = true,
    hasDigit = true,
    hasSymbol = true
  } = requirements;

  assert.strictEqual(typeof password, 'string', 'Password must be a string');
  assert.ok(password.length >= 8, `Password length must be at least 8 chars, got ${password.length}`);

  let poolSize = 0;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^A-Za-z0-9]/.test(password)) poolSize += 32;

  const entropy = calculateShannonEntropy(password, poolSize || 10);
  assert.ok(
    entropy >= minEntropyBits,
    `Password entropy ${entropy.toFixed(1)} bits is below required minimum ${minEntropyBits} bits`
  );

  if (hasUpper) {
    assert.ok(/[A-Z]/.test(password), 'Password is missing required uppercase letter');
  }
  if (hasLower) {
    assert.ok(/[a-z]/.test(password), 'Password is missing required lowercase letter');
  }
  if (hasDigit) {
    assert.ok(/[0-9]/.test(password), 'Password is missing required digit');
  }
  if (hasSymbol) {
    assert.ok(/[^A-Za-z0-9]/.test(password), 'Password is missing required symbol');
  }

  assertNoEmojis(password, 'Password contains forbidden emoji characters');
}

/**
 * Asserts that an HMAC-SHA256 signature is valid for a raw payload buffer and secret.
 *
 * @param {Buffer|string} rawPayload - Raw request payload.
 * @param {string} signatureHeader - Header in format 'sha256=<hex>'.
 * @param {string} secret - Shared secret key.
 */
export function assertValidHmacSignature(rawPayload, signatureHeader, secret) {
  assert.strictEqual(typeof signatureHeader, 'string', 'Signature header must be a string');
  assert.ok(
    signatureHeader.startsWith('sha256='),
    `Signature header must start with 'sha256=', received '${signatureHeader}'`
  );

  const receivedHex = signatureHeader.slice(7);
  assert.strictEqual(receivedHex.length, 64, 'SHA-256 hex digest must be exactly 64 characters');

  const bufPayload = Buffer.isBuffer(rawPayload) ? rawPayload : Buffer.from(rawPayload, 'utf8');
  const expectedHex = crypto.createHmac('sha256', secret).update(bufPayload).digest('hex');

  const bufExpected = Buffer.from(expectedHex, 'hex');
  const bufReceived = Buffer.from(receivedHex, 'hex');

  assert.strictEqual(bufExpected.length, bufReceived.length, 'HMAC buffer length mismatch');
  assert.ok(
    crypto.timingSafeEqual(bufExpected, bufReceived),
    'HMAC signature verification failed: timingSafeEqual returned false'
  );
}

/**
 * Asserts that a string is a valid hexadecimal key of given bit length.
 *
 * @param {string} hexKey - Key string.
 * @param {number} [expectedBits=256] - Expected key size in bits (default 256).
 */
export function assertValidHexKey(hexKey, expectedBits = 256) {
  assert.strictEqual(typeof hexKey, 'string', 'Hex key must be a string');
  const expectedHexChars = expectedBits / 4;
  assert.strictEqual(
    hexKey.length,
    expectedHexChars,
    `Expected ${expectedBits}-bit hex key (${expectedHexChars} hex chars), got ${hexKey.length}`
  );
  assert.ok(/^[0-9a-fA-F]+$/.test(hexKey), 'Hex key contains non-hexadecimal characters');
}

/**
 * Asserts that a string is a valid RFC 4122 UUID v4.
 *
 * @param {string} uuid
 */
export function assertValidUuid(uuid) {
  assert.strictEqual(typeof uuid, 'string', 'UUID must be a string');
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidV4Regex.test(uuid), `Value '${uuid}' is not a valid RFC 4122 v4 UUID`);
}
