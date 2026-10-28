import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { consultarJarvis } from './jarvisAgent.js';
import {
  listarRecordatorios,
  crearRecordatorio,
  cancelarRecordatorio
} from './reminderService.js';
import { generarBriefingCompleto } from './dailyBriefing.js';
import {
  consultarSaludServidor,
  iniciarVigilanteProactivo
} from './proactiveAlerts.js';
import { generarResumenInteligente } from './summarizerService.js';
import {
  listarMemorias,
  guardarMemoria,
  buscarMemorias,
  olvidarMemoria
} from './memoryService.js';
import {
  listarProductosVigilados,
  vigilarProducto,
  cancelarVigilancia,
  iniciarSniperWatchdog
} from './sniperService.js';
import { consultarClima } from './weatherService.js';
import {
  verifySignature,
  handleWebhookPayload
} from './githubWebhookService.js';

const PUERTO = config.port;

if (process.env.STANDALONE_API === 'true') {
  iniciarVigilanteProactivo();
  iniciarSniperWatchdog();
}

function parsearBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function handleApiRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature-256');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Endpoint de Webhook de GitHub Actions (CI/CD)
  if (req.method === 'POST' && url.pathname === '/api/webhook/github') {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);
      const signatureHeader = req.headers['x-hub-signature-256'] || '';
      const secret = process.env.GITHUB_WEBHOOK_SECRET || config.githubWebhookSecret || 'davis_ci_webhook_secret_998877';

      const isValid = verifySignature(rawBody, signatureHeader, secret);
      if (!isValid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
        return;
      }

      const result = handleWebhookPayload(payload, true);
      res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      console.error('Error procesando /api/webhook/github:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Endpoint de chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const data = await parsearBody(req);
      const mensaje = data.mensaje || data.prompt || '';

      if (!mensaje) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Falta el campo "mensaje"' }));
        return;
      }

      console.log(`[Chat] [HTTP API] Petición: "${mensaje}"`);
      const respuesta = await consultarJarvis(mensaje);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, respuesta }));
    } catch (err) {
      console.error('Error procesando /api/chat:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Endpoint de clima
  if (req.method === 'GET' && url.pathname === '/api/clima') {
    const ubicacion = url.searchParams.get('lugar') || config.weather.defaultCity;
    const momento = url.searchParams.get('momento') || 'hoy';
    const data = await consultarClima({ ubicacion, momento });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // Endpoint de memorias (Second Brain)
  if (url.pathname === '/api/memorias') {
    if (req.method === 'GET') {
      const categoria = url.searchParams.get('categoria');
      const consulta = url.searchParams.get('buscar');
      if (consulta) {
        const resultados = buscarMemorias(consulta);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, memorias: resultados }));
      } else {
        const lista = listarMemorias(categoria);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, memorias: lista }));
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const data = await parsearBody(req);
        const resMem = guardarMemoria(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resMem));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === 'DELETE') {
      const criterio = url.searchParams.get('criterio') || '*';
      const resDel = olvidarMemoria(criterio);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resDel));
      return;
    }
  }

  // Endpoint de Sniper
  if (url.pathname === '/api/sniper') {
    if (req.method === 'GET') {
      const lista = listarProductosVigilados();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, productos: lista }));
      return;
    }

    if (req.method === 'POST') {
      try {
        const data = await parsearBody(req);
        const resSnip = await vigilarProducto(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resSnip));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === 'DELETE') {
      const criterio = url.searchParams.get('criterio') || '*';
      const resDel = cancelarVigilancia(criterio);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resDel));
      return;
    }
  }

  // Endpoint de recordatorios
  if (url.pathname === '/api/recordatorios') {
    if (req.method === 'GET') {
      const lista = listarRecordatorios();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, recordatorios: lista }));
      return;
    }

    if (req.method === 'POST') {
      try {
        const data = await parsearBody(req);
        const resRem = crearRecordatorio(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resRem));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === 'DELETE') {
      const criterio = url.searchParams.get('criterio') || '*';
      const resDel = cancelarRecordatorio(criterio);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resDel));
      return;
    }
  }

  // Endpoint de resumen directo de URL
  if (req.method === 'POST' && url.pathname === '/api/resumir') {
    try {
      const data = await parsearBody(req);
      const urlObjetivo = data.url;
      if (!urlObjetivo) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Falta el campo "url"' }));
        return;
      }

      const resumen = await generarResumenInteligente(urlObjetivo);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, resumen }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Endpoint de salud del sistema
  if (req.method === 'GET' && url.pathname === '/api/salud') {
    const salud = consultarSaludServidor();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, salud }));
    return;
  }

  // Endpoint de briefing
  if (req.method === 'GET' && url.pathname === '/api/briefing') {
    const texto = await generarBriefingCompleto(config.weather.defaultCity);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, briefing: texto }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
}

export const server = http.createServer(handleApiRequest);

const isTest = process.env.NODE_ENV === 'test' ||
  process.argv.some(a => a.includes('--test') || a.includes('run_all'));

const isDirectRun = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('api.js'))
);

const isPm2 = typeof process.env.pm_id !== 'undefined';

if (!isTest && (isDirectRun || isPm2 || process.env.RUN_API_SERVER === 'true' || process.env.STANDALONE_API === 'true')) {
  server.listen(PUERTO, '0.0.0.0', () => {
    console.log(`[Web] Servidor API de FRIDAY escuchando en http://0.0.0.0:${PUERTO}`);
  });
}
