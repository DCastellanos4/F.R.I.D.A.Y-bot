import tls from 'node:tls';
import { enqueueAlert } from './alertQueueService.js';

/**
 * SSL Monitor Service for Proactive Certificate Expiry Verification.
 *
 * Connects via native node:tls socket, inspects the peer x509 certificate,
 * calculates exact days remaining, and raises proactive warning alerts
 * when expiry is under 15 days.
 *
 * Supports dependency injection for deterministic offline testing via tlsMock.js.
 * Strict Policy: Zero Emojis.
 */

/**
 * Normalizes polymorphic arguments for checkCertificateExpiry.
 *
 * @private
 */
function normalizeSslArgs(host, port, options, deps) {
  let finalPort = 443;
  let finalOptions = {};
  let finalDeps = {};

  if (typeof port === 'number' || (typeof port === 'string' && /^\d+$/.test(port))) {
    finalPort = Number(port);
    if (typeof options === 'object' && options !== null) {
      finalOptions = options;
    }
    if (typeof deps === 'object' && deps !== null) {
      finalDeps = deps;
    }
  } else if (typeof port === 'object' && port !== null) {
    // checkCertificateExpiry(host, deps) or checkCertificateExpiry(host, options)
    finalPort = Number(port.port) || 443;
    finalOptions = port;
    finalDeps = port;
  }

  // Merge deps from options if provided
  if (finalOptions.deps && typeof finalOptions.deps === 'object') {
    finalDeps = { ...finalDeps, ...finalOptions.deps };
  }

  return {
    finalPort,
    finalOptions,
    finalDeps
  };
}

/**
 * Connects to a remote host via TLS socket, extracts the x509 peer certificate,
 * and calculates exact days remaining before expiration.
 *
 * @param {string} host - Target hostname or IP.
 * @param {number|object} [port=443] - Target port or options object.
 * @param {object} [options={}] - Options (timeoutMs, thresholdDays).
 * @param {object} [deps={}] - Injected dependencies (tlsConnect, now, enqueueAlert).
 * @returns {Promise<{ host: string, port: number, validTo: string, validFrom: string, daysRemaining: number, exactDaysRemaining: number, isExpiringSoon: boolean, isExpired: boolean, issuer: string, subject: string, fingerprint256: string }>}
 */
export async function checkCertificateExpiry(host, port = 443, options = {}, deps = {}) {
  if (!host || typeof host !== 'string' || !host.trim()) {
    throw new TypeError('Target host must be a non-empty string');
  }

  const { finalPort, finalOptions, finalDeps } = normalizeSslArgs(host, port, options, deps);

  const cleanHost = host.trim();
  const tlsConnectFn = finalDeps.tlsConnect || finalDeps.connect || tls.connect;
  const timeoutMs = Number(finalOptions.timeoutMs ?? finalOptions.timeout ?? 10000);
  const thresholdDays = Number(finalOptions.thresholdDays ?? finalDeps.thresholdDays ?? 15);

  const getNowMs = () => {
    if (finalDeps.now !== undefined) {
      return typeof finalDeps.now === 'function' ? finalDeps.now() : Number(finalDeps.now);
    }
    return Date.now();
  };

  return new Promise((resolve, reject) => {
    let finished = false;

    const connectOptions = {
      host: cleanHost,
      port: finalPort,
      servername: cleanHost,
      rejectUnauthorized: false,
      ...finalOptions
    };

    const cleanupAndFinish = (err, result) => {
      if (finished) return;
      finished = true;
      try {
        if (socket && !socket.destroyed) {
          socket.destroy();
        }
      } catch {
        // Ignore socket destroy errors
      }

      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };

    let socket;
    try {
      socket = tlsConnectFn(connectOptions, () => {
        try {
          const cert = socket.getPeerCertificate(true);
          if (!cert || Object.keys(cert).length === 0) {
            return cleanupAndFinish(new Error(`No peer certificate found for ${cleanHost}:${finalPort}`));
          }

          const validTo = cert.valid_to;
          const validFrom = cert.valid_from;

          if (!validTo) {
            return cleanupAndFinish(new Error(`Certificate missing valid_to field for ${cleanHost}:${finalPort}`));
          }

          const validToMs = new Date(validTo).getTime();
          if (Number.isNaN(validToMs)) {
            return cleanupAndFinish(new Error(`Unparseable valid_to date '${validTo}' for ${cleanHost}`));
          }

          const nowMs = getNowMs();
          const diffMs = validToMs - nowMs;
          const exactDays = diffMs / 86400000;
          let daysRemaining = Math.round(exactDays);
          if (daysRemaining === 0) {
            daysRemaining = 0;
          }
          const isExpiringSoon = daysRemaining < thresholdDays;
          const isExpired = daysRemaining <= 0;

          const issuer = cert.issuer?.O || cert.issuer?.CN || (typeof cert.issuer === 'string' ? cert.issuer : 'Desconocido');
          const subject = cert.subject?.CN || (typeof cert.subject === 'string' ? cert.subject : cleanHost);
          const fingerprint256 = cert.fingerprint256 || '';

          const result = {
            host: cleanHost,
            port: finalPort,
            validTo,
            validFrom,
            daysRemaining,
            exactDaysRemaining: Number(exactDays.toFixed(2)),
            isExpiringSoon,
            isExpired,
            issuer,
            subject,
            fingerprint256
          };

          cleanupAndFinish(null, result);
        } catch (innerErr) {
          cleanupAndFinish(innerErr);
        }
      });
    } catch (launchErr) {
      return cleanupAndFinish(launchErr);
    }

    if (socket && typeof socket.setTimeout === 'function') {
      socket.setTimeout(timeoutMs, () => {
        cleanupAndFinish(new Error(`TLS connection to ${cleanHost}:${finalPort} timed out after ${timeoutMs}ms`));
      });
    }

    if (socket && typeof socket.on === 'function') {
      socket.on('error', (err) => {
        cleanupAndFinish(err);
      });
    }
  });
}

