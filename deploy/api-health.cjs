'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');

function requestHealth({port, token}) {
  return new Promise((resolve, reject) => {
    const request = http.get({hostname: '127.0.0.1', port, path: '/api/salud',
      headers: token === undefined ? {} : {Authorization: `Bearer ${token}`}}, response => {
      let body = ''; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) { response.destroy(); reject(new Error('API_HEALTH_RESPONSE_LIMIT')); return; }
        body += chunk;
      });
      response.on('end', () => {
        let json; try { json = JSON.parse(body); } catch {}
        resolve({status: response.statusCode, json});
      });
      response.on('error', () => reject(new Error('API_HEALTH_RESPONSE_ERROR')));
    });
    request.setTimeout(10000, () => request.destroy());
    request.on('error', () => reject(new Error('API_HEALTH_REQUEST_ERROR')));
  });
}
async function verifyApiHealth({port = 3000, token}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('API_HEALTH_PORT');
  if (token) {
    const valid = await requestHealth({port, token});
    const absent = await requestHealth({port});
    const wrong = await requestHealth({port, token: 'invalid-healthcheck-' + crypto.randomBytes(24).toString('hex')});
    if (valid.status !== 200 || valid.json?.ok !== true || absent.status !== 401 || wrong.status !== 401) throw new Error('API_HEALTH_AUTH_CONTRACT');
    return 'API: authenticated200 and absent/wrong401 verified.';
  }
  const disabled = await requestHealth({port});
  if (disabled.status !== 503 || disabled.json?.error !== 'API REST deshabilitada: define API_TOKEN en el entorno para habilitarla.') throw new Error('API_HEALTH_DISABLED_CONTRACT');
  return 'API: disabled503 verified (no configured token).';
}
module.exports = {verifyApiHealth};
if (require.main === module) {
  (async () => {
    const configFile = path.resolve(process.argv[2]);
    const app = require(configFile).apps.find(app => app.name === 'jarvis-api');
    if (!app?.env) throw new Error('API_HEALTH_CONFIG');
    // Match application precedence without exporting secrets to shell/argv.
    const fs = require('node:fs');
    const envFile = path.join(path.dirname(configFile), '.env');
    const legacy = !app.env.API_TOKEN && !process.env.API_TOKEN && fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
    console.log(await verifyApiHealth({port: app.env.PORT || 3000, token: app.env.API_TOKEN || process.env.API_TOKEN || legacy.API_TOKEN}));
  })().catch(() => { console.error('API_HEALTH_FAILED: expected health/auth contract not verified.'); process.exitCode = 1; });
}
