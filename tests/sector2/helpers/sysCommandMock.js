/**
 * SysCommandMock: Universal mock runner for system binaries and bash commands.
 * Provides deterministic simulation of child_process / sysCommandRunner execution
 * across Docker CLI, PM2, apt-get, systemctl, fail2ban-client, cloudflared, and tailscale.
 *
 * Strict Policy: Zero Emojis.
 */

export class SysCommandMock {
  constructor() {
    this.rules = [];
    this.callHistory = [];
    this.defaultHandler = null;
  }

  /**
   * Registers a mock response for a command matching an exact string, substring, or RegExp.
   *
   * @param {string|RegExp|Function} matcher - Predicate matching the command line or arguments.
   * @param {object|Function} response - Result object or dynamic handler returning result object.
   * @param {number} [response.exitCode=0]
   * @param {string} [response.stdout='']
   * @param {string} [response.stderr='']
   * @param {number} [response.durationMs=10]
   * @param {boolean} [response.timedOut=false]
   * @returns {SysCommandMock} this instance for chaining
   */
  when(matcher, response) {
    this.rules.push({
      matcher,
      response,
      invocationCount: 0
    });
    return this;
  }

  /**
   * Sets a default fallback response for any command that does not match a rule.
   *
   * @param {object|Function} response
   */
  setDefault(response) {
    this.defaultHandler = response;
  }

  /**
   * Simulates running a command with arguments and options.
   * Compatible with sysCommandRunner.runCommand(cmd, args, options).
   *
   * @param {string} command - Executable binary or full command string.
   * @param {string[]} [args=[]] - Arguments array.
   * @param {object} [options={}] - Options (timeoutMs, cwd, env, etc.).
   * @returns {Promise<{ ok: boolean, exitCode: number, stdout: string, stderr: string, durationMs: number, timedOut: boolean }>}
   */
  async runCommand(command, args = [], options = {}) {
    const fullCommandLine = [command, ...args].join(' ').trim();
    const callRecord = {
      command,
      args: [...args],
      fullCommandLine,
      options: { ...options },
      timestamp: Date.now()
    };
    this.callHistory.push(callRecord);

    // Find matching rule
    for (const rule of this.rules) {
      let isMatch = false;
      if (typeof rule.matcher === 'function') {
        isMatch = rule.matcher(command, args, options, fullCommandLine);
      } else if (rule.matcher instanceof RegExp) {
        isMatch = rule.matcher.test(fullCommandLine) || rule.matcher.test(command);
      } else if (typeof rule.matcher === 'string') {
        isMatch = fullCommandLine.includes(rule.matcher) || command === rule.matcher;
      }

      if (isMatch) {
        rule.invocationCount++;
        let result;
        if (typeof rule.response === 'function') {
          result = await rule.response(command, args, options, rule.invocationCount);
        } else if (Array.isArray(rule.response)) {
          // Sequence of responses
          const idx = Math.min(rule.invocationCount - 1, rule.response.length - 1);
          result = rule.response[idx];
        } else {
          result = rule.response;
        }

        return this._formatResult(result);
      }
    }

    if (this.defaultHandler) {
      const result = typeof this.defaultHandler === 'function'
        ? await this.defaultHandler(command, args, options)
        : this.defaultHandler;
      return this._formatResult(result);
    }

    // Default unhandled command response
    return {
      ok: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 5,
      timedOut: false
    };
  }

  /**
   * Standardizes response format.
   * @private
   */
  _formatResult(res = {}) {
    const exitCode = typeof res.exitCode === 'number' ? res.exitCode : 0;
    const stdout = typeof res.stdout === 'string' ? res.stdout : '';
    const stderr = typeof res.stderr === 'string' ? res.stderr : '';
    const durationMs = typeof res.durationMs === 'number' ? res.durationMs : 10;
    const timedOut = Boolean(res.timedOut);
    const ok = exitCode === 0 && !timedOut;

    return {
      ok,
      exitCode,
      stdout,
      stderr,
      durationMs,
      timedOut
    };
  }

  /**
   * Returns all recorded calls.
   * @returns {Array<object>}
   */
  getCalls() {
    return [...this.callHistory];
  }

  /**
   * Returns calls matching a search string or RegExp.
   *
   * @param {string|RegExp} pattern
   * @returns {Array<object>}
   */
  getCallsMatching(pattern) {
    if (pattern instanceof RegExp) {
      return this.callHistory.filter(c => pattern.test(c.fullCommandLine));
    }
    return this.callHistory.filter(c => c.fullCommandLine.includes(pattern));
  }

  /**
   * Returns the count of executions matching a pattern.
   *
   * @param {string|RegExp} pattern
   * @returns {number}
   */
  getCallCount(pattern) {
    if (!pattern) return this.callHistory.length;
    return this.getCallsMatching(pattern).length;
  }

  /**
   * Returns the last recorded command execution call.
   * @returns {object|null}
   */
  getLastCall() {
    if (this.callHistory.length === 0) return null;
    return this.callHistory[this.callHistory.length - 1];
  }

  /**
   * Clears rules and recorded history.
   */
  reset() {
    this.rules = [];
    this.callHistory = [];
    this.defaultHandler = null;
  }

  /**
   * Clears call history while retaining registered rules.
   */
  clearHistory() {
    this.callHistory = [];
    for (const rule of this.rules) {
      rule.invocationCount = 0;
    }
  }

  /**
   * Creates a callable runner function for dependency injection.
   * Usage:
   * const mock = new SysCommandMock();
   * await inspectContainers({ runner: mock.asRunner() });
   */
  asRunner() {
    return (cmd, args, opts) => this.runCommand(cmd, args, opts);
  }
}

/**
 * Factory creating a fresh SysCommandMock instance.
 * @returns {SysCommandMock}
 */
export function createSysCommandMock() {
  return new SysCommandMock();
}