/**
 * Formats a clean, zero-emoji notification alert for expiring or expired SSL certificates.
 *
 * @param {object} certInfo - Certificate evaluation result.
 * @returns {{ alertText: string, priority: string, title: string }}
 */
export function formatSslExpiryAlert(certInfo) {
  const host = certInfo?.host || 'desconocido';
  const daysRemaining = certInfo?.daysRemaining ?? 0;
  const validTo = certInfo?.validTo || 'desconocida';
  const issuer = certInfo?.issuer || 'desconocido';
  const isExpired = certInfo?.isExpired || daysRemaining <= 0;

  const priority = isExpired ? 'urgent' : 'high';
  const title = isExpired
    ? `Certificado SSL caducado: ${host}`
    : `Certificado SSL proximo a caducar: ${host}`;

  const lines = [
    `[ALERTA SSL] ${title}`,
    `Host: ${host}`,
    `Dias restantes: ${daysRemaining}`,
    `Fecha de expiracion: ${validTo}`,
    `Emisor: ${issuer}`,
    `Estado: ${isExpired ? 'EXPIRADO' : 'PROXIMO_A_EXPIRAR'}`
  ];

  return {
    alertText: lines.join('\n'),
    priority,
    title
  };
}

/**
 * Checks certificate expiry and automatically enqueues an alert if expiry is under threshold.
 *
 * @param {string} host - Target host.
 * @param {number|object} [port=443] - Port or options.
 * @param {object} [options={}] - Options.
 * @param {object} [deps={}] - Injected dependencies.
 * @returns {Promise<{ certInfo: object, alertEnqueued: boolean, alert?: object }>}
 */
export async function checkAndAlertExpiry(host, port = 443, options = {}, deps = {}) {
  const certInfo = await checkCertificateExpiry(host, port, options, deps);
  const { finalDeps } = normalizeSslArgs(host, port, options, deps);

  if (certInfo.isExpiringSoon) {
    const { alertText, priority, title } = formatSslExpiryAlert(certInfo);
    const enqueueFn = finalDeps.enqueueAlert || enqueueAlert;

    const alertRecord = enqueueFn({
      title,
      details: alertText,
      priority,
      metadata: {
        host: certInfo.host,
        port: certInfo.port,
        daysRemaining: certInfo.daysRemaining,
        validTo: certInfo.validTo,
        isExpired: certInfo.isExpired,
        issuer: certInfo.issuer
      }
    });

    return {
      certInfo,
      alertEnqueued: true,
      alert: alertRecord
    };
  }

  return {
    certInfo,
    alertEnqueued: false
  };
}

/**
 * Inspects a batch of hostnames concurrently.
 *
 * @param {string[]} hosts - Array of hostnames.
 * @param {object} [options={}] - Options.
 * @param {object} [deps={}] - Dependencies.
 * @returns {Promise<Array<object>>} Array of evaluation results.
 */
export async function batchCheckCertificates(hosts, options = {}, deps = {}) {
  if (!Array.isArray(hosts)) {
    throw new TypeError('Hosts must be an array of strings');
  }

  return Promise.all(
    hosts.map((host) => checkCertificateExpiry(host, options.port || 443, options, deps))
  );
}
