import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectContainers,
  inspectContainerState,
  restartContainer,
  checkAndHealContainers,
  canRestart,
  recordRestart,
  resetRestartHistory,
  formatDockerAlertText
} from '../../dockerMonitorService.js';
import { SysCommandMock } from './helpers/sysCommandMock.js';
import { AlertCaptureMock } from './helpers/alertCaptureMock.js';
import { assertNoEmojis } from './helpers/s2Validators.js';
import {
  SYNTHETIC_CONTAINERS,
  DOCKER_PS_MIXED_OUTPUT,
  DOCKER_PS_ALL_RUNNING_OUTPUT,
  DOCKER_INSPECT_STATES,
  SYNTHETIC_CRASH_LOGS
} from './fixtures/dockerFixtures.js';

describe('Sector 2 - Task 11: Docker Autonomous Monitor & Auto-Healing', () => {
  let sysMock;
  let alertMock;

  beforeEach(() => {
    sysMock = new SysCommandMock();
    alertMock = new AlertCaptureMock();
    resetRestartHistory();
  });

  afterEach(() => {
    sysMock.reset();
    alertMock.clear();
    resetRestartHistory();
  });

  describe('Part 1: Container Inspection & CLI Output Parsing', () => {
    it('should parse mixed docker ps JSON stream accurately into structured container objects', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: DOCKER_PS_MIXED_OUTPUT,
        stderr: ''
      });

      const containers = await inspectContainers({ runner: sysMock.asRunner() });

      assert.strictEqual(containers.length, 5);
      assertNoEmojis(containers);

      // 1. Postgres - healthy running
      const postgres = containers.find((c) => c.name === 'davis-postgres');
      assert.ok(postgres);
      assert.strictEqual(postgres.id, 'a1b2c3d4e5f6');
      assert.strictEqual(postgres.status, 'running');
      assert.strictEqual(postgres.exitCode, 0);
      assert.ok(postgres.uptime.includes('Up 8 days'));

      // 2. n8n - exited with error code 1
      const n8n = containers.find((c) => c.name === 'davis-n8n');
      assert.ok(n8n);
      assert.strictEqual(n8n.id, 'b2c3d4e5f6a1');
      assert.strictEqual(n8n.status, 'exited');
      assert.strictEqual(n8n.exitCode, 1);
      assert.ok(n8n.uptime.includes('Exited (1)'));

      // 3. Redis - exited with OOM code 137
      const redis = containers.find((c) => c.name === 'davis-redis');
      assert.ok(redis);
      assert.strictEqual(redis.id, 'c3d4e5f6a1b2');
      assert.strictEqual(redis.status, 'exited');
      assert.strictEqual(redis.exitCode, 137);

      // 4. Ollama - restarting
      const ollama = containers.find((c) => c.name === 'davis-ollama');
      assert.ok(ollama);
      assert.strictEqual(ollama.id, 'd4e5f6a1b2c3');
      assert.strictEqual(ollama.status, 'restarting');
      assert.strictEqual(ollama.exitCode, 2);

      // 5. Backup Job - exited cleanly with code 0
      const backupJob = containers.find((c) => c.name === 'davis-backup-job');
      assert.ok(backupJob);
      assert.strictEqual(backupJob.id, 'e5f6a1b2c3d4');
      assert.strictEqual(backupJob.status, 'exited');
      assert.strictEqual(backupJob.exitCode, 0);
    });

    it('should parse output when all containers are healthy and running', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: DOCKER_PS_ALL_RUNNING_OUTPUT,
        stderr: ''
      });

      const containers = await inspectContainers({ runner: sysMock.asRunner() });
      assert.strictEqual(containers.length, 3);
      for (const c of containers) {
        assert.strictEqual(c.status, 'running');
        assert.strictEqual(c.exitCode, 0);
      }
      assertNoEmojis(containers);
    });

    it('should return empty array when docker ps returns empty output', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: '\n   \n',
        stderr: ''
      });

      const containers = await inspectContainers({ runner: sysMock.asRunner() });
      assert.deepStrictEqual(containers, []);
      assertNoEmojis(containers);
    });

    it('should throw Error when docker ps CLI command fails with non-zero exit code', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock'
      });

      await assert.rejects(
        async () => inspectContainers({ runner: sysMock.asRunner() }),
        (err) => {
          assert.ok(err.message.includes('Fallo al inspeccionar contenedores Docker'));
          assert.ok(err.message.includes('Cannot connect to the Docker daemon'));
          assertNoEmojis(err.message);
          return true;
        }
      );
    });

    it('should return empty array if ignoreErrors option is enabled on CLI failure', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 1,
        stdout: '',
        stderr: 'docker daemon offline'
      });

      const containers = await inspectContainers({ runner: sysMock.asRunner(), ignoreErrors: true });
      assert.deepStrictEqual(containers, []);
      assertNoEmojis(containers);
    });

    it('should inspect specific container state via docker inspect', async () => {
      sysMock.when(/docker inspect .* b2c3d4e5f6a1/, {
        exitCode: 0,
        stdout: DOCKER_INSPECT_STATES.exitedError,
        stderr: ''
      });

      const state = await inspectContainerState('b2c3d4e5f6a1', { runner: sysMock.asRunner() });
      assert.strictEqual(state.Status, 'exited');
      assert.strictEqual(state.ExitCode, 1);
      assert.strictEqual(state.Running, false);
      assert.strictEqual(state.OOMKilled, false);
      assertNoEmojis(state);
    });

    it('should inspect OOM-killed container state accurately', async () => {
      sysMock.when(/docker inspect .* c3d4e5f6a1b2/, {
        exitCode: 0,
        stdout: DOCKER_INSPECT_STATES.exitedOom,
        stderr: ''
      });

      const state = await inspectContainerState('c3d4e5f6a1b2', { runner: sysMock.asRunner() });
      assert.strictEqual(state.Status, 'exited');
      assert.strictEqual(state.ExitCode, 137);
      assert.strictEqual(state.OOMKilled, true);
      assert.ok(state.Error.includes('out of memory'));
      assertNoEmojis(state);
    });

    it('should reject inspectContainerState with TypeError on empty or missing container ID', async () => {
      await assert.rejects(async () => inspectContainerState(''), TypeError);
      await assert.rejects(async () => inspectContainerState(null), TypeError);
    });
  });

  describe('Part 2: Container Restart Mechanics', () => {
    it('should execute docker restart command and return success on exit code 0', async () => {
      sysMock.when('docker restart davis-n8n', {
        exitCode: 0,
        stdout: 'davis-n8n\n',
        stderr: '',
        durationMs: 850
      });

      const result = await restartContainer('davis-n8n', { runner: sysMock.asRunner() });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.message.includes('davis-n8n reiniciado correctamente'));
      assertNoEmojis(result);

      const calls = sysMock.getCallsMatching('docker restart');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].command, 'docker');
      assert.deepStrictEqual(calls[0].args, ['restart', 'davis-n8n']);
    });

    it('should handle docker restart failure gracefully with detailed error message', async () => {
      sysMock.when('docker restart failed-service', {
        exitCode: 1,
        stdout: '',
        stderr: 'Error response from daemon: No such container: failed-service',
        durationMs: 120
      });

      const result = await restartContainer('failed-service', { runner: sysMock.asRunner() });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.message.includes('Fallo al reiniciar contenedor'));
      assert.ok(result.message.includes('No such container'));
      assertNoEmojis(result);
    });

    it('should return failure without command execution on invalid container identifier', async () => {
      const resNull = await restartContainer(null, { runner: sysMock.asRunner() });
      assert.strictEqual(resNull.success, false);
      assert.strictEqual(sysMock.getCallCount(), 0);
      assertNoEmojis(resNull);

      const resEmpty = await restartContainer('', { runner: sysMock.asRunner() });
      assert.strictEqual(resEmpty.success, false);
      assert.strictEqual(sysMock.getCallCount(), 0);
      assertNoEmojis(resEmpty);
    });
  });

  describe('Part 3: Category-Partition Lifecycle & Auto-Healing Rules', () => {
    it('Class 1: Healthy Running containers must NOT trigger any restart or alert', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.runningPostgres),
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healthyCount, 1);
      assert.strictEqual(report.healedCount, 0);
      assert.strictEqual(report.failedCount, 0);
      assert.strictEqual(report.skippedCount, 0);
      assert.strictEqual(report.suspendedCount, 0);
      assert.strictEqual(sysMock.getCallCount(/docker restart/), 0);
      alertMock.assertNoAlertEmitted();
      assertNoEmojis(report);
    });

    it('Class 4: Gracefully Stopped containers (exitCode 0) must be skipped without restart or alert', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.gracefullyExitedWorker),
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healthyCount, 0);
      assert.strictEqual(report.skippedCount, 1);
      assert.strictEqual(report.healedCount, 0);
      assert.strictEqual(report.failedCount, 0);
      assert.strictEqual(report.suspendedCount, 0);
      assert.strictEqual(sysMock.getCallCount(/docker restart/), 0);
      alertMock.assertNoAlertEmitted();
      assertNoEmojis(report);
    });

    it('Class 2: Abnormal Exited container (exitCode 1) must trigger auto-healing restart and alert', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.exitedN8nCrash),
        stderr: ''
      });
      sysMock.when(/docker restart b2c3d4e5f6a1/, {
        exitCode: 0,
        stdout: 'b2c3d4e5f6a1\n',
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healedCount, 1);
      assert.strictEqual(report.failedCount, 0);
      assert.strictEqual(report.healthyCount, 0);
      assert.strictEqual(report.skippedCount, 0);

      // Verify restart command was called
      const restartCalls = sysMock.getCallsMatching('docker restart');
      assert.strictEqual(restartCalls.length, 1);
      assert.ok(restartCalls[0].args.includes('b2c3d4e5f6a1'));

      // Verify alert was dispatched with zero emojis
      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/Auto-healing ejecutado/);
      alertMock.assertAlertEmitted(/davis-n8n/);
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'high');
      assert.strictEqual(alert.metadata.containerName, 'davis-n8n');
      assert.strictEqual(alert.metadata.exitCode, 1);
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });

    it('Class 2: OOM-killed container (exitCode 137) must trigger auto-healing restart and alert', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.exitedOomRedis),
        stderr: ''
      });
      sysMock.when(/docker restart c3d4e5f6a1b2/, {
        exitCode: 0,
        stdout: 'c3d4e5f6a1b2\n',
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healedCount, 1);

      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/davis-redis/);
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'high');
      assert.strictEqual(alert.metadata.exitCode, 137);
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });

    it('Class 3: Restarting/Flapping container within limit must be restarted', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.restartingOllamaFlapping),
        stderr: ''
      });
      sysMock.when(/docker restart d4e5f6a1b2c3/, {
        exitCode: 0,
        stdout: 'd4e5f6a1b2c3\n',
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healedCount, 1);
      assert.strictEqual(alertMock.count(), 1);
      assertNoEmojis(report);
    });

    it('Class 3: Flapping container exceeding max attempts (3 in 10m) must trip circuit breaker and suspend restarts', async () => {
      const containerId = 'd4e5f6a1b2c3';
      const containerName = 'davis-ollama';
      const fixedBaseTime = 1761667200000; // Reference timestamp

      // Pre-record 3 restart attempts in the current 10-minute window
      recordRestart(containerId, fixedBaseTime - 500000); // 8.3 min ago
      recordRestart(containerId, fixedBaseTime - 300000); // 5 min ago
      recordRestart(containerId, fixedBaseTime - 100000); // 1.6 min ago

      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.restartingOllamaFlapping),
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock,
        now: fixedBaseTime,
        maxRestartAttempts: 3,
        restartWindowMs: 600000
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.suspendedCount, 1);
      assert.strictEqual(report.healedCount, 0);
      assert.strictEqual(report.failedCount, 0);

      // Verify NO docker restart was executed because circuit breaker tripped
      assert.strictEqual(sysMock.getCallCount(/docker restart/), 0);

      // Verify urgent flapping alert was dispatched
      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/bucle de reinicios/);
      alertMock.assertAlertEmitted(new RegExp(containerName));
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'urgent');
      assert.ok(/superado limite de 3 intentos/i.test(alert.details));
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });

    it('Class 3: Circuit breaker resets after 10-minute sliding window expires', async () => {
      const containerId = 'd4e5f6a1b2c3';
      const fixedBaseTime = 1761667200000;

      // 3 attempts that are OLDER than 10 minutes (600,000 ms)
      recordRestart(containerId, fixedBaseTime - 700000);
      recordRestart(containerId, fixedBaseTime - 650000);
      recordRestart(containerId, fixedBaseTime - 610000);

      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.restartingOllamaFlapping),
        stderr: ''
      });
      sysMock.when(/docker restart d4e5f6a1b2c3/, {
        exitCode: 0,
        stdout: 'd4e5f6a1b2c3\n',
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock,
        now: fixedBaseTime,
        maxRestartAttempts: 3,
        restartWindowMs: 600000
      });

      // Since past attempts are outside the 10m window, restart is allowed
      assert.strictEqual(report.healedCount, 1);
      assert.strictEqual(report.suspendedCount, 0);
      assert.strictEqual(sysMock.getCallCount(/docker restart/), 1);
      assertNoEmojis(report);
    });
  });

  describe('Part 4: Multi-Container Mixed Environment Batch Sweep', () => {
    it('should process entire realistic 5-container topology in a single pass accurately', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: DOCKER_PS_MIXED_OUTPUT,
        stderr: ''
      });
      sysMock.when(/docker restart b2c3d4e5f6a1/, {
        exitCode: 0,
        stdout: 'b2c3d4e5f6a1\n',
        stderr: ''
      });
      sysMock.when(/docker restart c3d4e5f6a1b2/, {
        exitCode: 0,
        stdout: 'c3d4e5f6a1b2\n',
        stderr: ''
      });
      sysMock.when(/docker restart d4e5f6a1b2c3/, {
        exitCode: 0,
        stdout: 'd4e5f6a1b2c3\n',
        stderr: ''
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      // 5 containers total:
      // - 1 healthy (postgres)
      // - 1 gracefully stopped (backup job)
      // - 3 healed (n8n, redis, ollama)
      assert.strictEqual(report.totalInspected, 5);
      assert.strictEqual(report.healthyCount, 1);
      assert.strictEqual(report.skippedCount, 1);
      assert.strictEqual(report.healedCount, 3);
      assert.strictEqual(report.failedCount, 0);
      assert.strictEqual(report.suspendedCount, 0);

      // 3 alerts emitted for the 3 restarted containers
      assert.strictEqual(alertMock.count(), 3);
      alertMock.assertAlertEmitted(/davis-n8n/);
      alertMock.assertAlertEmitted(/davis-redis/);
      alertMock.assertAlertEmitted(/davis-ollama/);

      // Verify strict zero-emoji on all alerts
      for (const alert of alertMock.getAllAlerts()) {
        assertNoEmojis(alert);
      }
      assertNoEmojis(report);
    });

    it('should handle failed restart during batch sweep and report failedCount with urgent alert', async () => {
      sysMock.when(/docker ps -a/, {
        exitCode: 0,
        stdout: JSON.stringify(SYNTHETIC_CONTAINERS.exitedN8nCrash),
        stderr: ''
      });
      sysMock.when(/docker restart b2c3d4e5f6a1/, {
        exitCode: 1,
        stdout: '',
        stderr: 'Error response from daemon: driver failed programming external connectivity'
      });

      const report = await checkAndHealContainers({
        runner: sysMock.asRunner(),
        alertCaptureMock: alertMock
      });

      assert.strictEqual(report.totalInspected, 1);
      assert.strictEqual(report.healedCount, 0);
      assert.strictEqual(report.failedCount, 1);

      assert.strictEqual(alertMock.count(), 1);
      alertMock.assertAlertEmitted(/Fallo al reiniciar contenedor/);
      const alert = alertMock.getLastAlert();
      assert.strictEqual(alert.priority, 'urgent');
      assert.ok(alert.details.includes('driver failed programming external connectivity'));
      assertNoEmojis(alert);
      assertNoEmojis(report);
    });
  });

  describe('Part 5: Alert Formatting & Zero-Emoji Compliance', () => {
    it('should format container alert text cleanly with all required fields and 0 emojis', () => {
      const alertText = formatDockerAlertText({
        name: 'davis-n8n',
        id: 'b2c3d4e5f6a1',
        status: 'exited',
        exitCode: 1,
        uptime: 'Exited (1) 45 seconds ago',
        actionResult: 'Reinicio automatico completado con exito.'
      });

      assert.ok(alertText.includes('[DOCKER] Incidente detectado'));
      assert.ok(alertText.includes('davis-n8n'));
      assert.ok(alertText.includes('ID: b2c3d4e5f6a1'));
      assert.ok(alertText.includes('Codigo de salida: 1'));
      assert.ok(alertText.includes('Reinicio automatico completado'));
      assertNoEmojis(alertText);
    });

    it('should verify zero emojis across synthetic crash logs', () => {
      assertNoEmojis(SYNTHETIC_CRASH_LOGS);
    });
  });
});
