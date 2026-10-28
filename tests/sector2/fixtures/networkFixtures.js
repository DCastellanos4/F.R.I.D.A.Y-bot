import { formatProcNetDev } from '../helpers/procNetDevMock.js';

/**
 * Network Traffic and Bandwidth Test Fixtures for Task 18 (Network Traffic Monitor).
 *
 * Provides static snapshot pairs and calculation test vectors for /proc/net/dev parsing,
 * WAN interface selection, bandwidth calculation, and spike detection.
 *
 * Strict Policy: Zero Emojis.
 */

export const BASELINE_INTERFACES = [
  { name: 'lo', rxBytes: 1048576, txBytes: 1048576 },
  { name: 'eth0', rxBytes: 100000000, txBytes: 50000000 },
  { name: 'docker0', rxBytes: 5000000, txBytes: 4000000 }
];

export const NETWORK_SNAPSHOT_PAIRS = {
  // Normal low-traffic scenario over 10 seconds:
  // eth0: +500 KB RX, +200 KB TX -> 0.05 MB/s RX, 0.02 MB/s TX (No Spike)
  normalTraffic: {
    durationSeconds: 10,
    thresholdMBps: 10.0,
    sample1: formatProcNetDev(BASELINE_INTERFACES),
    sample2: formatProcNetDev([
      { name: 'lo', rxBytes: 1048576, txBytes: 1048576 },
      { name: 'eth0', rxBytes: 100500000, txBytes: 50200000 },
      { name: 'docker0', rxBytes: 5000000, txBytes: 4000000 }
    ]),
    expected: {
      iface: 'eth0',
      rxRateMBps: 0.05,
      txRateMBps: 0.02,
      isRxSpike: false,
      isTxSpike: false
    }
  },

  // Outbound TX spike scenario over 10 seconds:
  // eth0: +185,000,000 bytes TX (185 MB) -> 18.5 MB/s TX (Spike > 10 MB/s)
  txSpike18MBps: {
    durationSeconds: 10,
    thresholdMBps: 10.0,
    sample1: formatProcNetDev(BASELINE_INTERFACES),
    sample2: formatProcNetDev([
      { name: 'lo', rxBytes: 1048576, txBytes: 1048576 },
      { name: 'eth0', rxBytes: 100200000, txBytes: 235000000 },
      { name: 'docker0', rxBytes: 5000000, txBytes: 4000000 }
    ]),
    expected: {
      iface: 'eth0',
      rxRateMBps: 0.02,
      txRateMBps: 18.48, // (235M - 50M) / 10s / 1M = 18.5 MB/s
      isRxSpike: false,
      isTxSpike: true
    }
  },

  // Inbound RX spike scenario over 10 seconds:
  // eth0: +250,000,000 bytes RX (250 MB) -> 25.0 MB/s RX (Spike > 10 MB/s)
  rxSpike25MBps: {
    durationSeconds: 10,
    thresholdMBps: 10.0,
    sample1: formatProcNetDev(BASELINE_INTERFACES),
    sample2: formatProcNetDev([
      { name: 'lo', rxBytes: 1048576, txBytes: 1048576 },
      { name: 'eth0', rxBytes: 350000000, txBytes: 50200000 },
      { name: 'docker0', rxBytes: 5000000, txBytes: 4000000 }
    ]),
    expected: {
      iface: 'eth0',
      rxRateMBps: 25.0,
      txRateMBps: 0.02,
      isRxSpike: true,
      isTxSpike: false
    }
  },

  // Counter reset / interface wrap: Bytes2 < Bytes1
  counterReset: {
    durationSeconds: 10,
    thresholdMBps: 10.0,
    sample1: formatProcNetDev([
      { name: 'eth0', rxBytes: 900000000, txBytes: 900000000 }
    ]),
    sample2: formatProcNetDev([
      { name: 'eth0', rxBytes: 1000000, txBytes: 500000 } // Rebooted / reset
    ]),
    expected: {
      isReset: true
    }
  }
};

export const RAW_PROC_NET_DEV_SAMPLE = formatProcNetDev(BASELINE_INTERFACES);
