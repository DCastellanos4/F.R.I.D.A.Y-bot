/**
 * Bash Console Fixtures for Task 12 (Secure Remote Bash Console with 2FA OTP).
 *
 * Categorized command strings, simulated terminal outputs, and masking test vectors.
 * Strict Policy: Zero Emojis.
 */

export const BASH_COMMAND_SETS = {
  safe: [
    'uptime',
    'date',
    'whoami',
    'id',
    'uname -a',
    'df -h',
    'free -m',
    'ps aux',
    'pm2 status',
    'pm2 list',
    'docker ps',
    'netstat -tuln',
    'ss -tuln',
    'cat /etc/os-release',
    'head -n 20 /var/log/syslog',
    'tail -n 30 /var/log/syslog',
    'git status',
    'git log -n 5 --oneline',
    'ping -c 3 8.8.8.8',
    'ip addr show eth0'
  ],
  critical: [
    'pm2 restart jarvis-api',
    'pm2 stop jarvis-whatsapp',
    'pm2 delete 0',
    'reboot',
    'shutdown -r now',
    'systemctl restart nginx',
    'systemctl stop fail2ban',
    'docker restart davis-postgres',
    'docker stop davis-redis',
    'docker rm -f old-container',
    'rm -f /tmp/testfile.txt',
    'rmdir /tmp/emptydir',
    'kill -9 18402',
    'killall node',
    'pkill -f python3',
    'chmod 755 deploy.sh',
    'chown ubuntu:ubuntu /home/ubuntu/file',
    'git pull origin main',
    'git checkout -- .',
    'git reset --hard HEAD~1',
    'apt update',
    'apt-get install -y htop',
    'echo "export VAR=1" >> ~/.bashrc',
    'echo "new text" > config.txt'
  ],
  forbidden: [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf / --no-preserve-root',
    'mkfs.ext4 /dev/sda1',
    'mkfs -t vfat /dev/sdb',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    ':(){ :|:& };:',
    '> /dev/sda'
  ],
  compoundSafe: [
    'uptime && date',
    'ps aux | grep node',
    'free -m; df -h'
  ],
  compoundCritical: [
    'uptime && pm2 restart jarvis-api',
    'cat file.txt | rm -f file.txt',
    'echo "Status:"; systemctl restart nginx'
  ],
  compoundForbidden: [
    'uptime; rm -rf /',
    'echo $(rm -rf /*)'
  ]
};

export const SYNTHETIC_TERMINAL_OUTPUTS = {
  uptime: ' 16:45:01 up 14 days,  3:25,  1 user,  load average: 0.14, 0.09, 0.06\n',
  df: [
    'Filesystem     1K-blocks     Used Available Use% Mounted on',
    '/dev/root       49182012 41312890   5352738  89% /',
    'tmpfs            1024000        0   1024000   0% /run'
  ].join('\n'),
  pm2Status: [
    '┌────┬────────────────────┬──────────┬──────┬───────────┬──────────┬──────────┐',
    '│ id │ name               │ mode     │ ↺    │ status    │ cpu      │ memory   │',
    '├────┼────────────────────┼──────────┼──────┼───────────┼──────────┼──────────┤',
    '│ 0  │ jarvis-api         │ fork     │ 0    │ online    │ 0.1%     │ 62.4mb   │',
    '│ 1  │ jarvis-whatsapp    │ fork     │ 0    │ online    │ 0.3%     │ 145.2mb  │',
    '└────┴────────────────────┴──────────┴──────┴───────────┴──────────┴──────────┘'
  ].join('\n'),
  sensitiveOutputWithKeys: [
    'Loaded configuration from /home/ubuntu/jarvis/.env',
    'OPENAI_API_KEY=sk-proj-abc1234567890def1234567890abcdef12',
    'BACKUP_ENCRYPTION_KEY=super_secure_master_password_99',
    'PORT=3000',
    'DATABASE_URL=postgres://user:db_secret_pass_123@localhost:5432/davis'
  ].join('\n')
};
