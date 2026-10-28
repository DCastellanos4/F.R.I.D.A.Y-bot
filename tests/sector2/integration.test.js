import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApiRequest } from '../../api.js';
import {
  drenarColaAlertas,
  ejecutarWatchdogsSector2,
  setMockSocket
} from '../../whatsappBot.js';
import { herramientasJarvis } from '../../tools.js';
import {
  seleccionarHerramientasPorIntencion
} from '../../jarvisAgent.js';
import {
  enqueueAlert,
  drainAlerts,
  clearQueue,
  getQueueLength,
  DEFAULT_QUEUE_FILE
} from '../../alertQueueService.js';
import {
  requestExecution,
  confirmAndExecute,
  clearPendingExecutions
} from '../../bashConsoleService.js';
import {
  generatePassword,
  generatePin,
  generateToken,
  generateCryptoKey,
  saveCredentialToMemory
} from '../../cryptoGeneratorService.js';
import { inspectContainers } from '../../dockerMonitorService.js';
import { checkDiskUsage } from '../../diskStorageService.js';
import { readNetworkBytes } from '../../networkMonitorService.js';
import { checkCertificateExpiry } from '../../sslMonitorService.js';
import { getTunnelStatus, startTunnel, stopTunnel } from '../../tunnelManagerService.js';
import { createEncryptedBackup, DAVBAK_MAGIC } from '../../backupService.js';

import {
  TEST_WEBHOOK_SECRET,
  GITHUB_PAYLOADS,
  createValidSignatureHeader,
  createInvalidSignatureHeader
} from './fixtures/githubWebhookFixtures.js';
import { assertNoEmojis } from './helpers/s2Validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const TEST_QUEUE_FILE = path.resolve(TEST_DATA_DIR, 'test_alerts_queue_integration.json');

