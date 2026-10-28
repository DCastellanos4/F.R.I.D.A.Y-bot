import fsPromises from 'node:fs/promises';
import os from 'node:os';
import { enqueueAlert } from './alertQueueService.js';

export const DEFAULT_PROC_NET_DEV_PATH = '/proc/net/dev';
export const DEFAULT_SPIKE_THRESHOLD_MBPS = 10.0;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Module-level state tracking the previous sample and last alert timestamp.
 */
let defaultState = {
  lastSample: null,
  lastAlertTime: 0
};

/**
 * Resets module-level state for isolation in test suites.
 */
export function resetNetworkMonitorState() {
  defaultState = {
    lastSample: null,
    lastAlertTime: 0
  };
}

/**
 * Checks whether a network interface is virtual, bridge, or loopback.
 * Physical/WAN interfaces (eth0, ens3, enp0s3) return false.
 *
 * @param {string} ifaceName - Interface name.
 * @returns {boolean} True if virtual or non-WAN interface.
 */
export function isVirtualInterface(ifaceName) {
  if (typeof ifaceName !== 'string') return true;
  const name = ifaceName.trim().toLowerCase();

  // Match loopback, docker bridges, veth pairs, br bridges, tun/tap, tailscale, virbr
  const virtualPattern = /^(lo|docker\d*|veth.*|br.*|virbr.*|tailscale.*|tun\d*|tap\d*|dummy\d*)/i;
  return virtualPattern.test(name);
}

/**
 * Parses Linux /proc/net/dev format string into structured interface counter objects.
 *
 * Line layout:
 * Inter-|   Receive                                                |  Transmit
 *  face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 *
 * @param {string} content - Raw content of /proc/net/dev.
 * @returns {Array<{ name: string, rxBytes: number, txBytes: number, rxPackets: number, txPackets: number, isVirtual: boolean }>}
 */
export function parseProcNetDev(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const interfaces = [];

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const ifaceName = line.slice(0, colonIndex).trim();
    if (!ifaceName || ifaceName.includes('Inter-') || ifaceName.includes('face')) {
      continue;
    }

    const rest = line.slice(colonIndex + 1).trim();
    const columns = rest.split(/\s+/).filter(Boolean);

    if (columns.length < 9) {
      continue;
    }

    const rxBytes = Number(columns[0]) || 0;
    const rxPackets = Number(columns[1]) || 0;
    const txBytes = Number(columns[8]) || 0;
    const txPackets = Number(columns[9]) || 0;

    interfaces.push({
      name: ifaceName,
      rxBytes,
      txBytes,
      rxPackets,
      txPackets,
      isVirtual: isVirtualInterface(ifaceName)
    });
  }

  return interfaces;
}

/**
 * Reads RX and TX bytes from /proc/net/dev, falling back to os.networkInterfaces().
 * Automatically filters virtual/loopback interfaces to focus on the primary WAN interface.
 *
 * @param {object} [deps={}] - Dependency injection.
 * @returns {Promise<{ rxBytes: number, txBytes: number, timestamp: number, iface: string, interfaces?: Array<object> }>}
 */
export async function readNetworkBytes(deps = {}) {
  const timestamp = typeof deps.now === 'function' ? deps.now() : Date.now();
  const procPath = deps.procNetDevPath || DEFAULT_PROC_NET_DEV_PATH;

  let rawContent = null;

  if (typeof deps.procNetDevContent === 'string') {
    rawContent = deps.procNetDevContent;
  } else if (typeof deps.readFile === 'function') {
    try {
      rawContent = await deps.readFile(procPath, 'utf8');
    } catch {
      rawContent = null;
    }
  } else {
    try {
      rawContent = await fsPromises.readFile(procPath, 'utf8');
    } catch {
      rawContent = null;
    }
  }

  if (typeof rawContent === 'string') {
    const interfaces = parseProcNetDev(rawContent);

    if (interfaces.length > 0) {
      let chosen = null;

      if (deps.interface) {
        chosen = interfaces.find(i => i.name === deps.interface);
      }

      if (!chosen) {
        // Select first physical / non-virtual interface
        chosen = interfaces.find(i => !i.isVirtual);
      }

      // If all are marked virtual, fallback to first interface
      if (!chosen) {
        chosen = interfaces[0];
      }

      return {
        rxBytes: chosen.rxBytes,
        txBytes: chosen.txBytes,
        timestamp,
        iface: chosen.name,
        interfaces
      };
    }
  }

  // Fallback to os.networkInterfaces()
  const netIfaces = typeof deps.networkInterfaces === 'function'
    ? deps.networkInterfaces()
    : os.networkInterfaces();

  let fallbackIfaceName = 'eth0';
  for (const [name, addrs] of Object.entries(netIfaces || {})) {
    if (!isVirtualInterface(name)) {
      const hasNonInternal = Array.isArray(addrs) && addrs.some(a => !a.internal);
      if (hasNonInternal) {
        fallbackIfaceName = name;
        break;
      }
    }
  }

  const fallbackCounters = deps.fallbackCounters || { rxBytes: 0, txBytes: 0 };

  return {
    rxBytes: fallbackCounters.rxBytes || 0,
    txBytes: fallbackCounters.txBytes || 0,
    timestamp,
    iface: fallbackIfaceName,
    isFallback: true
  };
}

