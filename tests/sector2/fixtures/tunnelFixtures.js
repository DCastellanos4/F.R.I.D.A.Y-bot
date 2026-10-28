/**
 * Tunnel Manager Test Fixtures for Task 19 (Dynamic Tunnel Manager).
 *
 * Provides synthetic CLI outputs and JSON structures for Cloudflare Tunnel (cloudflared)
 * and Tailscale (tailscale).
 *
 * Strict Policy: Zero Emojis.
 */

export const CLOUDFLARE_TUNNEL_OUTPUTS = {
  runningHealthy: [
    'NAME: jarvis-vps',
    'ID: a1b2c3d4-e5f6-4a1b-8c2d-9e0f1a2b3c4d',
    'CREATED: 2026-05-10T12:00:00Z',
    'CONNECTIONS:',
    '  - CONNECTOR ID: conn-01 | REGION: mad | STATUS: HEALTHY',
    '  - CONNECTOR ID: conn-02 | REGION: cdg | STATUS: HEALTHY',
    'ACTIVE CONNECTIONS: 2',
    'TUNNEL STATUS: HEALTHY'
  ].join('\n'),

  stoppedInactive: [
    'NAME: jarvis-vps',
    'ID: a1b2c3d4-e5f6-4a1b-8c2d-9e0f1a2b3c4d',
    'CREATED: 2026-05-10T12:00:00Z',
    'CONNECTIONS: None',
    'ACTIVE CONNECTIONS: 0',
    'TUNNEL STATUS: INACTIVE'
  ].join('\n'),

  startSuccess: 'Tunnel jarvis-vps started successfully. Process PID: 19824\n',
  stopSuccess: 'Tunnel jarvis-vps stopped successfully.\n'
};

export const TAILSCALE_JSON_OUTPUTS = {
  running: JSON.stringify({
    Version: '1.74.0',
    BackendState: 'Running',
    AuthURL: '',
    TailscaleIPs: ['100.85.12.34', 'fd7a:115c:a1e0::22'],
    Self: {
      ID: 'node-vps-oracle',
      HostName: 'vps-oracle',
      DNSName: 'vps-oracle.tailnet.ts.net.',
      TailscaleIPs: ['100.85.12.34', 'fd7a:115c:a1e0::22'],
      Online: true,
      OS: 'linux'
    },
    Peer: {
      'node-david-laptop': {
        ID: 'node-david-laptop',
        HostName: 'davids-macbook',
        DNSName: 'davids-macbook.tailnet.ts.net.',
        TailscaleIPs: ['100.85.12.35'],
        Online: true,
        LastSeen: '2026-10-28T16:40:00Z'
      }
    }
  }),

  stopped: JSON.stringify({
    Version: '1.74.0',
    BackendState: 'Stopped',
    AuthURL: '',
    TailscaleIPs: null,
    Self: {
      ID: 'node-vps-oracle',
      HostName: 'vps-oracle',
      Online: false
    },
    Peer: {}
  }),

  needsLogin: JSON.stringify({
    Version: '1.74.0',
    BackendState: 'NeedsLogin',
    AuthURL: 'https://login.tailscale.com/a/abcdef123456',
    TailscaleIPs: null,
    Self: {
      HostName: 'vps-oracle',
      Online: false
    },
    Peer: {}
  })
};
