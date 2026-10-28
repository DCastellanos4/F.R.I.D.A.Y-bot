import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_POOLS,
  FORMAT_REGEXES,
  ENTROPY_REFERENCE_TABLE,
  createMockSecondBrainMemory
} from './fixtures/cryptoFixtures.js';
import {
  assertNoEmojis,
  isValidOtpCode,
  assertValidOtpCode,
  calculateShannonEntropy as s2CalculateShannonEntropy,
  assertPasswordQuality,
  assertValidHexKey,
  assertValidUuid
} from './helpers/s2Validators.js';
import {
  generatePassword,
  generatePin,
  generateToken,
  generateCryptoKey,
  generateUuid,
  calculateShannonEntropy,
  estimatePoolSize,
  saveCredentialToMemory
} from '../../cryptoGeneratorService.js';
import { buscarMemorias, olvidarMemoria } from '../../memoryService.js';

describe('Sector 2 - Task 20: High-Entropy Cryptographic Generator', () => {
  let mockBrain;

  beforeEach(() => {
    mockBrain = createMockSecondBrainMemory();
  });

  describe('1. CSPRNG Password Generator & Shannon Entropy', () => {
    it('should generate a 16-character password meeting full quality requirements and minimum 100 bits entropy', () => {
      const password = generatePassword(16);
      assert.strictEqual(typeof password, 'string');
      assert.strictEqual(password.length, 16);

      // Verify quality: uppercase, lowercase, digit, symbol, min 80 bits entropy
      assertPasswordQuality(password, 80);

      // Verify against ENTROPY_REFERENCE_TABLE for 16 chars (min 100 bits)
      const entropy = calculateShannonEntropy(password, 94);
      assert.ok(
        entropy >= ENTROPY_REFERENCE_TABLE.password16Chars.minEntropyBits,
        `Entropy ${entropy} should be >= ${ENTROPY_REFERENCE_TABLE.password16Chars.minEntropyBits}`
      );

      assertNoEmojis(password);
    });

    it('should generate 24-character and 32-character high-entropy passwords meeting threshold metrics', () => {
      const pass24 = generatePassword(24);
      assert.strictEqual(pass24.length, 24);
      assertPasswordQuality(pass24, 120);
      const entropy24 = calculateShannonEntropy(pass24, 94);
      assert.ok(entropy24 >= ENTROPY_REFERENCE_TABLE.password24Chars.minEntropyBits);
      assertNoEmojis(pass24);

      const pass32 = generatePassword(32);
      assert.strictEqual(pass32.length, 32);
      assertPasswordQuality(pass32, 180);
      const entropy32 = calculateShannonEntropy(pass32, 94);
      assert.ok(entropy32 >= ENTROPY_REFERENCE_TABLE.password32Chars.minEntropyBits);
      assertNoEmojis(pass32);
    });

    it('should generate digits-only passwords when other pools are disabled', () => {
      const digitsPass = generatePassword(12, {
        uppercase: false,
        lowercase: false,
        symbols: false,
        digits: true
      });
      assert.strictEqual(digitsPass.length, 12);
      assert.ok(/^\d{12}$/.test(digitsPass), `Expected digits only, got ${digitsPass}`);
      assertNoEmojis(digitsPass);
    });

    it('should exclude ambiguous characters (0, O, 1, l, I) when requested', () => {
      for (let i = 0; i < 25; i++) {
        const pass = generatePassword(20, { excludeAmbiguous: true });
        assert.ok(!/[0O1lI]/.test(pass), `Found ambiguous character in password: ${pass}`);
        assertNoEmojis(pass);
      }
    });

    it('should support custom symbol set overrides', () => {
      const customSymbols = '#$%';
      const pass = generatePassword(20, { customSymbols });
      const symbolsInPass = pass.split('').filter(c => !/[A-Za-z0-9]/.test(c));
      for (const s of symbolsInPass) {
        assert.ok(customSymbols.includes(s), `Found unexpected symbol '${s}'`);
      }
      assertNoEmojis(pass);
    });

    it('should return detailed metadata when options.detailed is true', () => {
      const details = generatePassword(18, { detailed: true });
      assert.strictEqual(typeof details, 'object');
      assert.strictEqual(details.length, 18);
      assert.strictEqual(details.password.length, 18);
      assert.ok(details.entropy > 100);
      assert.ok(details.poolSize >= 80);
      assertNoEmojis(details);
    });

    it('should throw an error if all character pools are disabled', () => {
      assert.throws(
        () => generatePassword(16, { uppercase: false, lowercase: false, digits: false, symbols: false }),
        /character set/i
      );
    });

    it('should produce 100 unique passwords without collisions', () => {
      const set = new Set();
      for (let i = 0; i < 100; i++) {
        const p = generatePassword(16);
        set.add(p);
      }
      assert.strictEqual(set.size, 100, 'Collisions detected in CSPRNG password generation');
    });
  });

  describe('2. Numeric PIN Generator', () => {
    it('should generate a 4-digit numeric PIN matching FORMAT_REGEXES.numericPin4', () => {
      const pin4 = generatePin(4);
      assert.strictEqual(pin4.length, 4);
      assert.ok(FORMAT_REGEXES.numericPin4.test(pin4), `Expected 4-digit PIN, got ${pin4}`);
      assertNoEmojis(pin4);
    });

    it('should generate a 6-digit numeric PIN matching FORMAT_REGEXES.numericPin6 and pass assertValidOtpCode', () => {
      const pin6 = generatePin(6);
      assert.strictEqual(pin6.length, 6);
      assert.ok(FORMAT_REGEXES.numericPin6.test(pin6), `Expected 6-digit PIN, got ${pin6}`);
      assertValidOtpCode(pin6, 6);

      const entropy = calculateShannonEntropy(pin6, 10);
      assert.ok(
        entropy >= ENTROPY_REFERENCE_TABLE.pin6Digits.minEntropyBits,
        `Entropy ${entropy} should be >= ${ENTROPY_REFERENCE_TABLE.pin6Digits.minEntropyBits}`
      );
      assertNoEmojis(pin6);
    });

    it('should generate an 8-digit numeric PIN matching FORMAT_REGEXES.numericPin8', () => {
      const pin8 = generatePin(8);
      assert.strictEqual(pin8.length, 8);
      assert.ok(FORMAT_REGEXES.numericPin8.test(pin8), `Expected 8-digit PIN, got ${pin8}`);
      assertNoEmojis(pin8);
    });

    it('should produce uniform distribution across 0-9 digits in multiple PIN generations', () => {
      const seenDigits = new Set();
      for (let i = 0; i < 30; i++) {
        const pin = generatePin(6);
        for (const digit of pin) {
          seenDigits.add(digit);
        }
      }
      assert.strictEqual(seenDigits.size, 10, 'Expected all digits 0-9 to be represented in 30 generated PINs');
    });
  });

  describe('3. Cryptographic Token Generator', () => {
    it('should generate a 32-character hex token (16 bytes) matching FORMAT_REGEXES.hexToken32', () => {
      const token16Bytes = generateToken(16, 'hex');
      assert.strictEqual(token16Bytes.length, 32);
      assert.ok(FORMAT_REGEXES.hexToken32.test(token16Bytes), `Invalid hex token: ${token16Bytes}`);
      assertNoEmojis(token16Bytes);
    });

    it('should generate a 64-character hex token (32 bytes)', () => {
      const token32Bytes = generateToken(32, 'hex');
      assert.strictEqual(token32Bytes.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(token32Bytes));
      assertNoEmojis(token32Bytes);
    });

    it('should generate base64 and base64url encoded tokens', () => {
      const b64Token = generateToken(24, 'base64');
      assert.ok(typeof b64Token === 'string');
      assert.ok(b64Token.length > 0);
      assertNoEmojis(b64Token);

      const b64urlToken = generateToken(24, 'base64url');
      assert.ok(FORMAT_REGEXES.base64url.test(b64urlToken));
      assertNoEmojis(b64urlToken);
    });

    it('should generate base62 alphanumeric tokens matching FORMAT_REGEXES.base62', () => {
      const base62Token = generateToken(32, 'base62');
      assert.strictEqual(base62Token.length, 32);
      assert.ok(FORMAT_REGEXES.base62.test(base62Token));
      assertNoEmojis(base62Token);
    });
  });

  describe('4. Cryptographic Key Generator (AES-256 & AES-512)', () => {
    it('should generate a 256-bit AES key matching FORMAT_REGEXES.hexKey256 and validate with assertValidHexKey', () => {
      const key256 = generateCryptoKey('aes-256-gcm');
      assert.strictEqual(key256.length, 64);
      assert.ok(FORMAT_REGEXES.hexKey256.test(key256));
      assertValidHexKey(key256, 256);
      assertNoEmojis(key256);
    });

    it('should generate a 512-bit key with 128 hex characters and validate with assertValidHexKey', () => {
      const key512 = generateCryptoKey('aes-512');
      assert.strictEqual(key512.length, 128);
      assertValidHexKey(key512, 512);
      assertNoEmojis(key512);
    });

    it('should generate a 128-bit key with 32 hex characters and validate with assertValidHexKey', () => {
      const key128 = generateCryptoKey('aes-128');
      assert.strictEqual(key128.length, 32);
      assertValidHexKey(key128, 128);
      assertNoEmojis(key128);
    });

    it('should support base64 encoding and detailed metadata return', () => {
      const keyB64 = generateCryptoKey('aes-256-gcm', { encoding: 'base64' });
      assert.ok(/^[A-Za-z0-9+/=]+$/.test(keyB64));
      assertNoEmojis(keyB64);

      const details = generateCryptoKey('aes-256-gcm', { detailed: true });
      assert.strictEqual(details.bitLength, 256);
      assert.strictEqual(details.byteLength, 32);
      assert.strictEqual(details.algorithm, 'aes-256-gcm');
      assert.strictEqual(details.key.length, 64);
      assertNoEmojis(details);
    });
  });

  describe('5. RFC 4122 v4 UUID Generator', () => {
    it('should generate a valid UUID v4 matching FORMAT_REGEXES.uuidV4 and assertValidUuid', () => {
      const uuid = generateUuid();
      assert.ok(FORMAT_REGEXES.uuidV4.test(uuid), `Invalid UUID v4: ${uuid}`);
      assertValidUuid(uuid);
      assertNoEmojis(uuid);
    });
  });

  describe('6. Second Brain Credential Persistence (saveCredentialToMemory)', () => {
    it('should save credential to mock Second Brain strictly under category clave', async () => {
      const secret = generatePassword(20);
      const res = await saveCredentialToMemory(
        'Contrasena Base de Datos Produccion',
        secret,
        'Credencial principal PostgreSQL',
        { memoryService: mockBrain }
      );

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.keyName, 'Contrasena Base de Datos Produccion');
      assert.strictEqual(res.category, 'clave');
      assert.ok(res.id);
      assert.ok(res.timestamp);
      assertNoEmojis(res);

      const savedList = mockBrain.getSavedCredentials();
      assert.strictEqual(savedList.length, 1);
      assert.strictEqual(savedList[0].sujeto, 'Contrasena Base de Datos Produccion');
      assert.strictEqual(savedList[0].dato, secret);
      assert.strictEqual(savedList[0].categoria, 'clave');
      assert.ok(savedList[0].tags.includes('clave'));
      assertNoEmojis(savedList[0]);
    });

    it('should reject persistence request when keyName or secretValue is empty', async () => {
      const resNoKey = await saveCredentialToMemory('', 'super_secret', '', { memoryService: mockBrain });
      assert.strictEqual(resNoKey.ok, false);
      assert.ok(resNoKey.error);
      assertNoEmojis(resNoKey);

      const resNoSecret = await saveCredentialToMemory('VPS Key', '', '', { memoryService: mockBrain });
      assert.strictEqual(resNoSecret.ok, false);
      assert.ok(resNoSecret.error);
      assertNoEmojis(resNoSecret);

      assert.strictEqual(mockBrain.getSavedCredentials().length, 0);
    });

    it('should integrate seamlessly with live memoryService without errors', async () => {
      const testKeyName = 'Test Credential Unit ' + Date.now();
      const testSecret = generateToken(16, 'hex');

      const res = await saveCredentialToMemory(testKeyName, testSecret, 'Prueba de integracion');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.category, 'clave');
      assertNoEmojis(res);

      // Verify searchable via buscarMemorias
      const searchResults = buscarMemorias(testKeyName);
      assert.ok(searchResults.length > 0);
      const found = searchResults.find(m => m.sujeto === testKeyName);
      assert.ok(found, 'Saved credential should be found in memory search');
      assert.strictEqual(found.dato, testSecret);
      assert.strictEqual(found.categoria, 'clave');

      // Cleanup
      olvidarMemoria(testKeyName);
    });
  });

  describe('7. Zero-Emoji Static & Runtime Verification', () => {
    it('should ensure zero emojis across all cryptographic functions', () => {
      const pwd = generatePassword(24);
      assertNoEmojis(pwd);

      const pin = generatePin(6);
      assertNoEmojis(pin);

      const token = generateToken(32, 'hex');
      assertNoEmojis(token);

      const key = generateCryptoKey('aes-256-gcm');
      assertNoEmojis(key);

      const uuid = generateUuid();
      assertNoEmojis(uuid);
    });
  });
});
