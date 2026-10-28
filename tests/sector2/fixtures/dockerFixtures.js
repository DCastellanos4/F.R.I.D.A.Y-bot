/**
 * Docker Test Fixtures for Task 11 (Docker Autonomous Monitor & Auto-Healing).
 *
 * Provides deterministic and realistic synthetic Docker CLI output strings
 * for 'docker ps -a --format "{{json .}}"', 'docker inspect', and container logs.
 *
 * Strict Policy: Zero Emojis.
 */

export const SYNTHETIC_CONTAINERS = {
  runningPostgres: {
    Command: '"docker-entrypoint.s..."',
    CreatedAt: '2026-10-20 12:00:00 +0000 UTC',
    ID: 'a1b2c3d4e5f6',
    Image: 'postgres:16-alpine',
    Labels: 'maintainer=postgres',
    LocalVolumes: '1',
    Mounts: '/var/lib/postgresql/data',
    Names: 'davis-postgres',
    Networks: 'davis-net',
    Ports: '0.0.0.0:5432->5432/tcp',
    RunningFor: '8 days ago',
    Size: '0B (virtual 250MB)',
    State: 'running',
    Status: 'Up 8 days (healthy)'
  },
  exitedN8nCrash: {
    Command: '"/docker-entrypoint..."',
    CreatedAt: '2026-10-25 15:30:00 +0000 UTC',
    ID: 'b2c3d4e5f6a1',
    Image: 'n8nio/n8n:latest',
    Labels: 'app=n8n',
    LocalVolumes: '1',
    Mounts: '/home/node/.n8n',
    Names: 'davis-n8n',
    Networks: 'davis-net',
    Ports: '0.0.0.0:5678->5678/tcp',
    RunningFor: '3 days ago',
    Size: '0B (virtual 450MB)',
    State: 'exited',
    Status: 'Exited (1) 45 seconds ago'
  },
  exitedOomRedis: {
    Command: '"docker-entrypoint.s..."',
    CreatedAt: '2026-10-26 10:15:00 +0000 UTC',
    ID: 'c3d4e5f6a1b2',
    Image: 'redis:7.2-alpine',
    Labels: 'app=redis',
    LocalVolumes: '0',
    Mounts: '/data',
    Names: 'davis-redis',
    Networks: 'davis-net',
    Ports: '0.0.0.0:6379->6379/tcp',
    RunningFor: '2 days ago',
    Size: '0B (virtual 40MB)',
    State: 'exited',
    Status: 'Exited (137) 3 minutes ago'
  },
  restartingOllamaFlapping: {
    Command: '"ollama serve"',
    CreatedAt: '2026-10-27 18:00:00 +0000 UTC',
    ID: 'd4e5f6a1b2c3',
    Image: 'ollama/ollama:latest',
    Labels: 'app=ollama',
    LocalVolumes: '1',
    Mounts: '/root/.ollama',
    Names: 'davis-ollama',
    Networks: 'davis-net',
    Ports: '0.0.0.0:11434->11434/tcp',
    RunningFor: '1 day ago',
    Size: '0B (virtual 3.2GB)',
    State: 'restarting',
    Status: 'Restarting (2) 15 seconds ago'
  },
  gracefullyExitedWorker: {
    Command: '"node run-backup.js"',
    CreatedAt: '2026-10-28 03:00:00 +0000 UTC',
    ID: 'e5f6a1b2c3d4',
    Image: 'davis-backup-runner:latest',
    Labels: 'cron=backup',
    LocalVolumes: '0',
    Mounts: '/backup',
    Names: 'davis-backup-job',
    Networks: 'bridge',
    Ports: '',
    RunningFor: '13 hours ago',
    Size: '0B (virtual 120MB)',
    State: 'exited',
    Status: 'Exited (0) 13 hours ago'
  }
};

/**
 * Synthetic output for 'docker ps -a --format "{{json .}}"' containing a realistic mix
 * of healthy, crashed, OOM, restarting, and graceful containers.
 */
export const DOCKER_PS_MIXED_OUTPUT = [
  JSON.stringify(SYNTHETIC_CONTAINERS.runningPostgres),
  JSON.stringify(SYNTHETIC_CONTAINERS.exitedN8nCrash),
  JSON.stringify(SYNTHETIC_CONTAINERS.exitedOomRedis),
  JSON.stringify(SYNTHETIC_CONTAINERS.restartingOllamaFlapping),
  JSON.stringify(SYNTHETIC_CONTAINERS.gracefullyExitedWorker)
].join('\n');

/**
 * Synthetic output when all containers are healthy and running.
 */
export const DOCKER_PS_ALL_RUNNING_OUTPUT = [
  JSON.stringify(SYNTHETIC_CONTAINERS.runningPostgres),
  JSON.stringify({ ...SYNTHETIC_CONTAINERS.exitedN8nCrash, State: 'running', Status: 'Up 2 hours' }),
  JSON.stringify({ ...SYNTHETIC_CONTAINERS.exitedOomRedis, State: 'running', Status: 'Up 2 hours' })
].join('\n');

/**
 * Synthetic output for 'docker inspect --format "{{json .State}}" <id>'.
 */
export const DOCKER_INSPECT_STATES = {
  running: JSON.stringify({
    Status: 'running',
    Running: true,
    Paused: false,
    Restarting: false,
    OOMKilled: false,
    Dead: false,
    Pid: 14820,
    ExitCode: 0,
    Error: '',
    StartedAt: '2026-10-20T12:00:05.123456789Z',
    FinishedAt: '0001-01-01T00:00:00Z'
  }),
  exitedError: JSON.stringify({
    Status: 'exited',
    Running: false,
    Paused: false,
    Restarting: false,
    OOMKilled: false,
    Dead: false,
    Pid: 0,
    ExitCode: 1,
    Error: '',
    StartedAt: '2026-10-25T15:30:02.123456789Z',
    FinishedAt: '2026-10-28T16:29:15.987654321Z'
  }),
  exitedOom: JSON.stringify({
    Status: 'exited',
    Running: false,
    Paused: false,
    Restarting: false,
    OOMKilled: true,
    Dead: false,
    Pid: 0,
    ExitCode: 137,
    Error: 'fatal: out of memory (cgroup limit exceeded)',
    StartedAt: '2026-10-26T10:15:00.123456789Z',
    FinishedAt: '2026-10-28T16:25:00.123456789Z'
  }),
  restarting: JSON.stringify({
    Status: 'restarting',
    Running: true,
    Paused: false,
    Restarting: true,
    OOMKilled: false,
    Dead: false,
    Pid: 18290,
    ExitCode: 2,
    Error: '',
    StartedAt: '2026-10-28T16:30:00.123456789Z',
    FinishedAt: '2026-10-28T16:30:10.123456789Z'
  })
};

/**
 * Realistic crash logs for a failing container.
 */
export const SYNTHETIC_CRASH_LOGS = [
  '2026-10-28T16:29:10.100Z [INFO] Initializing worker process...',
  '2026-10-28T16:29:11.200Z [INFO] Connecting to postgres database at davis-postgres:5432...',
  '2026-10-28T16:29:14.300Z [ERROR] Failed to connect to database: connection timeout after 3000ms',
  '2026-10-28T16:29:14.350Z [FATAL] Uncaught Exception: connect ETIMEDOUT 172.18.0.2:5432',
  '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1606:16)',
  '2026-10-28T16:29:15.000Z [INFO] Process terminated with exit code 1'
].join('\n');
