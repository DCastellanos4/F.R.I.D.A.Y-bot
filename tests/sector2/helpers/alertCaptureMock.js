import assert from 'node:assert/strict';
import { assertNoEmojis } from './s2Validators.js';

/**
 * AlertCaptureMock: Intercepts and validates alerts dispatched by Sector 2 services
 * (via alertQueueService or direct WhatsApp messaging).
 *
 * Automatically verifies strict zero-emoji compliance on every captured message.
 */
export class AlertCaptureMock {
  constructor() {
    this.alerts = [];
  }

  /**
   * Enqueues an alert object or raw message string.
   * Compatible with alertQueueService.enqueueAlert and whatsappBot.enviarMensajeADavid.
   *
   * @param {string|object} alert - Alert payload or message text.
   * @returns {object} Normalized captured alert record.
   */
  capture(alert) {
    let record;
    const now = Date.now();

    if (typeof alert === 'string') {
      record = {
        title: 'WHATSAPP_MESSAGE',
        text: alert,
        details: alert,
        timestamp: now,
        priority: 'NORMAL'
      };
    } else if (alert && typeof alert === 'object') {
      record = {
        title: alert.title || alert.type || 'SYSTEM_ALERT',
        text: alert.text || alert.message || alert.details || '',
        details: alert.details || alert.text || '',
        timestamp: alert.timestamp || now,
        priority: alert.priority || 'NORMAL',
        metadata: { ...alert }
      };
    } else {
      record = {
        title: 'EMPTY_ALERT',
        text: String(alert),
        timestamp: now
      };
    }

    // Enforce strict zero-emoji rule across all captured alert properties
    assertNoEmojis(record, `AlertCaptureMock: Dispatched alert '${record.title}' contains forbidden emoji characters`);

    this.alerts.push(record);
    return record;
  }

  /**
   * Returns a notifier function suitable for dependency injection into services.
   *
   * @returns {Function} Callable async notifier: (alert) => Promise<void>
   */
  asNotifier() {
    return async (alert) => {
      this.capture(alert);
    };
  }

  /**
   * Returns all captured alerts.
   * @returns {Array<object>}
   */
  getAllAlerts() {
    return [...this.alerts];
  }

  /**
   * Returns the count of captured alerts.
   * @returns {number}
   */
  count() {
    return this.alerts.length;
  }

  /**
   * Returns the most recent captured alert, or null if none.
   * @returns {object|null}
   */
  getLastAlert() {
    if (this.alerts.length === 0) return null;
    return this.alerts[this.alerts.length - 1];
  }

  /**
   * Finds alerts matching a string or RegExp pattern in their text or details.
   *
   * @param {string|RegExp} pattern
   * @returns {Array<object>}
   */
  getAlertsMatching(pattern) {
    if (pattern instanceof RegExp) {
      return this.alerts.filter(a => pattern.test(a.text) || pattern.test(a.title));
    }
    return this.alerts.filter(a => a.text.includes(pattern) || a.title.includes(pattern));
  }

  /**
   * Asserts that at least one alert matching pattern was captured.
   *
   * @param {string|RegExp} pattern
   * @param {string} [context='Expected alert matching pattern']
   */
  assertAlertEmitted(pattern, context = 'Expected alert matching pattern') {
    const matches = this.getAlertsMatching(pattern);
    assert.ok(
      matches.length > 0,
      `${context}: No captured alert matched pattern '${pattern}'. Total alerts captured: ${this.alerts.length}`
    );
  }

  /**
   * Asserts that NO alerts were captured.
   *
   * @param {string} [context='Expected no alerts to be emitted']
   */
  assertNoAlertEmitted(context = 'Expected no alerts to be emitted') {
    assert.strictEqual(
      this.alerts.length,
      0,
      `${context}: Found ${this.alerts.length} captured alerts when 0 were expected`
    );
  }

  /**
   * Clears all captured alerts.
   */
  clear() {
    this.alerts = [];
  }
}

/**
 * Factory creating a fresh AlertCaptureMock instance.
 * @returns {AlertCaptureMock}
 */
export function createAlertCaptureMock() {
  return new AlertCaptureMock();
}
