/**
 * ecosystem.config.cjs
 * PM2 Process Manager Configuration for D.A.V.I.S.
 * Services: jarvis-api and jarvis-whatsapp
 * Strict quality: Zero emojis.
 */

module.exports = {
  apps: [
    {
      name: 'jarvis-api',
      script: 'api.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      max_restarts: 10,
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 5000,
      listen_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        STANDALONE_API: 'true'
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        STANDALONE_API: 'true'
      }
    },
    {
      name: 'jarvis-whatsapp',
      script: 'whatsappBot.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      }
    }
  ]
};
