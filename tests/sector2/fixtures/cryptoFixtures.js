/**
 * Cryptographic Test Fixtures for Task 20 (High-Entropy Cryptographic Generator).
 *
 * Provides character pools, entropy reference values, format regexes,
 * and a mock Second Brain memory receiver.
 *
 * Strict Policy: Zero Emojis.
 */

export const CHARACTER_POOLS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
  ambiguous: '0O1lI'
};

export const FORMAT_REGEXES = {
  numericPin4: /^\d{4}$/,
  numericPin6: /^\d{6}$/,
  numericPin8: /^\d{8}$/,
  hexToken32: /^[0-9a-f]{32}$/,
  hexKey256: /^[0-9a-f]{64}$/,
  base62: /^[0-9A-Za-z]+$/,
  base64url: /^[0-9A-Za-z_-]+$/,
  uuidV4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

export const ENTROPY_REFERENCE_TABLE = {
  // Pool size 94 (upper + lower + digits + symbols) -> log2(94) = 6.5545 bits/char
  password16Chars: { length: 16, minEntropyBits: 100 },
  password24Chars: { length: 24, minEntropyBits: 150 },
  password32Chars: { length: 32, minEntropyBits: 200 },
  // Pool size 10 (digits) -> log2(10) = 3.32 bits/char
  pin6Digits: { digits: 6, minEntropyBits: 19 },
  // Pool size 16 (hex) -> 4 bits/char
  hexKey256Bits: { length: 64, exactBits: 256 }
};

/**
 * Mock Second Brain memory collector for testing credential persistence.
 */
export class MockSecondBrainMemory {
  constructor() {
    this.savedMemories = [];
  }

  /**
   * Mock implementation of memoryService.guardarMemoria.
   *
   * @param {object} memory - { sujeto, dato, categoria, tags }
   * @returns {Promise<{ ok: boolean, id: string }>}
   */
  async guardarMemoria(memory) {
    const record = {
      id: `mem-${this.savedMemories.length + 1}`,
      sujeto: memory.sujeto,
      dato: memory.dato,
      categoria: memory.categoria || 'clave',
      tags: memory.tags || [],
      timestamp: Date.now()
    };
    this.savedMemories.push(record);
    return { ok: true, id: record.id };
  }

  getSavedCredentials() {
    return this.savedMemories.filter(m => m.categoria === 'clave');
  }

  getLastSaved() {
    if (this.savedMemories.length === 0) return null;
    return this.savedMemories[this.savedMemories.length - 1];
  }

  clear() {
    this.savedMemories = [];
  }
}

/**
 * Creates a fresh MockSecondBrainMemory instance.
 * @returns {MockSecondBrainMemory}
 */
export function createMockSecondBrainMemory() {
  return new MockSecondBrainMemory();
}
