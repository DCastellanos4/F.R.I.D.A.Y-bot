import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Generates a realistic Linux /proc/net/dev file content string.
 *
 * Header format:
 * Inter-|   Receive                                                |  Transmit
 *  face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 *
 * @param {Array<object>} interfaces - Array of interface counter configurations.
 * @returns {string} Formatted /proc/net/dev string.
 */
export function formatProcNetDev(interfaces) {
  const header = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed'
  ];

  const lines = interfaces.map(iface => {
    const nameWithColon = `${iface.name || 'eth0'}:`.padStart(8, ' ');
    const rxBytes = String(iface.rxBytes || 0).padStart(10, ' ');
    const rxPackets = String(iface.rxPackets || 0).padStart(8, ' ');
    const rxErrs = String(iface.rxErrs || 0).padStart(4, ' ');
    const rxDrop = String(iface.rxDrop || 0).padStart(4, ' ');
    const rxFifo = String(iface.rxFifo || 0).padStart(4, ' ');
    const rxFrame = String(iface.rxFrame || 0).padStart(4, ' ');
    const rxCompressed = String(iface.rxCompressed || 0).padStart(4, ' ');
    const rxMulticast = String(iface.rxMulticast || 0).padStart(4, ' ');

    const txBytes = String(iface.txBytes || 0).padStart(11, ' ');
    const txPackets = String(iface.txPackets || 0).padStart(8, ' ');
    const txErrs = String(iface.txErrs || 0).padStart(4, ' ');
    const txDrop = String(iface.txDrop || 0).padStart(4, ' ');
    const txFifo = String(iface.txFifo || 0).padStart(4, ' ');
    const txColls = String(iface.txColls || 0).padStart(4, ' ');
    const txCarrier = String(iface.txCarrier || 0).padStart(4, ' ');
    const txCompressed = String(iface.txCompressed || 0).padStart(4, ' ');

    return `${nameWithColon} ${rxBytes} ${rxPackets} ${rxErrs} ${rxDrop} ${rxFifo} ${rxFrame} ${rxCompressed} ${rxMulticast} ${txBytes} ${txPackets} ${txErrs} ${txDrop} ${txFifo} ${txColls} ${txCarrier} ${txCompressed}`;
  });

  return [...header, ...lines, ''].join('\n');
}

/**
 * ProcNetDevTimeline: A stateful generator simulating network traffic over time.
 * Allows testing bandwidth rate calculations, sampling deltas, and spike detection.
 */
export class ProcNetDevTimeline {
  constructor(initialInterfaces) {
    this.interfaces = new Map();
    this.currentTimestampMs = Date.now();

    const defaults = initialInterfaces || [
      { name: 'lo', rxBytes: 1048576, txBytes: 1048576 },
      { name: 'eth0', rxBytes: 50000000, txBytes: 25000000 },
      { name: 'docker0', rxBytes: 2000000, txBytes: 1500000 }
    ];

    for (const iface of defaults) {
      this.interfaces.set(iface.name, {
        name: iface.name,
        rxBytes: iface.rxBytes || 0,
        txBytes: iface.txBytes || 0,
        rxPackets: iface.rxPackets || Math.floor((iface.rxBytes || 0) / 1000),
        txPackets: iface.txPackets || Math.floor((iface.txBytes || 0) / 1000),
        rxErrs: 0,
        rxDrop: 0,
        rxFifo: 0,
        rxFrame: 0,
        rxCompressed: 0,
        rxMulticast: 0,
        txErrs: 0,
        txDrop: 0,
        txFifo: 0,
        txColls: 0,
        txCarrier: 0,
        txCompressed: 0
      });
    }
  }

  /**
   * Advances simulation time and adds byte deltas to an interface.
   *
   * @param {number} deltaSeconds - Seconds elapsed.
   * @param {string} ifaceName - Target interface (e.g. 'eth0').
   * @param {object} deltas
   * @param {number} [deltas.deltaRxBytes=0] - Additional received bytes.
   * @param {number} [deltas.deltaTxBytes=0] - Additional transmitted bytes.
   * @returns {string} New /proc/net/dev snapshot content.
   */
  advance(deltaSeconds, ifaceName, deltas = {}) {
    this.currentTimestampMs += deltaSeconds * 1000;
    const iface = this.interfaces.get(ifaceName);
    if (iface) {
      if (deltas.deltaRxBytes) {
        iface.rxBytes += deltas.deltaRxBytes;
        iface.rxPackets += Math.max(1, Math.floor(deltas.deltaRxBytes / 1400));
      }
      if (deltas.deltaTxBytes) {
        iface.txBytes += deltas.deltaTxBytes;
        iface.txPackets += Math.max(1, Math.floor(deltas.deltaTxBytes / 1400));
      }
    }
    return this.render();
  }

  /**
   * Simulates a sustained rate (in MB/s) on an interface for a given duration.
   *
   * @param {number} durationSeconds - Duration of sample in seconds.
   * @param {string} ifaceName - Target interface.
   * @param {number} rxRateMBps - Megabytes per second received.
   * @param {number} txRateMBps - Megabytes per second transmitted.
   * @returns {string} New /proc/net/dev snapshot.
   */
  simulateTrafficRate(durationSeconds, ifaceName, rxRateMBps = 0, txRateMBps = 0) {
    const deltaRxBytes = Math.round(rxRateMBps * 1000000 * durationSeconds);
    const deltaTxBytes = Math.round(txRateMBps * 1000000 * durationSeconds);
    return this.advance(durationSeconds, ifaceName, { deltaRxBytes, deltaTxBytes });
  }

  /**
   * Renders the current state as a /proc/net/dev string.
   * @returns {string}
   */
  render() {
    return formatProcNetDev(Array.from(this.interfaces.values()));
  }

  /**
   * Writes the current snapshot to a temporary file on disk.
   * Useful when testing services that read directly from file paths.
   *
   * @param {string} [dir] - Destination directory.
   * @returns {Promise<string>} File path created.
   */
  async writeToTempFile(dir) {
    const targetDir = dir || (await fs.mkdtemp(path.join(os.tmpdir(), 'davis-net-test-')));
    const filePath = path.join(targetDir, 'dev');
    await fs.writeFile(filePath, this.render(), 'utf8');
    return filePath;
  }
}