describe('Sector 2 - Master Integration Test Suite', () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    clearPendingExecutions();
    clearQueue({ queuePath: DEFAULT_QUEUE_FILE });
  });

  afterEach(() => {
    clearPendingExecutions();
    clearQueue({ queuePath: DEFAULT_QUEUE_FILE });
    setMockSocket(null);
  });

  describe('Part 1: REST API & GitHub Webhook Integration', () => {
    let testServer;
    let serverUrl;

    beforeEach(async () => {
      testServer = http.createServer(handleApiRequest);
      await new Promise((resolve) => {
        testServer.listen(0, '127.0.0.1', () => {
          const port = testServer.address().port;
          serverUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => testServer.close(resolve));
    });

    it('should reject unauthenticated POST /api/webhook/github with HTTP 401 Unauthorized', async () => {
      const payload = JSON.stringify(GITHUB_PAYLOADS.workflowFailed);
      const res = await fetch(`${serverUrl}/api/webhook/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: payload
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.ok, false);
      assert.strictEqual(json.error, 'Unauthorized');
      assertNoEmojis(json);
    });

    it('should reject POST /api/webhook/github with corrupted HMAC signature header with HTTP 401', async () => {
      const payload = JSON.stringify(GITHUB_PAYLOADS.workflowFailed);
      const invalidHeader = createInvalidSignatureHeader(payload, TEST_WEBHOOK_SECRET);

      const res = await fetch(`${serverUrl}/api/webhook/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': invalidHeader
        },
        body: payload
      });

      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.ok, false);
      assert.strictEqual(json.error, 'Unauthorized');
      assertNoEmojis(json);
    });

    it('should reject malformed JSON with HTTP 400 even if signature header is verified', async () => {
      const invalidBody = 'this-is-not-valid-json';
      const validHeader = createValidSignatureHeader(invalidBody, TEST_WEBHOOK_SECRET);

      const res = await fetch(`${serverUrl}/api/webhook/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': validHeader
        },
        body: invalidBody
      });

      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.ok, false);
      assert.strictEqual(json.error, 'Invalid JSON payload');
      assertNoEmojis(json);
    });

    it('should accept valid signature and enqueue failure alert into alertQueue on CI failure', async () => {
      const payload = JSON.stringify(GITHUB_PAYLOADS.workflowFailed);
      const validHeader = createValidSignatureHeader(payload, TEST_WEBHOOK_SECRET);

      const res = await fetch(`${serverUrl}/api/webhook/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': validHeader
        },
        body: payload
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.ok, true);
      assert.ok(typeof json.alert === 'string');
      assert.ok(json.alert.includes('davidcastellanos/jarvis'));
      assert.ok(json.alert.includes('main'));
      assertNoEmojis(json);

      // Verify alert was enqueued into alertQueue
      const queuedAlerts = drainAlerts();
      assert.strictEqual(queuedAlerts.length, 1);
      const alert = queuedAlerts[0];
      assert.strictEqual(alert.priority, 'urgent');
      assert.ok(alert.details.includes('davidcastellanos/jarvis'));
      assertNoEmojis(alert);
    });

    it('should accept valid signature on successful workflow run without enqueuing alerts', async () => {
      const payload = JSON.stringify(GITHUB_PAYLOADS.workflowSucceeded);
      const validHeader = createValidSignatureHeader(payload, TEST_WEBHOOK_SECRET);

      const res = await fetch(`${serverUrl}/api/webhook/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': validHeader
        },
        body: payload
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.ok, true);
      assert.strictEqual(json.alert, null);
      assertNoEmojis(json);

      const queuedAlerts = drainAlerts();
      assert.strictEqual(queuedAlerts.length, 0);
    });
  });

  describe('Part 2: WhatsApp Bot Watchdogs & Alert Draining', () => {
    it('should drain alerts from alertQueue and dispatch formatted zero-emoji messages to David', async () => {
      const sentMessages = [];
      const mockSock = {
        sendMessage: async (jid, payload) => {
          sentMessages.push({ jid, payload });
          return { key: { id: 'msg_test_123' } };
        }
      };

      setMockSocket(mockSock);

      // Enqueue two alerts
      enqueueAlert({
        title: 'Fallo critico en contenedor Docker',
        details: 'Contenedor jarvis-db salio con codigo 137 (OOMKilled)',
        priority: 'urgent'
      });

      enqueueAlert({
        title: 'Intrusion detectada por Fail2ban',
        details: 'IP 198.51.100.44 bloqueada en jail sshd',
        priority: 'high'
      });

      assert.strictEqual(getQueueLength(), 2);

      const drained = await drenarColaAlertas();
      assert.strictEqual(drained.length, 2);
      assert.strictEqual(getQueueLength(), 0);

      assert.strictEqual(sentMessages.length, 2);
      for (const msg of sentMessages) {
        assert.ok(typeof msg.payload.text === 'string');
        assertNoEmojis(msg.payload.text);
      }

      assert.ok(sentMessages[0].payload.text.includes('Fallo critico en contenedor Docker'));
      assert.ok(sentMessages[1].payload.text.includes('Intrusion detectada por Fail2ban'));
    });

    it('should execute Sector 2 watchdogs pass without unhandled errors', async () => {
      const results = await ejecutarWatchdogsSector2({
        diskDeps: {
          mountPath: '/',
          statfsSync: () => ({ bsize: 4096, blocks: 1000000, bavail: 500000, bfree: 500000 })
        },
        netDeps: {
          procNetDevContent: 'Inter-| Receive | Transmit\n eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0'
        }
      });

      assert.ok(typeof results === 'object');
      assert.ok('docker' in results);
      assert.ok('disco' in results);
      assert.ok('fail2ban' in results);
      assert.ok('red' in results);
      assertNoEmojis(results);
    });
  });

  describe('Part 3: Cognitive Reasoning Engine Tool Registry', () => {
    it('should register all 6 Sector 2 tools in herramientasJarvis with valid schemas and zero emojis', () => {
      const requiredTools = [
        'execute_bash_command',
        'confirm_bash_otp',
        'generate_crypto_credential',
        'get_infrastructure_status',
        'manage_tunnel',
        'trigger_encrypted_backup'
      ];

      for (const toolName of requiredTools) {
        const found = herramientasJarvis.find((h) => h.function.name === toolName);
        assert.ok(found, `Tool ${toolName} must be registered in herramientasJarvis`);
        assert.strictEqual(found.type, 'function');
        assert.ok(typeof found.function.description === 'string');
        assert.ok(found.function.description.length > 10);
        assert.ok(typeof found.function.parameters === 'object');
        assertNoEmojis(found);
      }
    });
  });

  describe('Part 4: Intent Router Precision (seleccionarHerramientasPorIntencion)', () => {
    it('should select execute_bash_command and confirm_bash_otp for bash terminal queries', () => {
      const queries = [
        'ejecuta uptime en la terminal',
        'lanza el comando df -h en la consola',
        'revisa el estado de pm2 status',
        'confirmar otp 839201 para autorizar ejecucion'
      ];

      for (const q of queries) {
        const tools = seleccionarHerramientasPorIntencion(q);
        const names = tools.map((t) => t.function.name);
        assert.ok(
          names.includes('execute_bash_command') || names.includes('confirm_bash_otp'),
          `Query "${q}" should route to bash tools, got: ${names.join(', ')}`
        );
        assertNoEmojis(tools);
      }
    });

    it('should select generate_crypto_credential for password, token, and PIN generation queries', () => {
      const queries = [
        'genera una contrasena segura de 24 caracteres',
        'crea un pin de 6 digitos',
        'dame un token criptografico aleatorio',
        'necesito una clave criptografica de alta entropia'
      ];

      for (const q of queries) {
        const tools = seleccionarHerramientasPorIntencion(q);
        const names = tools.map((t) => t.function.name);
        assert.ok(
          names.includes('generate_crypto_credential'),
          `Query "${q}" should route to generate_crypto_credential, got: ${names.join(', ')}`
        );
        assertNoEmojis(tools);
      }
    });

    it('should select get_infrastructure_status for Docker, disk, and network queries', () => {
      const queries = [
        'como estan los contenedores docker',
        'revisa el espacio en disco duro',
        'como va el trafico de red y ancho de banda',
        'inspecciona el certificado ssl del servidor'
      ];

      for (const q of queries) {
        const tools = seleccionarHerramientasPorIntencion(q);
        const names = tools.map((t) => t.function.name);
        assert.ok(
          names.includes('get_infrastructure_status'),
          `Query "${q}" should route to get_infrastructure_status, got: ${names.join(', ')}`
        );
        assertNoEmojis(tools);
      }
    });

    it('should select manage_tunnel for Cloudflare and Tailscale tunnel queries', () => {
      const queries = [
        'como esta el tunel de cloudflare',
        'abrir tunel tailscale',
        'iniciar tunel cloudflared',
        'estado del tunel seguro'
      ];

      for (const q of queries) {
        const tools = seleccionarHerramientasPorIntencion(q);
        const names = tools.map((t) => t.function.name);
        assert.ok(
          names.includes('manage_tunnel'),
          `Query "${q}" should route to manage_tunnel, got: ${names.join(', ')}`
        );
        assertNoEmojis(tools);
      }
    });

    it('should select trigger_encrypted_backup for backup and restore queries', () => {
      const queries = [
        'haz un backup cifrado del sistema',
        'crear copia de seguridad davbak',
        'genera un respaldo cifrado inmediato'
      ];

      for (const q of queries) {
        const tools = seleccionarHerramientasPorIntencion(q);
        const names = tools.map((t) => t.function.name);
        assert.ok(
          names.includes('trigger_encrypted_backup'),
          `Query "${q}" should route to trigger_encrypted_backup, got: ${names.join(', ')}`
        );
        assertNoEmojis(tools);
      }
    });

    it('should prune all tools for pure conversational chit-chat queries', () => {
      const chitChat = [
        'hola jarvis',
        'buenos dias',
        'muchas gracias por todo',
        'que tal estas hoy'
      ];

      for (const q of chitChat) {
        const tools = seleccionarHerramientasPorIntencion(q);
        assert.strictEqual(
          tools.length,
          0,
          `Chit-chat query "${q}" should prune all tools, but got ${tools.length}`
        );
      }
    });
  });

  describe('Part 5: Sector 2 Services Execution Pipeline', () => {
    it('should execute safe bash command immediately without 2FA prompt', async () => {
      const res = await requestExecution('uptime');
      assert.strictEqual(res.status, 'EXECUTED');
      assert.strictEqual(typeof res.stdout, 'string');
      assertNoEmojis(res);
    });

    it('should require 6-digit OTP for critical bash command and execute upon confirmation', async () => {
      const requestRes = await requestExecution('pm2 restart jarvis-api');
      assert.strictEqual(requestRes.status, 'OTP_REQUIRED');
      assert.strictEqual(typeof requestRes.otpCode, 'string');
      assert.strictEqual(requestRes.otpCode.length, 6);
      assert.strictEqual(typeof requestRes.commandId, 'string');
      assertNoEmojis(requestRes);

      // Confirm with the generated OTP
      const confirmRes = await confirmAndExecute(requestRes.commandId, requestRes.otpCode);
      assert.strictEqual(confirmRes.status, 'EXECUTED');
      assert.strictEqual(confirmRes.command, 'pm2 restart jarvis-api');
      assertNoEmojis(confirmRes);
    });

    it('should generate high-entropy password and save to Second Brain strictly under clave category', async () => {
      const pwd = generatePassword(20, { detailed: true });
      assert.strictEqual(pwd.password.length, 20);
      assert.ok(pwd.entropy >= 100);
      assertNoEmojis(pwd);

      const memRes = await saveCredentialToMemory('Test VPS Server Root', pwd.password, 'Credencial de prueba');
      assert.strictEqual(memRes.ok, true);
      assert.strictEqual(memRes.category, 'clave');
      assertNoEmojis(memRes);
    });

    it('should create valid authenticated AES-256-GCM DAVBAK01 backup container', async () => {
      const backupResult = await createEncryptedBackup({
        passphrase: 'test_integration_master_passphrase',
        writeToDisk: false
      });

      assert.ok(backupResult.sizeBytes > 52);
      assert.strictEqual(typeof backupResult.sha256, 'string');
      assert.strictEqual(backupResult.sha256.length, 64);
      assert.strictEqual(DAVBAK_MAGIC.toString('ascii'), 'DAVBAK01');
      assertNoEmojis(backupResult);
    });
  });
});
