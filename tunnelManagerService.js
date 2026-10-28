import { runCommand as defaultRunCommand } from './sysCommandRunner.js';

/**
 * Tunnel Manager Service for Dynamic Cloudflare and Tailscale Tunnel Administration.
 *
 * Provides:
 * 1. Status querying (running, stopped, installed, metadata).
 * 2. Start and stop operations with safe execFile execution (no shell injection).
 * 3. Graceful fallback when tunnel binaries are not installed on the system.
 *
 * Strict Policy: Zero Emojis.
 */

const SUPPORTED_TUNNELS = ['cloudflare', 'tailscale'];
const SAFE_NAME_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Executes a command safely through sysCommandRunner or injected runner.
 *
 * @private
 */
async function executeSafeCommand(command, args = [], options = {}, deps = {}) {
  if (typeof deps.runCommand === 'function') {
    return deps.runCommand(command, args, options, deps);
  }
  return defaultRunCommand(command, args, options, deps);
}

/**
 * Checks whether command result indicates that binary is missing.
 *
 * @private
 */
function isBinaryMissing(result, binaryName) {
  if (!result) return true;
  if (result.exitCode === 127) return true;

  const combined = `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase();
  return (
    combined.includes('enoent') ||
    combined.includes('not found') ||
    combined.includes('is not recognized') ||
    combined.includes('no such file or directory') ||
    combined.includes(`cannot find ${binaryName}`)
  );
}

/**
 * Validates and normalizes tunnel type.
 *
 * @private
 */
function normalizeTunnelType(tunnelType) {
  if (!tunnelType || typeof tunnelType !== 'string') {
    throw new TypeError(`Tunnel type must be a non-empty string. Supported types: ${SUPPORTED_TUNNELS.join(', ')}`);
  }
  const normalized = tunnelType.trim().toLowerCase();
  if (!SUPPORTED_TUNNELS.includes(normalized)) {
    throw new Error(`Unsupported tunnel type '${tunnelType}'. Supported types: ${SUPPORTED_TUNNELS.join(', ')}`);
  }
  return normalized;
}

/**
 * Retrieves operational status of Cloudflare Tunnel or Tailscale.
 *
 * @param {'cloudflare'|'tailscale'} tunnelType - Target tunnel system.
 * @param {object} [deps={}] - Injected dependencies (runner, runCommand, tunnelName, etc.).
 * @returns {Promise<{ tunnelType: 'cloudflare'|'tailscale', installed: boolean, running: boolean, details: object }>}
 */
export async function getTunnelStatus(tunnelType, deps = {}) {
  const type = normalizeTunnelType(tunnelType);

  if (deps.installed === false) {
    return {
      tunnelType: type,
      installed: false,
      running: false,
      details: { error: `Binary ${type === 'cloudflare' ? 'cloudflared' : 'tailscale'} not installed` }
    };
  }

  if (type === 'cloudflare') {
    const binary = 'cloudflared';
    const tunnelName = deps.tunnelName || 'jarvis-vps';

    if (!SAFE_NAME_REGEX.test(tunnelName)) {
      throw new Error(`Invalid Cloudflare tunnel name '${tunnelName}'`);
    }

    try {
      const result = await executeSafeCommand(binary, ['tunnel', 'info', tunnelName], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          tunnelType: 'cloudflare',
          installed: false,
          running: false,
          details: { error: 'cloudflared binary not found' }
        };
      }

      const stdout = result.stdout || '';
      const isHealthy = /TUNNEL STATUS:\s*HEALTHY/i.test(stdout) || /STATUS:\s*HEALTHY/i.test(stdout);
      const isInactive = /TUNNEL STATUS:\s*INACTIVE/i.test(stdout) || /STATUS:\s*INACTIVE/i.test(stdout);

      const nameMatch = stdout.match(/NAME:\s*([^\r\n]+)/i);
      const idMatch = stdout.match(/ID:\s*([^\r\n]+)/i);
      const createdMatch = stdout.match(/CREATED:\s*([^\r\n]+)/i);
      const connectionsMatch = stdout.match(/ACTIVE CONNECTIONS:\s*(\d+)/i);
      const statusMatch = stdout.match(/TUNNEL STATUS:\s*([^\r\n]+)/i);

      const running = isHealthy && !isInactive;

      return {
        tunnelType: 'cloudflare',
        installed: true,
        running,
        details: {
          tunnelName: nameMatch ? nameMatch[1].trim() : tunnelName,
          id: idMatch ? idMatch[1].trim() : null,
          created: createdMatch ? createdMatch[1].trim() : null,
          activeConnections: connectionsMatch ? parseInt(connectionsMatch[1], 10) : (running ? 1 : 0),
          status: statusMatch ? statusMatch[1].trim() : (running ? 'HEALTHY' : 'INACTIVE'),
          rawOutput: stdout
        }
      };
    } catch (err) {
      return {
        tunnelType: 'cloudflare',
        installed: false,
        running: false,
        details: { error: err.message || 'Error querying cloudflared status' }
      };
    }
  }

  if (type === 'tailscale') {
    const binary = 'tailscale';

    try {
      const result = await executeSafeCommand(binary, ['status', '--json'], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          tunnelType: 'tailscale',
          installed: false,
          running: false,
          details: { error: 'tailscale binary not found' }
        };
      }

      let parsed = null;
      try {
        parsed = JSON.parse(result.stdout || '{}');
      } catch {
        return {
          tunnelType: 'tailscale',
          installed: true,
          running: false,
          details: { error: 'Failed to parse tailscale JSON status', rawOutput: result.stdout }
        };
      }

      const backendState = parsed.BackendState || 'Unknown';
      const selfOnline = Boolean(parsed.Self?.Online);
      const running = backendState === 'Running' && selfOnline;

      const peerCount = parsed.Peer ? Object.keys(parsed.Peer).length : 0;
      const tailscaleIPs = parsed.TailscaleIPs || parsed.Self?.TailscaleIPs || [];

      return {
        tunnelType: 'tailscale',
        installed: true,
        running,
        details: {
          version: parsed.Version || null,
          backendState,
          tailscaleIPs,
          self: parsed.Self || null,
          peerCount,
          authUrl: parsed.AuthURL || null
        }
      };
    } catch (err) {
      return {
        tunnelType: 'tailscale',
        installed: false,
        running: false,
        details: { error: err.message || 'Error querying tailscale status' }
      };
    }
  }

  throw new Error(`Unhandled tunnel type: ${type}`);
}

/**
 * Starts a specified tunnel safely without shell execution.
 *
 * @param {'cloudflare'|'tailscale'} tunnelType - Tunnel type to start.
 * @param {object} [deps={}] - Injected dependencies.
 * @returns {Promise<{ success: boolean, message: string, details?: object }>}
 */
export async function startTunnel(tunnelType, deps = {}) {
  const type = normalizeTunnelType(tunnelType);

  if (deps.installed === false) {
    return {
      success: false,
      message: `Cannot start tunnel: ${type === 'cloudflare' ? 'cloudflared' : 'tailscale'} binary is not installed`
    };
  }

  if (type === 'cloudflare') {
    const binary = 'cloudflared';
    const tunnelName = deps.tunnelName || 'jarvis-vps';

    if (!SAFE_NAME_REGEX.test(tunnelName)) {
      throw new Error(`Invalid Cloudflare tunnel name '${tunnelName}'`);
    }

    try {
      const result = await executeSafeCommand(binary, ['tunnel', 'run', tunnelName], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          success: false,
          message: 'cloudflared binary not found on system'
        };
      }

      if (result.ok || result.exitCode === 0) {
        return {
          success: true,
          message: result.stdout.trim() || `Tunnel cloudflare (${tunnelName}) started successfully`,
          details: { exitCode: result.exitCode }
        };
      }

      return {
        success: false,
        message: result.stderr.trim() || result.stdout.trim() || `Failed to start Cloudflare tunnel (${tunnelName})`
      };
    } catch (err) {
      return {
        success: false,
        message: `Error starting Cloudflare tunnel: ${err.message}`
      };
    }
  }

  if (type === 'tailscale') {
    const binary = 'tailscale';

    try {
      const result = await executeSafeCommand(binary, ['up'], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          success: false,
          message: 'tailscale binary not found on system'
        };
      }

      if (result.ok || result.exitCode === 0) {
        return {
          success: true,
          message: 'Tailscale tunnel started successfully',
          details: { exitCode: result.exitCode }
        };
      }

      return {
        success: false,
        message: result.stderr.trim() || result.stdout.trim() || 'Failed to start Tailscale tunnel'
      };
    } catch (err) {
      return {
        success: false,
        message: `Error starting Tailscale tunnel: ${err.message}`
      };
    }
  }

  throw new Error(`Unhandled tunnel type: ${type}`);
}

/**
 * Stops a specified tunnel safely without shell execution.
 *
 * @param {'cloudflare'|'tailscale'} tunnelType - Tunnel type to stop.
 * @param {object} [deps={}] - Injected dependencies.
 * @returns {Promise<{ success: boolean, message: string, details?: object }>}
 */
export async function stopTunnel(tunnelType, deps = {}) {
  const type = normalizeTunnelType(tunnelType);

  if (deps.installed === false) {
    return {
      success: false,
      message: `Cannot stop tunnel: ${type === 'cloudflare' ? 'cloudflared' : 'tailscale'} binary is not installed`
    };
  }

  if (type === 'cloudflare') {
    const binary = 'cloudflared';
    const tunnelName = deps.tunnelName || 'jarvis-vps';

    if (!SAFE_NAME_REGEX.test(tunnelName)) {
      throw new Error(`Invalid Cloudflare tunnel name '${tunnelName}'`);
    }

    try {
      const result = await executeSafeCommand(binary, ['tunnel', 'stop', tunnelName], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          success: false,
          message: 'cloudflared binary not found on system'
        };
      }

      if (result.ok || result.exitCode === 0) {
        return {
          success: true,
          message: result.stdout.trim() || `Tunnel cloudflare (${tunnelName}) stopped successfully`,
          details: { exitCode: result.exitCode }
        };
      }

      return {
        success: false,
        message: result.stderr.trim() || result.stdout.trim() || `Failed to stop Cloudflare tunnel (${tunnelName})`
      };
    } catch (err) {
      return {
        success: false,
        message: `Error stopping Cloudflare tunnel: ${err.message}`
      };
    }
  }

  if (type === 'tailscale') {
    const binary = 'tailscale';

    try {
      const result = await executeSafeCommand(binary, ['down'], {}, deps);

      if (isBinaryMissing(result, binary)) {
        return {
          success: false,
          message: 'tailscale binary not found on system'
        };
      }

      if (result.ok || result.exitCode === 0) {
        return {
          success: true,
          message: 'Tailscale tunnel stopped successfully',
          details: { exitCode: result.exitCode }
        };
      }

      return {
        success: false,
        message: result.stderr.trim() || result.stdout.trim() || 'Failed to stop Tailscale tunnel'
      };
    } catch (err) {
      return {
        success: false,
        message: `Error stopping Tailscale tunnel: ${err.message}`
      };
    }
  }

  throw new Error(`Unhandled tunnel type: ${type}`);
}
