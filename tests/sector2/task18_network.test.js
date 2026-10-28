import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertNoEmojis } from './helpers/s2Validators.js';
import { AlertCaptureMock } from './helpers/alertCaptureMock.js';
import { ProcNetDevTimeline, formatProcNetDev } from './helpers/procNetDevMock.js';
import {
  BASELINE_INTERFACES,
  NETWORK_SNAPSHOT_PAIRS,
  RAW_PROC_NET_DEV_SAMPLE
} from './fixtures/networkFixtures.js';
import {
  isVirtualInterface,
  parseProcNetDev,
  readNetworkBytes,
  calculateBandwidthRate,
  formatNetworkSpikeAlert,
  checkBandwidthSpike,
  resetNetworkMonitorState,
  DEFAULT_SPIKE_THRESHOLD_MBPS,
  DEFAULT_COOLDOWN_MS
} from '../../networkMonitorService.js';
import { drainAlerts } from '../../alertQueueService.js';

describe('Sector 2 - Task 18: Network Bandwidth Monitoring & Anomaly Detection', () => {
  let tempDir;
  let testQueuePath;

  beforeEach(async () => {
    resetNetworkMonitorState();
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'davis-test-net-'));
    testQueuePath = path.join(tempDir, 'data', 'alerts_queue.json');
  });

  afterEach(async () => {
    resetNetworkMonitorState();
    try {
      if (fs.existsSync(tempDir)) {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Part 1: Network Interface Filtering (isVirtualInterface)', () => {
    it('should identify virtual, container, and loopback interfaces', () => {
      const virtualNames = [
        'lo',
        'lo0',
        'docker0',
        'docker1',
        'veth1a2b3c',
        'veth_host',
        'br-7a8b9c',
        'br0',
        'virbr0',
        'tailscale0',
        'tun0',
        'tap0',
        'dummy0'
      ];

      for (const name of virtualNames) {
        assert.strictEqual(
          isVirtualInterface(name),
          true,
          `Interface '${name}' must be classified as virtual`
        );
      }
    });

    it('should classify physical WAN interfaces as non-virtual', () => {
      const physicalNames = [
        'eth0',
        'eth1',
        'ens3',
        'ens5',
        'enp0s3',
        'enp3s0',
        'eno1',
        'wlan0'
      ];

      for (const name of physicalNames) {
        assert.strictEqual(
          isVirtualInterface(name),
          false,
          `Interface '${name}' must be classified as physical/WAN`
        );
      }
    });
  });

  describe('Part 2: Kernel /proc/net/dev Parsing (parseProcNetDev)', () => {
    it('should parse raw /proc/net/dev lines into structured metrics', () => {
      const interfaces = parseProcNetDev(RAW_PROC_NET_DEV_SAMPLE);

      assert.strictEqual(interfaces.length, 3, 'Should parse 3 interfaces from baseline sample');

      const lo = interfaces.find(i => i.name === 'lo');
      assert.ok(lo);
      assert.strictEqual(lo.rxBytes, 1048576);
      assert.strictEqual(lo.txBytes, 1048576);
      assert.strictEqual(lo.isVirtual, true);

      const eth0 = interfaces.find(i => i.name === 'eth0');
      assert.ok(eth0);
      assert.strictEqual(eth0.rxBytes, 100000000);
      assert.strictEqual(eth0.txBytes, 50000000);
      assert.strictEqual(eth0.isVirtual, false);

      const docker0 = interfaces.find(i => i.name === 'docker0');
      assert.ok(docker0);
      assert.strictEqual(docker0.rxBytes, 5000000);
      assert.strictEqual(docker0.txBytes, 4000000);
      assert.strictEqual(docker0.isVirtual, true);

      assertNoEmojis(interfaces);
    });

    it('should return empty array for empty, malformed, or header-only input', () => {
      assert.deepStrictEqual(parseProcNetDev(''), []);
      assert.deepStrictEqual(parseProcNetDev('   \n  \t '), []);
      assert.deepStrictEqual(parseProcNetDev(null), []);

      const headerOnly = [
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed'
      ].join('\n');
      assert.deepStrictEqual(parseProcNetDev(headerOnly), []);
    });
  });

  describe('Part 3: Network Traffic Reader & Fallback (readNetworkBytes)', () => {
    it('should read counters from /proc/net/dev and prioritize primary physical interface', async () => {
      const sample = await readNetworkBytes({
        procNetDevContent: RAW_PROC_NET_DEV_SAMPLE
      });

      assert.strictEqual(sample.iface, 'eth0', 'Must pick primary physical WAN interface eth0');
      assert.strictEqual(sample.rxBytes, 100000000);
      assert.strictEqual(sample.txBytes, 50000000);
      assert.ok(sample.timestamp > 0);
      assertNoEmojis(sample);
    });

    it('should respect custom interface selection when specified in deps', async () => {
      const sample = await readNetworkBytes({
        procNetDevContent: RAW_PROC_NET_DEV_SAMPLE,
        interface: 'docker0'
      });

      assert.strictEqual(sample.iface, 'docker0');
      assert.strictEqual(sample.rxBytes, 5000000);
      assert.strictEqual(sample.txBytes, 4000000);
      assertNoEmojis(sample);
    });

    it('should fallback cleanly to os.networkInterfaces() when proc file cannot be read', async () => {
      const sample = await readNetworkBytes({
        procNetDevPath: path.join(tempDir, 'non_existent_proc_dev'),
        fallbackCounters: { rxBytes: 12345, txBytes: 67890 }
      });

      assert.strictEqual(sample.isFallback, true);
      assert.strictEqual(sample.rxBytes, 12345);
      assert.strictEqual(sample.txBytes, 67890);
      assert.ok(sample.iface);
      assertNoEmojis(sample);
    });
  });

  describe('Part 4: Bandwidth Rate Calculation (calculateBandwidthRate)', () => {
    it('should correctly calculate normal low-traffic rates (No Spike)', () => {
      const pair = NETWORK_SNAPSHOT_PAIRS.normalTraffic;
      const parsed1 = parseProcNetDev(pair.sample1).find(i => i.name === 'eth0');
      const parsed2 = parseProcNetDev(pair.sample2).find(i => i.name === 'eth0');

      const s1 = { ...parsed1, timestamp: 1000000 };
      const s2 = { ...parsed2, timestamp: 1000000 + (pair.durationSeconds * 1000) };

      const rate = calculateBandwidthRate(s1, s2, {
        thresholdMBps: pair.thresholdMBps,
        durationSeconds: pair.durationSeconds
      });

      assert.strictEqual(rate.iface, 'eth0');
      assert.strictEqual(rate.rxRateMBps, pair.expected.rxRateMBps);
      assert.strictEqual(rate.txRateMBps, pair.expected.txRateMBps);
      assert.strictEqual(rate.isRxSpike, false);
      assert.strictEqual(rate.isTxSpike, false);
      assert.strictEqual(rate.isSpike, false);
      assert.strictEqual(rate.direction, 'NONE');
      assert.strictEqual(rate.isReset, false);
      assertNoEmojis(rate);
    });

    it('should detect outbound TX bandwidth spike exceeding 10 MB/s', () => {
      const pair = NETWORK_SNAPSHOT_PAIRS.txSpike18MBps;
      const parsed1 = parseProcNetDev(pair.sample1).find(i => i.name === 'eth0');
      const parsed2 = parseProcNetDev(pair.sample2).find(i => i.name === 'eth0');

      const s1 = { ...parsed1, timestamp: 1000000 };
      const s2 = { ...parsed2, timestamp: 1000000 + (pair.durationSeconds * 1000) };

      const rate = calculateBandwidthRate(s1, s2, {
        thresholdMBps: pair.thresholdMBps,
        durationSeconds: pair.durationSeconds
      });

      assert.strictEqual(rate.iface, 'eth0');
      assert.strictEqual(rate.isRxSpike, false);
      assert.strictEqual(rate.isTxSpike, true);
      assert.strictEqual(rate.isSpike, true);
      assert.strictEqual(rate.direction, 'TX');
      assert.ok(rate.txRateMBps >= 10.0, `TX rate ${rate.txRateMBps} must be >= 10 MB/s`);
      assertNoEmojis(rate);
    });

    it('should detect inbound RX bandwidth spike exceeding 10 MB/s', () => {
      const pair = NETWORK_SNAPSHOT_PAIRS.rxSpike25MBps;
      const parsed1 = parseProcNetDev(pair.sample1).find(i => i.name === 'eth0');
      const parsed2 = parseProcNetDev(pair.sample2).find(i => i.name === 'eth0');

      const s1 = { ...parsed1, timestamp: 1000000 };
      const s2 = { ...parsed2, timestamp: 1000000 + (pair.durationSeconds * 1000) };

      const rate = calculateBandwidthRate(s1, s2, {
        thresholdMBps: pair.thresholdMBps,
        durationSeconds: pair.durationSeconds
      });

      assert.strictEqual(rate.iface, 'eth0');
      assert.strictEqual(rate.rxRateMBps, 25.0);
      assert.strictEqual(rate.isRxSpike, true);
      assert.strictEqual(rate.isTxSpike, false);
      assert.strictEqual(rate.isSpike, true);
      assert.strictEqual(rate.direction, 'RX');
      assertNoEmojis(rate);
    });

    it('should identify simultaneous bidirectional spike (BOTH directions)', () => {
      const s1 = { rxBytes: 10000000, txBytes: 10000000, timestamp: 0, iface: 'eth0' };
      const s2 = { rxBytes: 130000000, txBytes: 150000000, timestamp: 10000, iface: 'eth0' }; // 10s: 12 MB/s RX, 14 MB/s TX

      const rate = calculateBandwidthRate(s1, s2, { thresholdMBps: 10.0, durationSeconds: 10 });
      assert.strictEqual(rate.isRxSpike, true);
      assert.strictEqual(rate.isTxSpike, true);
      assert.strictEqual(rate.isSpike, true);
      assert.strictEqual(rate.direction, 'BOTH');
      assertNoEmojis(rate);
    });

    it('should detect counter reset / reboot and avoid false spike alarms', () => {
      const pair = NETWORK_SNAPSHOT_PAIRS.counterReset;
      const parsed1 = parseProcNetDev(pair.sample1).find(i => i.name === 'eth0');
      const parsed2 = parseProcNetDev(pair.sample2).find(i => i.name === 'eth0');

      const s1 = { ...parsed1, timestamp: 1000000 };
      const s2 = { ...parsed2, timestamp: 1000000 + (pair.durationSeconds * 1000) };

      const rate = calculateBandwidthRate(s1, s2, {
        thresholdMBps: pair.thresholdMBps,
        durationSeconds: pair.durationSeconds
      });

      assert.strictEqual(rate.isReset, true, 'Counter reset must be flagged');
      assert.strictEqual(rate.isSpike, false, 'Counter reset must NOT trigger a spike alert');
      assert.strictEqual(rate.rxRateMBps, 0);
      assert.strictEqual(rate.txRateMBps, 0);
      assertNoEmojis(rate);
    });
  });

  describe('Part 5: 5-Minute Cooldown Guard & checkBandwidthSpike', () => {
    it('should not emit an alert when bandwidth is below the spike threshold', async () => {
      const alertCapture = new AlertCaptureMock();
      const state = { lastSample: null, lastAlertTime: 0 };

      const result = await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.normalTraffic.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.normalTraffic.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state
      });

      assert.strictEqual(result.alertEmitted, false);
      assert.strictEqual(alertCapture.count(), 0);
    });

    it('should emit alert on first bandwidth spike and record alert timestamp', async () => {
      const alertCapture = new AlertCaptureMock();
      const state = { lastSample: null, lastAlertTime: 0 };
      const fixedNow = 1700000000000;

      const result = await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => fixedNow
      });

      assert.strictEqual(result.alertEmitted, true);
      assert.ok(result.alert);
      assert.strictEqual(state.lastAlertTime, fixedNow);
      assert.strictEqual(alertCapture.count(), 1);

      const captured = alertCapture.getLastAlert();
      assert.ok(captured.title.includes('TX'));
      assert.ok(captured.text.includes('eth0'));
      assert.strictEqual(captured.priority, 'high');
      assertNoEmojis(captured);
    });

    it('should suppress subsequent spike alerts within 5-minute cooldown window', async () => {
      const alertCapture = new AlertCaptureMock();
      const state = { lastSample: null, lastAlertTime: 0 };
      let currentTime = 1700000000000;

      // Spike 1 at t=0 -> Alert emitted
      const result1 = await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => currentTime
      });
      assert.strictEqual(result1.alertEmitted, true);
      assert.strictEqual(alertCapture.count(), 1);

      // Advance by 2 minutes (120s < 300s cooldown)
      currentTime += 2 * 60 * 1000;

      // Spike 2 at t=2m -> Suppressed by cooldown
      const result2 = await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => currentTime
      });

      assert.strictEqual(result2.alertEmitted, false, 'Spike within 5m cooldown must not emit alert');
      assert.strictEqual(result2.suppressedByCooldown, true);
      assert.ok(result2.cooldownRemainingMs > 0);
      assert.strictEqual(alertCapture.count(), 1, 'Alert count must remain 1');
    });

    it('should emit a new alert when a spike occurs after the 5-minute cooldown has elapsed', async () => {
      const alertCapture = new AlertCaptureMock();
      const state = { lastSample: null, lastAlertTime: 0 };
      let currentTime = 1700000000000;

      // Spike 1 at t=0
      await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => currentTime
      });
      assert.strictEqual(alertCapture.count(), 1);

      // Advance time by 5 minutes and 10 seconds (310s > 300s cooldown)
      currentTime += (5 * 60 + 10) * 1000;

      // Spike 3 at t=5m10s -> Alert emitted
      const result3 = await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.rxSpike25MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.rxSpike25MBps.sample2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => currentTime
      });

      assert.strictEqual(result3.alertEmitted, true, 'Spike after cooldown expired must emit alert');
      assert.strictEqual(alertCapture.count(), 2, 'Total alerts captured should now be 2');
      assert.strictEqual(state.lastAlertTime, currentTime);
      assertNoEmojis(result3);
    });
  });

  describe('Part 6: Stateful Simulation with ProcNetDevTimeline', () => {
    it('should monitor network traffic progression over multi-sample timeline', async () => {
      const timeline = new ProcNetDevTimeline(BASELINE_INTERFACES);
      const alertCapture = new AlertCaptureMock();
      const state = { lastSample: null, lastAlertTime: 0 };
      let simTime = Date.now();

      // Sample 1: Baseline
      const snap1 = timeline.render();
      const res1 = await checkBandwidthSpike(10.0, {
        procNetDevContent: snap1,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => simTime
      });
      assert.strictEqual(res1.alertEmitted, false);
      assert.strictEqual(res1.rate, null, 'First reading establishes baseline sample');

      // Sample 2: 10 seconds of baseline traffic (0.5 MB/s)
      simTime += 10000;
      const snap2 = timeline.simulateTrafficRate(10, 'eth0', 0.5, 0.2);
      const res2 = await checkBandwidthSpike(10.0, {
        procNetDevContent: snap2,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => simTime
      });
      assert.strictEqual(res2.alertEmitted, false);
      assert.strictEqual(alertCapture.count(), 0);

      // Sample 3: Sudden TX traffic burst (20 MB/s for 10 seconds)
      simTime += 10000;
      const snap3 = timeline.simulateTrafficRate(10, 'eth0', 0.2, 20.0);
      const res3 = await checkBandwidthSpike(10.0, {
        procNetDevContent: snap3,
        durationSeconds: 10,
        enqueueAlert: alertCapture.asNotifier(),
        state,
        now: () => simTime
      });

      assert.strictEqual(res3.alertEmitted, true);
      assert.strictEqual(alertCapture.count(), 1);
      assert.strictEqual(res3.rate.isTxSpike, true);
      assert.strictEqual(res3.rate.direction, 'TX');
      assertNoEmojis(res3);
    });
  });

  describe('Part 7: Zero-Emoji Alert Payload & alertQueueService Integration', () => {
    it('should format a structured zero-emoji network alert', () => {
      const alert = formatNetworkSpikeAlert({
        iface: 'eth0',
        rxRateMBps: 1.2,
        txRateMBps: 18.5,
        thresholdMBps: 10.0,
        direction: 'TX'
      });

      assert.strictEqual(alert.title, 'Pico de transferencia de red detectado: TX');
      assert.ok(alert.details.includes('eth0'));
      assert.ok(alert.details.includes('18.5 MB/s'));
      assert.strictEqual(alert.priority, 'high');
      assert.strictEqual(alert.metadata.type, 'NETWORK_SPIKE');
      assert.strictEqual(alert.metadata.iface, 'eth0');
      assert.strictEqual(alert.metadata.direction, 'TX');

      assertNoEmojis(alert, 'Network spike alert payload must not contain emojis');
    });

    it('should persist network alert to disk queue via alertQueueService', async () => {
      const state = { lastSample: null, lastAlertTime: 0 };

      await checkBandwidthSpike(10.0, {
        sample1: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample1,
        sample2: NETWORK_SNAPSHOT_PAIRS.txSpike18MBps.sample2,
        durationSeconds: 10,
        queuePath: testQueuePath,
        state
      });

      const queued = drainAlerts({ queuePath: testQueuePath });
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0].title, 'Pico de transferencia de red detectado: TX');
      assert.strictEqual(queued[0].priority, 'high');
      assertNoEmojis(queued);
    });
  });
});
