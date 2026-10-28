import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTunnelStatus,
  startTunnel,
  stopTunnel
} from '../../tunnelManagerService.js';
import {
  CLOUDFLARE_TUNNEL_OUTPUTS,
  TAILSCALE_JSON_OUTPUTS
} from './fixtures/tunnelFixtures.js';
import { createSysCommandMock } from './helpers/sysCommandMock.js';
import { assertNoEmojis } from './helpers/s2Validators.js';

describe('Sector 2 - Task 19: Dynamic Cloudflare and Tailscale Tunnel Manager', () => {
  let mockCmd;

  beforeEach(() => {
    mockCmd = createSysCommandMock();
  });

  describe('Part 1: Cloudflare Tunnel (cloudflared) Management', () => {
    it('should query healthy running Cloudflare tunnel status and parse details', async () => {
      mockCmd.when(/cloudflared.*tunnel.*info/, {
        exitCode: 0,
        stdout: CLOUDFLARE_TUNNEL_OUTPUTS.runningHealthy,
        stderr: ''
      });

      const status = await getTunnelStatus('cloudflare', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'cloudflare');
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.running, true);
      assert.strictEqual(status.details.tunnelName, 'jarvis-vps');
      assert.strictEqual(status.details.id, 'a1b2c3d4-e5f6-4a1b-8c2d-9e0f1a2b3c4d');
      assert.strictEqual(status.details.activeConnections, 2);
      assert.strictEqual(status.details.status, 'HEALTHY');

      assertNoEmojis(status);
    });

    it('should query stopped/inactive Cloudflare tunnel status correctly', async () => {
      mockCmd.when(/cloudflared.*tunnel.*info/, {
        exitCode: 0,
        stdout: CLOUDFLARE_TUNNEL_OUTPUTS.stoppedInactive,
        stderr: ''
      });

      const status = await getTunnelStatus('cloudflare', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'cloudflare');
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.running, false);
      assert.strictEqual(status.details.activeConnections, 0);
      assert.strictEqual(status.details.status, 'INACTIVE');

      assertNoEmojis(status);
    });

    it('should handle uninstalled cloudflared binary gracefully without crashing', async () => {
      mockCmd.when(/cloudflared/, {
        exitCode: 127,
        stdout: '',
        stderr: 'cloudflared: command not found'
      });

      const status = await getTunnelStatus('cloudflare', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'cloudflare');
      assert.strictEqual(status.installed, false);
      assert.strictEqual(status.running, false);
      assert.ok(status.details.error);

      assertNoEmojis(status);
    });

    it('should start Cloudflare tunnel safely and return success confirmation', async () => {
      mockCmd.when(/cloudflared.*tunnel.*run/, {
        exitCode: 0,
        stdout: CLOUDFLARE_TUNNEL_OUTPUTS.startSuccess,
        stderr: ''
      });

      const result = await startTunnel('cloudflare', { runner: mockCmd.asRunner() });

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('started successfully'));

      const calls = mockCmd.getCallsMatching('cloudflared');
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].args, ['tunnel', 'run', 'jarvis-vps']);

      assertNoEmojis(result);
    });

    it('should stop Cloudflare tunnel safely and return confirmation', async () => {
      mockCmd.when(/cloudflared.*tunnel.*stop/, {
        exitCode: 0,
        stdout: CLOUDFLARE_TUNNEL_OUTPUTS.stopSuccess,
        stderr: ''
      });

      const result = await stopTunnel('cloudflare', { runner: mockCmd.asRunner() });

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('stopped successfully'));

      const calls = mockCmd.getCallsMatching('cloudflared');
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].args, ['tunnel', 'stop', 'jarvis-vps']);

      assertNoEmojis(result);
    });

    it('should fail cleanly when starting Cloudflare tunnel if binary is absent', async () => {
      const result = await startTunnel('cloudflare', { installed: false });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('not installed'));
      assertNoEmojis(result);
    });
  });

  describe('Part 2: Tailscale (tailscale) Management', () => {
    it('should query running Tailscale tunnel status and parse JSON telemetry', async () => {
      mockCmd.when(/tailscale.*status/, {
        exitCode: 0,
        stdout: TAILSCALE_JSON_OUTPUTS.running,
        stderr: ''
      });

      const status = await getTunnelStatus('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'tailscale');
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.running, true);
      assert.strictEqual(status.details.backendState, 'Running');
      assert.strictEqual(status.details.version, '1.74.0');
      assert.strictEqual(status.details.self.HostName, 'vps-oracle');
      assert.strictEqual(status.details.peerCount, 1);
      assert.ok(status.details.tailscaleIPs.includes('100.85.12.34'));

      assertNoEmojis(status);
    });

    it('should query stopped Tailscale tunnel status correctly', async () => {
      mockCmd.when(/tailscale.*status/, {
        exitCode: 0,
        stdout: TAILSCALE_JSON_OUTPUTS.stopped,
        stderr: ''
      });

      const status = await getTunnelStatus('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'tailscale');
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.running, false);
      assert.strictEqual(status.details.backendState, 'Stopped');

      assertNoEmojis(status);
    });

    it('should handle Tailscale NeedsLogin state as not running with auth URL', async () => {
      mockCmd.when(/tailscale.*status/, {
        exitCode: 0,
        stdout: TAILSCALE_JSON_OUTPUTS.needsLogin,
        stderr: ''
      });

      const status = await getTunnelStatus('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'tailscale');
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.running, false);
      assert.strictEqual(status.details.backendState, 'NeedsLogin');
      assert.ok(status.details.authUrl.includes('login.tailscale.com'));

      assertNoEmojis(status);
    });

    it('should handle uninstalled tailscale binary gracefully', async () => {
      mockCmd.when(/tailscale/, {
        exitCode: 127,
        stdout: '',
        stderr: 'tailscale: not found'
      });

      const status = await getTunnelStatus('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(status.tunnelType, 'tailscale');
      assert.strictEqual(status.installed, false);
      assert.strictEqual(status.running, false);
      assert.ok(status.details.error);

      assertNoEmojis(status);
    });

    it('should start Tailscale tunnel with tailscale up', async () => {
      mockCmd.when(/tailscale.*up/, {
        exitCode: 0,
        stdout: 'Success.',
        stderr: ''
      });

      const result = await startTunnel('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('started successfully'));

      const calls = mockCmd.getCallsMatching('tailscale');
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].args, ['up']);

      assertNoEmojis(result);
    });

    it('should stop Tailscale tunnel with tailscale down', async () => {
      mockCmd.when(/tailscale.*down/, {
        exitCode: 0,
        stdout: 'Success.',
        stderr: ''
      });

      const result = await stopTunnel('tailscale', { runner: mockCmd.asRunner() });

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('stopped successfully'));

      const calls = mockCmd.getCallsMatching('tailscale');
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].args, ['down']);

      assertNoEmojis(result);
    });

    it('should fail cleanly when stopping Tailscale if binary is absent', async () => {
      const result = await stopTunnel('tailscale', { installed: false });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('not installed'));
      assertNoEmojis(result);
    });
  });

  describe('Part 3: Security & Input Validation', () => {
    it('should reject unsupported tunnel types', async () => {
      await assert.rejects(
        async () => {
          await getTunnelStatus('wireguard');
        },
        {
          message: /Unsupported tunnel type/
        }
      );

      await assert.rejects(
        async () => {
          await startTunnel('openvpn');
        },
        {
          message: /Unsupported tunnel type/
        }
      );

      await assert.rejects(
        async () => {
          await stopTunnel('');
        },
        {
          name: 'TypeError'
        }
      );
    });

    it('should reject malicious tunnel names with shell injection vectors', async () => {
      await assert.rejects(
        async () => {
          await getTunnelStatus('cloudflare', { tunnelName: 'test; rm -rf /' });
        },
        {
          message: /Invalid Cloudflare tunnel name/
        }
      );

      await assert.rejects(
        async () => {
          await startTunnel('cloudflare', { tunnelName: 'test$(reboot)' });
        },
        {
          message: /Invalid Cloudflare tunnel name/
        }
      );

      await assert.rejects(
        async () => {
          await stopTunnel('cloudflare', { tunnelName: 'test | whoami' });
        },
        {
          message: /Invalid Cloudflare tunnel name/
        }
      );
    });
  });
});
