import { execFile as nodeExecFile } from 'node:child_process';

/**
 * @typedef {Object} CommandExecutionResult
 * @property {number} exitCode - Exit code returned by the child process
 * @property {string} stdout - UTF-8 standard output string
 * @property {string} stderr - UTF-8 standard error string
 * @property {number} durationMs - Elapsed execution time in milliseconds
 * @property {boolean} ok - True if exitCode === 0
 * @property {boolean} timedOut - True if the process exceeded timeoutMs
 */

/**
 * Normalizes input arguments across polymorphic call signatures.
 *
 * @param {string} command
 * @param {string[]|object} [args]
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {{ cmd: string, cmdArgs: string[], opts: object, dependencies: object }}
 */
function normalizeRunCommandArgs(command, args = [], options = {}, deps = {}) {
  let cmdArgs = [];
  let opts = {};
  let dependencies = {};

  if (Array.isArray(args)) {
    cmdArgs = args;
    opts = options || {};
    dependencies = deps || {};
  } else if (typeof args === 'object' && args !== null) {
    cmdArgs = [];
    opts = args;
    dependencies = options || {};
  } else {
    cmdArgs = [];
    opts = options || {};
    dependencies = deps || {};
  }

  if (opts.deps && typeof opts.deps === 'object') {
    dependencies = { ...dependencies, ...opts.deps };
  }

  return {
    cmd: command,
    cmdArgs,
    opts,
    dependencies
  };
}

/**
 * Executes a system binary or command safely with timeout, buffer bounds,
 * and dependency injection support for deterministic mocking.
 *
 * @param {string} command - Executable file or binary name
 * @param {string[]} [args=[]] - Command arguments array
 * @param {object} [options={}] - Execution options
 * @param {number} [options.timeoutMs=15000] - Timeout in milliseconds (default: 15000)
 * @param {number} [options.maxBuffer=1048576] - Maximum stdout/stderr buffer in bytes (default: 1MB)
 * @param {string} [options.cwd] - Working directory for the process
 * @param {Record<string, string>} [options.env] - Additional environment variables
 * @param {boolean} [options.shell=false] - Whether to spawn in a shell
 * @param {boolean} [options.windowsHide=true] - Hide console window on Windows
 * @param {object} [deps={}] - Dependency injection
 * @param {Function} [deps.execFile] - Injected execFile implementation
 * @param {Function} [deps.runner] - Injected async runner implementation
 * @returns {Promise<CommandExecutionResult>}
 */
export async function runCommand(command, args = [], options = {}, deps = {}) {
  const { cmd, cmdArgs, opts, dependencies } = normalizeRunCommandArgs(command, args, options, deps);

  if (typeof cmd !== 'string' || !cmd.trim()) {
    throw new TypeError('Command must be a non-empty string');
  }

  const timeoutMs = Number(opts.timeoutMs ?? opts.timeout ?? 15000);
  const maxBuffer = Number(opts.maxBuffer ?? opts.maxBufferBytes ?? 1048576);
  const cwd = opts.cwd || process.cwd();
  const env = { ...process.env, ...(opts.env || {}) };
  const shell = Boolean(opts.shell);
  const windowsHide = opts.windowsHide !== false;

  const startTime = Date.now();

  // If a higher-level runner mock is provided in dependencies
  if (typeof dependencies.runner === 'function') {
    const rawResult = await dependencies.runner(cmd, cmdArgs, {
      timeoutMs,
      maxBuffer,
      cwd,
      env,
      shell
    });

    const durationMs = rawResult.durationMs ?? (Date.now() - startTime);
    const exitCode = typeof rawResult.exitCode === 'number' ? rawResult.exitCode : (rawResult.ok ? 0 : 1);
    const stdout = typeof rawResult.stdout === 'string' ? rawResult.stdout : '';
    const stderr = typeof rawResult.stderr === 'string' ? rawResult.stderr : '';
    const timedOut = Boolean(rawResult.timedOut);

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
      ok: exitCode === 0,
      timedOut
    };
  }

  const execFileFn = dependencies.execFile || nodeExecFile;

  return new Promise((resolve, reject) => {
    const execOptions = {
      timeout: timeoutMs,
      maxBuffer,
      cwd,
      env,
      shell,
      windowsHide,
      encoding: 'utf-8'
    };

    execFileFn(cmd, cmdArgs, execOptions, (error, stdoutRaw, stderrRaw) => {
      const durationMs = Date.now() - startTime;

      const stdout = typeof stdoutRaw === 'string'
        ? stdoutRaw
        : (Buffer.isBuffer(stdoutRaw) ? stdoutRaw.toString('utf-8') : (stdoutRaw ? String(stdoutRaw) : ''));

      let stderr = typeof stderrRaw === 'string'
        ? stderrRaw
        : (Buffer.isBuffer(stderrRaw) ? stderrRaw.toString('utf-8') : (stderrRaw ? String(stderrRaw) : ''));

      let timedOut = false;
      let exitCode = 0;

      if (error) {
        if (error.killed && (error.signal === 'SIGTERM' || error.message?.includes('timed out'))) {
          timedOut = true;
          exitCode = 124;
        } else if (typeof error.code === 'number') {
          exitCode = error.code;
        } else {
          exitCode = 1;
        }

        if (!stderr && error.message) {
          stderr = error.message;
        }
      }

      const result = {
        exitCode,
        stdout,
        stderr,
        durationMs,
        ok: exitCode === 0,
        timedOut
      };

      if (opts.rejectOnError && exitCode !== 0) {
        const cmdErr = new Error(`Command failed with exit code ${exitCode}: ${stderr || stdout}`);
        cmdErr.result = result;
        reject(cmdErr);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Alias of runCommand for backwards/forwards compatibility across architectural specifications.
 */
export const runSystemCommand = runCommand;
