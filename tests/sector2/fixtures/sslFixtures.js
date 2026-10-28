import { createSyntheticPeerCertificate } from '../helpers/tlsMock.js';

/**
 * SSL / TLS Certificate Fixtures for Task 17 (Proactive SSL Expiry Verifier).
 *
 * Provides synthetic peer certificates representing healthy, expiring soon,
 * and already expired certificates with various issuer and SAN profiles.
 *
 * Strict Policy: Zero Emojis.
 */

export const SSL_SCENARIOS = {
  healthy: {
    host: 'vps.davidcastellanos.dev',
    daysRemaining: 75,
    issuer: "Let's Encrypt",
    cert: createSyntheticPeerCertificate({
      host: 'vps.davidcastellanos.dev',
      daysRemaining: 75,
      issuer: "Let's Encrypt"
    }),
    expected: {
      isExpiringSoon: false,
      isExpired: false
    }
  },

  expiringSoon10Days: {
    host: 'api.davidcastellanos.dev',
    daysRemaining: 10,
    issuer: "Let's Encrypt",
    cert: createSyntheticPeerCertificate({
      host: 'api.davidcastellanos.dev',
      daysRemaining: 10,
      issuer: "Let's Encrypt"
    }),
    expected: {
      isExpiringSoon: true, // < 15 days threshold
      isExpired: false
    }
  },

  critical3Days: {
    host: 'auth.davidcastellanos.dev',
    daysRemaining: 3,
    issuer: 'DigiCert Global Root G2',
    cert: createSyntheticPeerCertificate({
      host: 'auth.davidcastellanos.dev',
      daysRemaining: 3,
      issuer: 'DigiCert Global Root G2'
    }),
    expected: {
      isExpiringSoon: true,
      isExpired: false
    }
  },

  expiredNegative5Days: {
    host: 'old-service.davidcastellanos.dev',
    daysRemaining: -5,
    issuer: "Let's Encrypt",
    cert: createSyntheticPeerCertificate({
      host: 'old-service.davidcastellanos.dev',
      daysRemaining: -5,
      issuer: "Let's Encrypt"
    }),
    expected: {
      isExpiringSoon: true,
      isExpired: true
    }
  },

  wildcardCert: {
    host: '*.davidcastellanos.dev',
    daysRemaining: 45,
    issuer: 'Cloudflare Inc ECC CA-3',
    cert: createSyntheticPeerCertificate({
      host: '*.davidcastellanos.dev',
      daysRemaining: 45,
      issuer: 'Cloudflare Inc ECC CA-3'
    }),
    expected: {
      isExpiringSoon: false,
      isExpired: false
    }
  }
};

export const BATCH_TEST_DOMAINS = [
  'vps.davidcastellanos.dev',
  'api.davidcastellanos.dev',
  'auth.davidcastellanos.dev',
  'old-service.davidcastellanos.dev'
];
