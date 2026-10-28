import assert from 'node:assert/strict';

/**
 * Zero-emoji validator regex matching Unicode Extended Pictographic symbols.
 * Strictly checks for any emoji or pictographic characters.
 */
export const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Checks if a string or object contains any emojis.
 * Recursively scans strings, arrays, and object properties.
 *
 * @param {any} target - String or data structure to scan.
 * @param {string} [path='root'] - Property path for tracking.
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
 * @param {any} target - Text or object to validate.
 * @param {string} [contextMessage='Zero-emoji validation failed'] - Context message.
 */
export function assertNoEmojis(target, contextMessage = 'Zero-emoji validation failed') {
  const result = hasNoEmojis(target);
  if (!result.valid) {
    const details = result.violations
      .map(v => `${v.path}: code point ${v.codePoint}`)
      .join(', ');
    assert.fail(`${contextMessage}: found emoji characters [${details}]`);
  }
}

/**
 * Magic bytes for Ogg container format: 'OggS' [0x4F, 0x67, 0x67, 0x53].
 */
export const OGGS_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]);

/**
 * Validates whether a buffer is a valid OGG container with Opus audio.
 *
 * @param {Buffer} buffer - Audio buffer.
 * @returns {{ valid: boolean, reason?: string, hasOpusHead?: boolean }}
 */
export function isValidOggOpus(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { valid: false, reason: 'Input is not a Buffer' };
  }

  if (buffer.length < 4) {
    return { valid: false, reason: 'Buffer length too short (< 4 bytes)' };
  }

  if (!buffer.subarray(0, 4).equals(OGGS_MAGIC)) {
    return { valid: false, reason: 'Missing OggS magic bytes header' };
  }

  const hasOpusHead = buffer.includes(Buffer.from('OpusHead'));

  return {
    valid: true,
    hasOpusHead
  };
}

/**
 * Asserts that the buffer is a valid OGG Opus audio stream.
 *
 * @param {Buffer} buffer - Buffer to validate.
 * @param {string} [contextMessage='OGG Opus buffer validation failed'] - Context message.
 */
export function assertValidOggOpus(buffer, contextMessage = 'OGG Opus buffer validation failed') {
  const check = isValidOggOpus(buffer);
  assert.ok(check.valid, `${contextMessage}: ${check.reason || 'Invalid format'}`);
}

/**
 * Validates a vCard 3.0 or 4.0 string format.
 *
 * @param {string} vcard - Raw vCard string.
 * @returns {{ valid: boolean, errors: string[], fields: Record<string, string> }}
 */
export function isValidVCard(vcard) {
  const errors = [];
  const fields = {};

  if (typeof vcard !== 'string') {
    return { valid: false, errors: ['vCard is not a string'], fields };
  }

  const trimmed = vcard.trim();
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    return { valid: false, errors: ['vCard is empty'], fields };
  }

  if (lines[0] !== 'BEGIN:VCARD') {
    errors.push('Missing BEGIN:VCARD header at line 1');
  }

  if (lines[lines.length - 1] !== 'END:VCARD') {
    errors.push('Missing END:VCARD footer at last line');
  }

  let hasVersion = false;
  let hasFn = false;
  let hasTel = false;

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const mainKey = rawKey.split(';')[0].toUpperCase();

    fields[mainKey] = value;

    if (mainKey === 'VERSION') {
      hasVersion = true;
      if (value !== '3.0' && value !== '4.0') {
        errors.push(`Unsupported vCard version: ${value}. Expected 3.0 or 4.0`);
      }
    }
    if (mainKey === 'FN') {
      hasFn = true;
      if (!value) {
        errors.push('FN field is empty');
      }
    }
    if (mainKey === 'TEL') {
      hasTel = true;
      if (!value) {
        errors.push('TEL field is empty');
      }
    }
  }

  if (!hasVersion) errors.push('Missing VERSION field');
  if (!hasFn) errors.push('Missing FN (Full Name) field');
  if (!hasTel) errors.push('Missing TEL (Telephone) field');

  return {
    valid: errors.length === 0,
    errors,
    fields
  };
}

/**
 * Asserts that the string conforms to standard vCard 3.0 format.
 *
 * @param {string} vcard - Raw vCard string.
 * @param {object} [expected] - Expected fields to match.
 */
export function assertValidVCard(vcard, expected = {}) {
  const result = isValidVCard(vcard);
  assert.ok(result.valid, `vCard schema validation failed: ${result.errors.join('; ')}`);

  if (expected.displayName) {
    assert.strictEqual(
      result.fields.FN,
      expected.displayName,
      `vCard FN mismatch: expected ${expected.displayName}, got ${result.fields.FN}`
    );
  }
  if (expected.phone) {
    assert.ok(
      result.fields.TEL && result.fields.TEL.includes(expected.phone),
      `vCard TEL mismatch: expected ${expected.phone} in ${result.fields.TEL}`
    );
  }
  if (expected.organization) {
    assert.strictEqual(
      result.fields.ORG,
      expected.organization,
      `vCard ORG mismatch: expected ${expected.organization}, got ${result.fields.ORG}`
    );
  }

  assertNoEmojis(vcard, 'vCard contains forbidden emoji characters');
}

/**
 * Validates a WhatsApp Poll structure.
 *
 * @param {object} poll - Poll payload { name, values, selectableCount }.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function isValidPoll(poll) {
  const errors = [];

  if (!poll || typeof poll !== 'object') {
    return { valid: false, errors: ['Poll payload must be an object'] };
  }

  if (typeof poll.name !== 'string' || poll.name.trim().length === 0) {
    errors.push('Poll must have a non-empty name string');
  }

  if (!Array.isArray(poll.values)) {
    errors.push('Poll values must be an array of strings');
  } else {
    if (poll.values.length < 2) {
      errors.push(`Poll must have at least 2 options, got ${poll.values.length}`);
    }
    if (poll.values.length > 12) {
      errors.push(`Poll cannot exceed 12 options in WhatsApp, got ${poll.values.length}`);
    }
    for (let i = 0; i < poll.values.length; i++) {
      if (typeof poll.values[i] !== 'string' || poll.values[i].trim().length === 0) {
        errors.push(`Poll option at index ${i} must be a non-empty string`);
      }
    }
  }

  if (poll.selectableCount !== undefined) {
    if (!Number.isInteger(poll.selectableCount) || poll.selectableCount < 1) {
      errors.push('Poll selectableCount must be an integer >= 1');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Asserts that the poll payload is valid according to WhatsApp protocol specifications.
 *
 * @param {object} poll - Poll payload.
 */
export function assertValidPoll(poll) {
  const result = isValidPoll(poll);
  assert.ok(result.valid, `Poll validation failed: ${result.errors.join('; ')}`);
  assertNoEmojis(poll, 'Poll payload contains forbidden emoji characters');
}
