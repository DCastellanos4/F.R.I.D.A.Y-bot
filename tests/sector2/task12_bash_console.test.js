import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASH_COMMAND_SETS,
  SYNTHETIC_TERMINAL_OUTPUTS
} from './fixtures/bashFixtures.js';
import {
  assertNoEmojis,
  isValidOtpCode,
  assertValidOtpCode
} from './helpers/s2Validators.js';
import { createSysCommandMock } from './helpers/sysCommandMock.js';
import {
  classifyCommand,
  requestExecution,
  confirmAndExecute,
  cancelPendingExecution,
  getPendingExecution,
  listPendingExecutions,
  clearPendingExecutions,
  scrubSecrets,
  DEFAULT_OTP_TTL_MS,
  MAX_OTP_ATTEMPTS
} from '../../bashConsoleService.js';

describe('Sector 2 - Task 12: Secure Remote Bash Console with 2FA OTP', () => {
  let mockRunner;

  beforeEach(() => {
    clearPendingExecutions();
    mockRunner = createSysCommandMock();

    mockRunner.when('uptime', {
      exitCode: 0,
      stdout: SYNTHETIC_TERMINAL_OUTPUTS.uptime,
      stderr: ''
    });

    mockRunner.when('df -h', {
      exitCode: 0,
      stdout: SYNTHETIC_TERMINAL_OUTPUTS.df,
      stderr: ''
    });

    mockRunner.when('pm2 status', {
      exitCode: 0,
      stdout: SYNTHETIC_TERMINAL_OUTPUTS.pm2Status,
      stderr: ''
    });

    mockRunner.when(/pm2 restart/, {
      exitCode: 0,
      stdout: 'Applying online reload for jarvis-api\n[PM2] Process restarted\n',
      stderr: ''
    });
  });

  afterEach(() => {
    clearPendingExecutions();
    mockRunner.reset();
  });

  describe('1. Command Classification Engine (Category-Partition Method)', () => {
    it('should classify all verified safe commands as SAFE without requiring OTP', () => {
      for (const cmd of BASH_COMMAND_SETS.safe) {
        const result = classifyCommand(cmd);
        assert.strictEqual(
          result.isCritical,
          false,
          `Expected command '${cmd}' to be non-critical`
        );
        assert.strictEqual(
          result.isForbidden,
          false,
          `Expected command '${cmd}' to not be forbidden`
        );
        assert.strictEqual(
          result.level,
          'SAFE',
          `Expected level 'SAFE' for '${cmd}'`
        );
        assert.ok(result.reason.length > 0);
        assertNoEmojis(result, `Emoji detected in classification of '${cmd}'`);
      }
    });

    it('should classify all critical and mutating commands as CRITICAL requiring 2FA OTP', () => {
      for (const cmd of BASH_COMMAND_SETS.critical) {
        const result = classifyCommand(cmd);
        assert.strictEqual(
          result.isCritical,
          true,
          `Expected command '${cmd}' to be critical`
        );
        assert.strictEqual(
          result.isForbidden,
          false,
          `Expected command '${cmd}' to not be forbidden`
        );
        assert.strictEqual(
          result.level,
          'CRITICAL',
          `Expected level 'CRITICAL' for '${cmd}'`
        );
        assert.ok(result.reason.length > 0);
        assertNoEmojis(result, `Emoji detected in classification of '${cmd}'`);
      }
    });

    it('should classify all destructive commands as FORBIDDEN for permanent rejection', () => {
      for (const cmd of BASH_COMMAND_SETS.forbidden) {
        const result = classifyCommand(cmd);
        assert.strictEqual(
          result.isForbidden,
          true,
          `Expected command '${cmd}' to be forbidden`
        );
        assert.strictEqual(
          result.level,
          'FORBIDDEN',
          `Expected level 'FORBIDDEN' for '${cmd}'`
        );
        assert.ok(result.reason.length > 0);
        assertNoEmojis(result, `Emoji detected in classification of '${cmd}'`);
      }
    });

    it('should correctly classify compound chained and piped safe commands', () => {
      for (const cmd of BASH_COMMAND_SETS.compoundSafe) {
        const result = classifyCommand(cmd);
        assert.strictEqual(result.level, 'SAFE', `Expected '${cmd}' to be SAFE`);
        assert.strictEqual(result.isCritical, false);
        assert.strictEqual(result.isForbidden, false);
        assertNoEmojis(result);
      }
    });

    it('should elevate compound commands containing any critical subcommand to CRITICAL', () => {
      for (const cmd of BASH_COMMAND_SETS.compoundCritical) {
        const result = classifyCommand(cmd);
        assert.strictEqual(result.level, 'CRITICAL', `Expected '${cmd}' to be CRITICAL`);
        assert.strictEqual(result.isCritical, true);
        assert.strictEqual(result.isForbidden, false);
        assertNoEmojis(result);
      }
    });

    it('should permanently reject compound commands containing any forbidden subcommand', () => {
      for (const cmd of BASH_COMMAND_SETS.compoundForbidden) {
        const result = classifyCommand(cmd);
        assert.strictEqual(result.level, 'FORBIDDEN', `Expected '${cmd}' to be FORBIDDEN`);
        assert.strictEqual(result.isForbidden, true);
        assertNoEmojis(result);
      }
    });

    it('should classify unlisted or unknown binary commands as CRITICAL by default for security', () => {
      const unknownCmd = './custom_migration_script.sh --force';
      const result = classifyCommand(unknownCmd);
      assert.strictEqual(result.isCritical, true);
      assert.strictEqual(result.level, 'CRITICAL');
      assertNoEmojis(result);
    });

    it('should handle empty or whitespace-only commands safely', () => {
      const emptyResult = classifyCommand('   ');
      assert.strictEqual(emptyResult.isCritical, false);
      assert.strictEqual(emptyResult.level, 'SAFE');
      assertNoEmojis(emptyResult);
    });
  });

  describe('2. Safe Command Immediate Execution', () => {
    it('should execute non-critical command immediately without OTP requirement', async () => {
      const res = await requestExecution('uptime', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'EXECUTED');
      assert.strictEqual(res.command, 'uptime');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.exitCode, 0);
      assert.ok(res.stdout.includes('load average'));
      assertNoEmojis(res);
      assert.strictEqual(mockRunner.getCallCount('uptime'), 1);
    });

    it('should execute df -h and return scrubbed formatted stdout', async () => {
      const res = await requestExecution('df -h', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'EXECUTED');
      assert.strictEqual(res.ok, true);
      assert.ok(res.stdout.includes('/dev/root'));
      assertNoEmojis(res);
    });

    it('should return error status for empty command request', async () => {
      const res = await requestExecution('', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'INVALID_COMMAND');
      assert.ok(res.error);
      assertNoEmojis(res);
      assert.strictEqual(mockRunner.getCallCount(), 0);
    });
  });

  describe('3. Critical Command 2FA OTP State Machine', () => {
    it('should generate an ephemeral 6-digit OTP code with 120s TTL for critical commands', async () => {
      const fixedTime = 1700000000000;
      const res = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime
      });

      assert.strictEqual(res.status, 'OTP_REQUIRED');
      assert.strictEqual(res.command, 'pm2 restart jarvis-api');
      assert.ok(res.commandId);
      assert.strictEqual(res.expiresAt, fixedTime + DEFAULT_OTP_TTL_MS);
      assert.strictEqual(res.ttlSeconds, 120);

      assertValidOtpCode(res.otpCode, 6);
      assertNoEmojis(res);

      // Verify command was NOT executed prematurely
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 0);

      // Verify pending entry exists
      const pending = getPendingExecution(res.commandId);
      assert.ok(pending);
      assert.strictEqual(pending.status, 'PENDING');
      assert.strictEqual(pending.command, 'pm2 restart jarvis-api');
      assertNoEmojis(pending);
    });

    it('should successfully execute critical command when valid OTP is confirmed', async () => {
      const fixedTime = 1700000000000;
      const req = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime
      });

      const confirmRes = await confirmAndExecute(req.commandId, req.otpCode, {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 5000
      });

      assert.strictEqual(confirmRes.status, 'EXECUTED');
      assert.strictEqual(confirmRes.command, 'pm2 restart jarvis-api');
      assert.strictEqual(confirmRes.ok, true);
      assert.strictEqual(confirmRes.exitCode, 0);
      assert.ok(confirmRes.stdout.includes('Process restarted'));
      assertNoEmojis(confirmRes);

      // Verify executed by runner
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 1);

      // Verify removed from pending list
      const activeList = listPendingExecutions({ now: () => fixedTime + 5000 });
      assert.strictEqual(activeList.length, 0);
    });

    it('should support confirming by single OTP string argument when only 1 request is pending', async () => {
      const fixedTime = 1700000000000;
      const req = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime
      });

      // Confirm with only the OTP code
      const confirmRes = await confirmAndExecute(req.otpCode, {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 1000
      });

      assert.strictEqual(confirmRes.status, 'EXECUTED');
      assert.strictEqual(confirmRes.ok, true);
      assertNoEmojis(confirmRes);
    });

    it('should reject invalid OTP codes and decrement remaining attempts', async () => {
      const fixedTime = 1700000000000;
      const req = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime
      });

      // Attempt 1: wrong OTP
      const fail1 = await confirmAndExecute(req.commandId, '000000', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 1000
      });

      assert.strictEqual(fail1.status, 'INVALID_OTP');
      assert.strictEqual(fail1.locked, false);
      assert.strictEqual(fail1.attemptsRemaining, 2);
      assertNoEmojis(fail1);
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 0);

      // Attempt 2: wrong OTP
      const fail2 = await confirmAndExecute(req.commandId, '111111', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 2000
      });

      assert.strictEqual(fail2.status, 'INVALID_OTP');
      assert.strictEqual(fail2.locked, false);
      assert.strictEqual(fail2.attemptsRemaining, 1);
      assertNoEmojis(fail2);

      // Attempt 3: wrong OTP -> Lockout
      const fail3 = await confirmAndExecute(req.commandId, '222222', {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 3000
      });

      assert.strictEqual(fail3.status, 'INVALID_OTP');
      assert.strictEqual(fail3.locked, true);
      assert.strictEqual(fail3.attemptsRemaining, 0);
      assertNoEmojis(fail3);

      // Attempt 4: Even with correct OTP, should be locked and rejected
      const failAfterLock = await confirmAndExecute(req.commandId, req.otpCode, {
        runner: mockRunner.asRunner(),
        now: () => fixedTime + 4000
      });

      assert.strictEqual(failAfterLock.status, 'NOT_FOUND');
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 0);
    });

    it('should expire pending command when TTL (120s) has elapsed', async () => {
      const startTime = 1700000000000;
      const req = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner(),
        now: () => startTime
      });

      // Verify valid at 119s
      const pendingAt119 = listPendingExecutions({ now: () => startTime + 119000 });
      assert.strictEqual(pendingAt119.length, 1);

      // Expire at 120s + 1ms
      const confirmExpired = await confirmAndExecute(req.commandId, req.otpCode, {
        runner: mockRunner.asRunner(),
        now: () => startTime + 120001
      });

      assert.strictEqual(confirmExpired.status, 'EXPIRED');
      assert.ok(confirmExpired.error.includes('expired'));
      assertNoEmojis(confirmExpired);

      // Command must never have run
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 0);

      // Pending list must now be pruned
      const activeList = listPendingExecutions({ now: () => startTime + 120001 });
      assert.strictEqual(activeList.length, 0);
    });

    it('should allow David to cancel a pending authorization request', async () => {
      const req = await requestExecution('pm2 restart jarvis-api', {
        runner: mockRunner.asRunner()
      });

      const cancelRes = cancelPendingExecution(req.commandId);
      assert.strictEqual(cancelRes.status, 'CANCELLED');
      assert.strictEqual(cancelRes.commandId, req.commandId);
      assertNoEmojis(cancelRes);

      // Cannot execute after cancellation
      const confirmRes = await confirmAndExecute(req.commandId, req.otpCode, {
        runner: mockRunner.asRunner()
      });
      assert.strictEqual(confirmRes.status, 'NOT_FOUND');
      assert.strictEqual(mockRunner.getCallCount('pm2 restart'), 0);
    });
  });

  describe('4. Forbidden Commands Permanent Rejection', () => {
    it('should immediately reject rm -rf / and never generate an OTP code', async () => {
      const res = await requestExecution('rm -rf /', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'FORBIDDEN');
      assert.strictEqual(res.otpCode, undefined);
      assert.strictEqual(res.commandId, undefined);
      assert.ok(res.reason);
      assertNoEmojis(res);
      assert.strictEqual(mockRunner.getCallCount(), 0);
    });

    it('should reject fork bomb pattern immediately', async () => {
      const res = await requestExecution(':(){ :|:& };:', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'FORBIDDEN');
      assertNoEmojis(res);
      assert.strictEqual(mockRunner.getCallCount(), 0);
    });

    it('should reject compound command containing subshell fork bomb or rm -rf', async () => {
      const res = await requestExecution('echo $(rm -rf /*)', { runner: mockRunner.asRunner() });
      assert.strictEqual(res.status, 'FORBIDDEN');
      assertNoEmojis(res);
      assert.strictEqual(mockRunner.getCallCount(), 0);
    });
  });

  describe('5. Secret Scrubbing in Terminal Outputs', () => {
    it('should redact OPENAI_API_KEY, master encryption keys, and database passwords from stdout', () => {
      const raw = SYNTHETIC_TERMINAL_OUTPUTS.sensitiveOutputWithKeys;
      const scrubbed = scrubSecrets(raw);

      // Sensitive values must NOT appear in scrubbed text
      assert.ok(!scrubbed.includes('sk-proj-abc1234567890def1234567890abcdef12'));
      assert.ok(!scrubbed.includes('super_secure_master_password_99'));
      assert.ok(!scrubbed.includes('db_secret_pass_123'));

      // Replacement masks must be present
      assert.ok(scrubbed.includes('OPENAI_API_KEY=[REDACTED]'));
      assert.ok(scrubbed.includes('BACKUP_ENCRYPTION_KEY=[REDACTED]'));
      assert.ok(scrubbed.includes('DATABASE_URL=postgres://user:[REDACTED]@localhost:5432/davis'));

      // Non-sensitive settings must remain intact
      assert.ok(scrubbed.includes('PORT=3000'));
      assert.ok(scrubbed.includes('Loaded configuration from /home/ubuntu/jarvis/.env'));

      assertNoEmojis(scrubbed);
    });

    it('should redact Bearer authorization headers and private key blocks', () => {
      const raw = [
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature',
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEowIBAAKCAQEA0Y123456789abcdefghijklmnopqrstuvwxyz',
        '-----END RSA PRIVATE KEY-----'
      ].join('\n');

      const scrubbed = scrubSecrets(raw);
      assert.ok(!scrubbed.includes('eyJhbGciOiJIUzI1Ni'));
      assert.ok(scrubbed.includes('Authorization: Bearer [REDACTED]'));
      assert.ok(scrubbed.includes('[REDACTED_PRIVATE_KEY]'));
      assertNoEmojis(scrubbed);
    });

    it('should automatically scrub sensitive output when executing commands', async () => {
      mockRunner.when('cat /tmp/creds.env', {
        exitCode: 0,
        stdout: 'SECRET_TOKEN=my_secret_token_val_999\nPUBLIC_ID=42\n',
        stderr: ''
      });

      const res = await requestExecution('cat /tmp/creds.env', {
        runner: mockRunner.asRunner()
      });

      assert.strictEqual(res.status, 'EXECUTED');
      assert.ok(!res.stdout.includes('my_secret_token_val_999'));
      assert.ok(res.stdout.includes('SECRET_TOKEN=[REDACTED]'));
      assert.ok(res.stdout.includes('PUBLIC_ID=42'));
      assertNoEmojis(res);
    });
  });

  describe('6. Zero-Emoji Compliance Across All Methods', () => {
    it('should verify zero emojis across all service responses, records, and outputs', async () => {
      const safeRes = await requestExecution('uptime', { runner: mockRunner.asRunner() });
      assertNoEmojis(safeRes);

      const otpRes = await requestExecution('pm2 restart jarvis-api', { runner: mockRunner.asRunner() });
      assertNoEmojis(otpRes);

      const confirmRes = await confirmAndExecute(otpRes.commandId, otpRes.otpCode, { runner: mockRunner.asRunner() });
      assertNoEmojis(confirmRes);

      const forbiddenRes = await requestExecution('rm -rf /', { runner: mockRunner.asRunner() });
      assertNoEmojis(forbiddenRes);
    });
  });
});
