/**
 * Fail2ban and SSH Security Fixtures for Task 14 (Fail2ban & SSH Security Monitor).
 *
 * Provides realistic /var/log/fail2ban.log entries, /var/log/auth.log lines,
 * logrotate test sequences, and fail2ban-client CLI output.
 *
 * Strict Policy: Zero Emojis.
 */

export const FAIL2BAN_LOG_SAMPLES = {
  standardLog: [
    '2026-10-28 14:00:00,100 fail2ban.server         [1200]: INFO    Server ready',
    '2026-10-28 14:00:01,200 fail2ban.jail           [1200]: INFO    Jail \'sshd\' started',
    '2026-10-28 14:15:30,345 fail2ban.filter         [1200]: INFO    [sshd] Found 198.51.100.42 - 2026-10-28 14:15:30',
    '2026-10-28 14:15:32,678 fail2ban.filter         [1200]: INFO    [sshd] Found 198.51.100.42 - 2026-10-28 14:15:32',
    '2026-10-28 14:15:35,901 fail2ban.filter         [1200]: INFO    [sshd] Found 198.51.100.42 - 2026-10-28 14:15:35',
    '2026-10-28 14:23:01,123 fail2ban.actions        [1200]: NOTICE  [sshd] Ban 198.51.100.42',
    '2026-10-28 14:24:15,456 fail2ban.actions        [1200]: NOTICE  [sshd] Ban 203.0.113.19',
    '2026-10-28 14:28:40,789 fail2ban.actions        [1200]: NOTICE  [sshd] Ban 2001:db8:85a3::8a2e:370:7334',
    '2026-10-28 15:23:01,123 fail2ban.actions        [1200]: NOTICE  [sshd] Unban 198.51.100.42',
    '2026-10-28 15:30:00,000 fail2ban.actions        [1200]: NOTICE  [sshd] Restore Ban 198.51.100.42'
  ].join('\n'),

  singleBanIpv4: '2026-10-28 16:30:05,123 fail2ban.actions        [1200]: NOTICE  [sshd] Ban 192.0.2.1',

  singleBanIpv6: '2026-10-28 16:32:10,456 fail2ban.actions        [1200]: NOTICE  [sshd] Ban 2001:0db8:0000:0000:0000:ff00:0042:8329',

  nonBanLines: [
    '2026-10-28 16:00:00,000 fail2ban.filter         [1200]: INFO    [sshd] Found 10.0.0.5 - 2026-10-28 16:00:00',
    '2026-10-28 16:05:00,000 fail2ban.actions        [1200]: NOTICE  [sshd] Unban 10.0.0.5'
  ].join('\n')
};

export const AUTH_LOG_SAMPLES = [
  'Oct 28 14:22:55 vps-oracle sshd[14818]: Invalid user test from 198.51.100.42 port 48208',
  'Oct 28 14:22:58 vps-oracle sshd[14820]: Failed password for root from 198.51.100.42 port 48210 ssh2',
  'Oct 28 14:23:00 vps-oracle sshd[14822]: Failed password for invalid user admin from 198.51.100.42 port 48212 ssh2',
  'Oct 28 14:30:12 vps-oracle sshd[15010]: Accepted publickey for ubuntu from 85.12.34.56 port 51234 ssh2: RSA SHA256:abc123'
].join('\n');

export const FAIL2BAN_CLI_STATUS_SSHD = [
  'Status for the jail: sshd',
  '|- Filter',
  '|  |- Currently failed: 2',
  '|  |- Total failed:     38',
  '|  `- File list:        /var/log/auth.log',
  '`- Actions',
  '   |- Currently banned: 2',
  '   |- Total banned:     11',
  '   `- Banned IP list:   198.51.100.42 203.0.113.19'
].join('\n');