/**
 * Calculates MB/s throughput rate between two samples.
 * Detects counter resets and directional spikes against the threshold.
 *
 * @param {object} previousSample - { rxBytes, txBytes, timestamp, iface }
 * @param {object} currentSample - { rxBytes, txBytes, timestamp, iface }
 * @param {object} [options={}] - Calculation options
 * @param {number} [options.thresholdMBps=10.0] - Spike threshold in MB/s
 * @param {number} [options.durationSeconds] - Explicit duration override
 * @returns {{ iface: string, durationSeconds: number, rxRateMBps: number, txRateMBps: number, isRxSpike: boolean, isTxSpike: boolean, isSpike: boolean, direction: string, isReset: boolean }}
 */
export function calculateBandwidthRate(previousSample, currentSample, options = {}) {
  if (!previousSample || !currentSample) {
    throw new TypeError('Both previousSample and currentSample are required to calculate bandwidth rate');
  }

  const iface = currentSample.iface || previousSample.iface || 'eth0';
  const threshold = typeof options.thresholdMBps === 'number' ? options.thresholdMBps : DEFAULT_SPIKE_THRESHOLD_MBPS;

  let durationSeconds = 1;
  if (typeof options.durationSeconds === 'number' && options.durationSeconds > 0) {
    durationSeconds = options.durationSeconds;
  } else if (currentSample.timestamp && previousSample.timestamp) {
    const deltaMs = currentSample.timestamp - previousSample.timestamp;
    durationSeconds = deltaMs > 0 ? (deltaMs / 1000) : 1;
  }

  const deltaRxBytes = currentSample.rxBytes - previousSample.rxBytes;
  const deltaTxBytes = currentSample.txBytes - previousSample.txBytes;

  // Counter reset detection (e.g. reboot, interface recreation, counter overflow)
  if (deltaRxBytes < 0 || deltaTxBytes < 0) {
    return {
      iface,
      durationSeconds,
      rxRateMBps: 0,
      txRateMBps: 0,
      isRxSpike: false,
      isTxSpike: false,
      isSpike: false,
      direction: 'NONE',
      isReset: true
    };
  }

  const rxRateMBps = Number((deltaRxBytes / (durationSeconds * 1000000)).toFixed(2));
  const txRateMBps = Number((deltaTxBytes / (durationSeconds * 1000000)).toFixed(2));

  const isRxSpike = rxRateMBps >= threshold;
  const isTxSpike = txRateMBps >= threshold;
  const isSpike = isRxSpike || isTxSpike;

  let direction = 'NONE';
  if (isRxSpike && isTxSpike) {
    direction = 'BOTH';
  } else if (isRxSpike) {
    direction = 'RX';
  } else if (isTxSpike) {
    direction = 'TX';
  }

  return {
    iface,
    durationSeconds,
    rxRateMBps,
    txRateMBps,
    isRxSpike,
    isTxSpike,
    isSpike,
    direction,
    isReset: false
  };
}

/**
 * Formats a bandwidth spike incident into a clean, zero-emoji structured alert payload.
 *
 * @param {object} spikeInfo
 * @returns {object} Normalized alert payload.
 */
