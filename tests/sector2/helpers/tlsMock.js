import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

/**
 * Creates a synthetic x509 peer certificate object matching the structure
 * returned by Node.js tls.TLSSocket.prototype.getPeerCertificate().
 *
 * @param {object} options
 * @param {string} [options.host='example.com'] - Host / Common Name.
 * @param {number} [options.daysRemaining=30] - Days from now until expiry (can be negative for expired).
 * @param {string} [options.issuer='Let\'s Encrypt'] - Issuer Organization / Common Name.
 * @param {string} [options.subject] - Subject string.
 * @param {string} [options.fingerprint] - SHA-256 fingerprint.
 * @returns {object} Peer certificate object.
 */
export function createSyntheticPeerCertificate(options = {}) {
  const {
    host = 'example.com',
    daysRemaining = 30,
    issuer = "Let's Encrypt",
    subject = host,
    fingerprint
  } = options;

  const now = Date.now();
  const validToDate = new Date(now + daysRemaining * 86400000);
  const validFromDate = new Date(now - 60 * 86400000); // 60 days in past

  const validTo = validToDate.toUTCString();
  const validFrom = validFromDate.toUTCString();

  const sha256Fingerprint = fingerprint || crypto
    .createHash('sha256')
    .update(`${host}:${issuer}:${validTo}`)
    .digest('hex')
    .match(/.{2}/g)
    .join(':')
    .toUpperCase();

  return {
    subject: {
      CN: subject,
      O: subject
    },
    issuer: {
      CN: issuer,
      O: issuer
    },
    valid_from: validFrom,
    valid_to: validTo,
    fingerprint256: sha256Fingerprint,
    serialNumber: crypto.randomBytes(8).toString('hex').toUpperCase(),
    bits: 2048,
    asn1Curve: 'prime256v1',
    nistCurve: 'P-256',
    subjectaltname: `DNS:${host}, DNS:www.${host}`
  };
}

/**
 * Mock TLSSocket emulating tls.TLSSocket for offline and deterministic testing.
 */
export class MockTlsSocket extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {object} [options.cert] - Certificate to return from getPeerCertificate().
   * @param {boolean} [options.simulateTimeout=false] - Whether to trigger timeout event.
   * @param {Error} [options.simulateError] - Error to emit immediately.
   * @param {number} [options.connectDelayMs=5] - Delay before secureConnect event.
   */
  constructor(options = {}) {
    super();
    this.cert = options.cert || createSyntheticPeerCertificate();
    this.destroyed = false;
    this.simulateTimeout = Boolean(options.simulateTimeout);
    this.simulateError = options.simulateError || null;
    this.connectDelayMs = options.connectDelayMs ?? 5;
    this.timeoutCallback = null;

    // Schedule connection outcome
    setImmediate(() => {
      if (this.destroyed) return;

      if (this.simulateError) {
        this.emit('error', this.simulateError);
        return;
      }

      if (this.simulateTimeout) {
        if (typeof this.timeoutCallback === 'function') {
          this.timeoutCallback();
        }
        this.emit('timeout');
        return;
      }

      setTimeout(() => {
        if (!this.destroyed) {
          this.emit('secureConnect');
        }
      }, this.connectDelayMs);
    });
  }

  getPeerCertificate(detailed = true) {
    return this.cert;
  }

  setTimeout(ms, callback) {
    if (typeof callback === 'function') {
      this.timeoutCallback = callback;
    }
    return this;
  }

  destroy(error) {
    this.destroyed = true;
    if (error) {
      this.emit('error', error);
    }
    this.emit('close');
    return this;
  }

  end() {
    this.destroyed = true;
    this.emit('end');
    this.emit('close');
    return this;
  }
}

/**
 * Creates a mock tls.connect function returning pre-configured MockTlsSockets.
 *
 * @param {object|Function} certOrHandler - Certificate object or handler mapping (options) -> cert.
 * @returns {Function} Callable mock for tls.connect(options, callback).
 */
export function createMockTlsConnect(certOrHandler) {
  return function mockTlsConnect(options, callback) {
    let cert;
    let simulateTimeout = false;
    let simulateError = null;

    if (typeof certOrHandler === 'function') {
      try {
        cert = certOrHandler(options);
      } catch (err) {
        simulateError = err;
      }
    } else if (certOrHandler && certOrHandler.simulateTimeout) {
      simulateTimeout = true;
    } else if (certOrHandler && certOrHandler.simulateError) {
      simulateError = certOrHandler.simulateError;
    } else if (certOrHandler) {
      cert = certOrHandler;
    } else {
      cert = createSyntheticPeerCertificate({ host: options.host || options.servername || 'example.com' });
    }

    const socket = new MockTlsSocket({ cert, simulateTimeout, simulateError });

    if (typeof callback === 'function') {
      socket.once('secureConnect', callback);
    }

    return socket;
  };
}