export function formatNetworkSpikeAlert(spikeInfo) {
  const iface = spikeInfo.iface || 'eth0';
  const rxRate = spikeInfo.rxRateMBps !== undefined ? spikeInfo.rxRateMBps : 0;
  const txRate = spikeInfo.txRateMBps !== undefined ? spikeInfo.txRateMBps : 0;
  const threshold = spikeInfo.thresholdMBps !== undefined ? spikeInfo.thresholdMBps : DEFAULT_SPIKE_THRESHOLD_MBPS;
  const direction = spikeInfo.direction || 'ANOMALO';
  const timestamp = new Date().toISOString();

  return {
    title: `Pico de transferencia de red detectado: ${direction}`,
    details: `Trafico anomalo en la interfaz [${iface}]: Tasa RX = ${rxRate} MB/s, Tasa TX = ${txRate} MB/s (Umbral: ${threshold} MB/s). Direccion: ${direction}.`,
    timestamp,
    priority: 'high',
    metadata: {
      type: 'NETWORK_SPIKE',
      iface,
      rxRateMBps: rxRate,
      txRateMBps: txRate,
      thresholdMBps: threshold,
      direction,
      timestamp
    }
  };
}

/**
 * Helper to convert a raw /proc/net/dev string into a single-interface sample object.
 *
 * @param {string} rawString
 * @param {string} [ifaceName]
 * @param {number} [timestamp]
 * @returns {object}
 */
function sampleFromRawString(rawString, ifaceName, timestamp) {
  const parsed = parseProcNetDev(rawString);
  let chosen = null;
  if (ifaceName) {
    chosen = parsed.find(i => i.name === ifaceName);
  }
  if (!chosen) {
    chosen = parsed.find(i => !i.isVirtual) || parsed[0];
  }
  return {
    rxBytes: chosen ? chosen.rxBytes : 0,
    txBytes: chosen ? chosen.txBytes : 0,
    timestamp: timestamp || Date.now(),
    iface: chosen ? chosen.name : 'eth0'
  };
}

/**
 * Checks for network bandwidth spikes across samples.
 * Enforces a 5-minute cooldown guard between alerts.
 * Dispatches structured zero-emoji alerts to alertQueueService.
 *
 * @param {number} [thresholdMBps=10.0] - Spike threshold in MB/s
 * @param {object} [deps={}] - Dependency injection
 * @returns {Promise<{ alertEmitted: boolean, suppressedByCooldown?: boolean, alert?: object, rate: object|null, state: object }>}
 */
export async function checkBandwidthSpike(thresholdMBps = DEFAULT_SPIKE_THRESHOLD_MBPS, deps = {}) {
  const threshold = typeof thresholdMBps === 'number' ? thresholdMBps : DEFAULT_SPIKE_THRESHOLD_MBPS;
  const state = deps.state || defaultState;
  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
  const cooldownMs = typeof deps.cooldownMs === 'number' ? deps.cooldownMs : DEFAULT_COOLDOWN_MS;

  let rate = null;

  // Case A: Testing snapshot pairs passed explicitly (e.g. from fixtures)
  if (deps.sample1 && deps.sample2) {
    let s1 = deps.sample1;
    let s2 = deps.sample2;

    if (typeof s1 === 'string') {
      s1 = sampleFromRawString(s1, deps.interface, nowMs - ((deps.durationSeconds || 10) * 1000));
    }
    if (typeof s2 === 'string') {
      s2 = sampleFromRawString(s2, deps.interface, nowMs);
    }

    rate = calculateBandwidthRate(s1, s2, {
      thresholdMBps: threshold,
      durationSeconds: deps.durationSeconds
    });
  } else {
    // Case B: Reading dynamic sample from system/deps
    const currentSample = await readNetworkBytes(deps);

    if (state.lastSample) {
      rate = calculateBandwidthRate(state.lastSample, currentSample, {
        thresholdMBps: threshold,
        durationSeconds: deps.durationSeconds
      });
    }

    state.lastSample = currentSample;
  }

  if (!rate) {
    return {
      alertEmitted: false,
      rate: null,
      message: 'Initial network baseline recorded',
      state
    };
  }

  if (rate.isSpike) {
    const elapsedSinceLastAlert = nowMs - (state.lastAlertTime || 0);

    if (state.lastAlertTime && elapsedSinceLastAlert < cooldownMs) {
      return {
        alertEmitted: false,
        suppressedByCooldown: true,
        cooldownRemainingMs: cooldownMs - elapsedSinceLastAlert,
        rate,
        state
      };
    }

    state.lastAlertTime = nowMs;
    const alertPayload = formatNetworkSpikeAlert({ ...rate, thresholdMBps: threshold });

    if (deps.emitAlerts !== false) {
      if (typeof deps.enqueueAlert === 'function') {
        await deps.enqueueAlert(alertPayload);
      } else {
        enqueueAlert(alertPayload, { queuePath: deps.queuePath });
      }
    }

    return {
      alertEmitted: true,
      alert: alertPayload,
      rate,
      state
    };
  }

  return {
    alertEmitted: false,
    rate,
    state
  };
}
