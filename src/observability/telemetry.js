/**
 * telemetry.js - Observabilidad (Mejora 3): OpenTelemetry + Prometheus.
 *
 * - Trazas OTel: un TraceId por mensaje entrante que atraviesa clasificacion,
 *   llamadas LLM, ejecucion de herramientas y escrituras de BD. Export OTLP
 *   HTTP (Jaeger/Tempo local en el VPS).
 * - Metricas Prometheus (prom-client): latencias P95/P99 de LLM y tools,
 *   errores de tools y tokens por sesion. Endpoint /metrics en la API,
 *   SOLO localhost (Prometheus convive en el mismo VPS).
 *
 * PRIVACIDAD (regla dura): NUNCA se registra texto de mensajes, contenido
 * de memorias, argumentos de herramientas ni secretos en atributos de spans
 * ni en labels de metricas. Solo metadatos: canal, via, modelo, herramienta,
 * entidad, duraciones, conteos de tokens y un hash opaco de sesion.
 *
 * Activacion por entorno (todo opcional y con no-op seguro):
 *   DAVIS_OTEL_ENABLED=true            apagado por defecto
 *   DAVIS_OTEL_ENDPOINT                def: http://127.0.0.1:4318/v1/traces
 *   DAVIS_OTEL_SERVICIO                def: por proceso (jarvis-whatsapp /
 *                                        jarvis-api en sus entrypoints; 'jarvis'
 *                                        como ultimo recurso)
 *   DAVIS_METRICS_ENABLED              def: sigue a DAVIS_OTEL_ENABLED
 *
 * Strict Policy: Zero Emojis.
 */
import crypto from 'node:crypto';

/* ------------------------------ estado interno -------------------------- */

const estado = {
  iniciado: false,
  trazasActivas: false,
  metricasActivas: false,
  tracer: null,
  provider: null,
  registry: null,
  metricas: null,
  sesionesVistas: new Set(),
  servidorMetricas: null,
  error: null
};

/** Maximo de sesiones distintas en la metrica de tokens: acota la
 *  cardinalidad de Prometheus. El detalle por sesion esta en las trazas. */
const MAX_SESIONES_METRICA = 100;

/** Whitelist DURA de atributos de span: cualquier clave fuera de esta lista
 *  se descarta. Truncar strings NO sanitiza secretos; solo se admiten
 *  metadatos conocidos, construidos en los puntos de instrumentacion. */
const ATRIBUTOS_PERMITIDOS = new Set([
  'canal', 'sesion', 'via', 'modelo', 'herramienta', 'entidad', 'operacion',
  'resultado', 'motivo', 'ronda', 'tipo'
]);

function envVerdad(v) {
  return /^(1|true|si|yes)$/i.test(String(v || '').trim());
}

/** Hash opaco y estable de una sesion/chat para labels y atributos. */
export function hashSesion(id) {
  return crypto.createHash('sha256').update(String(id || 'desconocida')).digest('hex').slice(0, 16);
}

/** Label de sesion con cardinalidad acotada: pasado el maximo, las nuevas
 *  sesiones se agrupan en "otras" (su detalle sigue en las trazas). */
function labelSesionMetrica(id) {
  if (!id) return 'desconocida';
  const h = hashSesion(id);
  if (estado.sesionesVistas.has(h)) return h;
  if (estado.sesionesVistas.size >= MAX_SESIONES_METRICA) return 'otras';
  estado.sesionesVistas.add(h);
  return h;
}

/* --------------------------- carga perezosa de deps --------------------- */

async function cargarDepsTrazas() {
  try {
    const api = await import('@opentelemetry/api');
    const sdk = await import('@opentelemetry/sdk-trace-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = await import('@opentelemetry/resources');
    return { api, sdk, OTLPTraceExporter, Resource };
  } catch {
    return null;
  }
}

async function cargarPromClient() {
  try {
    return await import('prom-client');
  } catch {
    return null;
  }
}

/* --------------------------------- init --------------------------------- */

/**
 * Inicializa trazas y metricas. Idempotente. Sin las deps o con el flag
 * apagado queda en no-op: el resto del codigo puede llamar siempre.
 * @param {Object} [opts]
 * @param {boolean} [opts.forzarTrazas]  Activa trazas aunque el flag no este (pruebas).
 * @param {boolean} [opts.forzarMetricas]
 * @param {Object}  [opts.spanProcessor] Procesador inyectado (pruebas, InMemory).
 * @param {string}  [opts.endpoint]      OTLP HTTP (def: env o http://127.0.0.1:4318/v1/traces).
 * @param {string}  [opts.servicio]      Nombre del servicio (def: env o 'jarvis').
 */
export async function iniciarObservabilidad(opts = {}) {
  if (estado.iniciado) return estado;
  estado.iniciado = true;

  const quererTrazas = opts.forzarTrazas === true || envVerdad(process.env.DAVIS_OTEL_ENABLED);
  const quererMetricas = opts.forzarMetricas === true ||
    (process.env.DAVIS_METRICS_ENABLED !== undefined
      ? envVerdad(process.env.DAVIS_METRICS_ENABLED)
      : quererTrazas);

  if (quererTrazas) {
    const deps = await cargarDepsTrazas();
    if (deps) {
      try {
        const { api, sdk, OTLPTraceExporter, Resource } = deps;
        const endpoint = opts.endpoint || process.env.DAVIS_OTEL_ENDPOINT || 'http://127.0.0.1:4318/v1/traces';
        const servicio = opts.servicio || process.env.DAVIS_OTEL_SERVICIO || 'jarvis';
        const processor = opts.spanProcessor ||
          new sdk.BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }));
        // service.name EXPLICITO en el resource: sin el, Jaeger agrupa todo
        // bajo "unknown_service:node" y no se distingue whatsapp de API.
        const resource = Resource.default().merge(new Resource({ 'service.name': servicio }));
        const provider = new sdk.NodeTracerProvider({ resource, spanProcessors: [processor] });
        provider.register();
        estado.provider = provider;
        estado.tracer = api.trace.getTracer(servicio);
        estado.trazasActivas = true;
        console.log('[Observabilidad] Trazas OTel activas (OTLP HTTP).');
      } catch (err) {
        // Habilitado explicitamente pero roto: error RUIDOSO, no no-op silencioso.
        estado.error = `trazas: ${err.message}`;
        console.error('[Observabilidad] ERROR: DAVIS_OTEL_ENABLED=true pero las trazas no se activaron:', err.message);
      }
    } else {
      estado.error = 'trazas: dependencias @opentelemetry/* no instaladas';
      console.error('[Observabilidad] ERROR: DAVIS_OTEL_ENABLED=true pero faltan las dependencias @opentelemetry/* (npm ci). Trazas desactivadas.');
    }
  }

  if (quererMetricas) {
    const prom = await cargarPromClient();
    if (prom) {
      const registry = new prom.Registry();
      const buck = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
      estado.metricas = {
        consultaDuracion: new prom.Histogram({
          name: 'jarvis_consulta_duracion_segundos',
          help: 'Latencia de una consulta completa del agente',
          labelNames: ['via'],
          buckets: buck,
          registers: [registry]
        }),
        llmDuracion: new prom.Histogram({
          name: 'jarvis_llm_duracion_segundos',
          help: 'Latencia por llamada LLM (P95/P99 via histogram_quantile)',
          labelNames: ['modelo', 'resultado'],
          buckets: buck,
          registers: [registry]
        }),
        llmTokens: new prom.Counter({
          name: 'jarvis_llm_tokens_total',
          help: 'Tokens consumidos por el LLM, por sesion',
          labelNames: ['modelo', 'tipo', 'sesion'],
          registers: [registry]
        }),
        toolDuracion: new prom.Histogram({
          name: 'jarvis_tool_duracion_segundos',
          help: 'Latencia por ejecucion de herramienta',
          labelNames: ['herramienta', 'resultado'],
          buckets: buck,
          registers: [registry]
        }),
        toolErrores: new prom.Counter({
          name: 'jarvis_tool_errores_total',
          help: 'Errores de herramientas por tipo',
          labelNames: ['herramienta', 'tipo'],
          registers: [registry]
        })
      };
      estado.registry = registry;
      estado.metricasActivas = true;
      console.log('[Observabilidad] Metricas Prometheus activas.');
    } else {
      estado.error = `metricas: prom-client no instalado${estado.error ? ' | ' + estado.error : ''}`;
      console.error('[Observabilidad] ERROR: metricas habilitadas pero falta prom-client (npm ci). Metricas desactivadas.');
    }
  }

  // Servidor de metricas dedicado por PROCESO, solo loopback: el agente vive
  // en jarvis-whatsapp y la API en otro proceso; cada uno expone el suyo.
  const puerto = Number(opts.puertoMetricas ?? process.env.DAVIS_METRICS_PUERTO) || 0;
  if (estado.metricasActivas && puerto > 0) {
    try {
      const { default: http } = await import('node:http');
      // Bind configurable y EXPLICITO: 127.0.0.1 (def, nadie mas lo alcanza)
      // o la IP gateway de la red bridge interna del stack (p. ej.
      // 172.30.50.1: solo la subred interna y el propio host; NUNCA 0.0.0.0
      // indiscriminado). Un listener en 127.0.0.1 NO es alcanzable desde
      // los contenedores: el bridge entra por otra interfaz.
      // AISLAMIENTO DE TESTS: con NODE_ENV=test el bind NO hereda
      // DAVIS_METRICS_HOST del entorno. En el servidor, la release enlaza
      // .env al estado de produccion; un test que heredara la IP del bridge
      // (172.30.50.1) quedaria inalcanzable desde 127.0.0.1 y fallaria SOLO
      // en el servidor mientras CI pasa (divergencia de entorno, no de codigo).
      // Los tests siempre pueden fijar el host con opts.hostMetricas.
      const esEntornoTest = process.env.NODE_ENV === 'test';
      const hostBind = opts.hostMetricas ?? (esEntornoTest ? '127.0.0.1' : (process.env.DAVIS_METRICS_HOST ?? '127.0.0.1'));
      estado.servidorMetricas = http.createServer((req, res) => {
        atenderMetricas(req, res).then((atendida) => {
          if (!atendida) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Solo /metrics.');
          }
        }).catch(() => {
          try { res.writeHead(500); res.end(); } catch { /* nada */ }
        });
      });
      await new Promise((resolve, reject) => {
        estado.servidorMetricas.once('error', reject);
        estado.servidorMetricas.listen(puerto, hostBind, resolve);
      });
      console.log(`[Observabilidad] /metrics de este proceso en http://${hostBind}:${puerto}/metrics`);
    } catch (err) {
      estado.error = `servidor metricas: ${err.message}`;
      console.error(`[Observabilidad] ERROR: no se pudo abrir el puerto de metricas ${puerto}:`, err.message);
    }
  }

  return estado;
}

export function estadoObservabilidad() {
  return {
    iniciado: estado.iniciado,
    trazasActivas: estado.trazasActivas,
    metricasActivas: estado.metricasActivas,
    puertoMetricas: estado.servidorMetricas ? (estado.servidorMetricas.address() && estado.servidorMetricas.address().port) || null : null,
    error: estado.error
  };
}

/** Reinicia el estado (solo pruebas). Desregistra los globales OTel:
 *  la API solo admite un provider global y sin esto el siguiente
 *  provider.register() cae en un proxy que descarta los spans. */
export async function reiniciarObservabilidadParaPruebas() {
  if (estado.provider) {
    try { await estado.provider.shutdown(); } catch { /* nada */ }
  }
  try {
    const api = await import('@opentelemetry/api');
    if (typeof api.disable === 'function') api.disable();
    else {
      if (api.trace && typeof api.trace.disable === 'function') api.trace.disable();
      if (api.context && typeof api.context.disable === 'function') api.context.disable();
      if (api.propagation && typeof api.propagation.disable === 'function') api.propagation.disable();
    }
  } catch { /* nada */ }
  estado.iniciado = false;
  estado.trazasActivas = false;
  estado.metricasActivas = false;
  estado.tracer = null;
  estado.provider = null;
  estado.registry = null;
  estado.metricas = null;
  estado.sesionesVistas = new Set();
  if (estado.servidorMetricas) {
    try { estado.servidorMetricas.close(); } catch { /* nada */ }
  }
  estado.servidorMetricas = null;
  estado.error = null;
}

/* --------------------------------- trazas ------------------------------- */

/**
 * Ejecuta fn dentro de un span activo (no-op transparente si las trazas
 * estan apagadas). Los atributos deben ser SOLO metadatos (ver privacidad).
 */
/** Enum Duro de clases de error permitidas (labels y exception.type).
 *  Una clase recibida no es de confianza: puede contener un secreto o ser
 *  infinitamente variable. Lo no reconocido va a 'otro'. */
const CLASES_ERROR_PERMITIDAS = new Set([
  'error', 'typeerror', 'referenceerror', 'syntaxerror', 'rangeerror',
  'evalerror', 'urierror', 'aggregateerror', 'aborterror',
  'timeout', 'red', 'econnrefused', 'econnreset', 'enotfound', 'etimedout',
  'socketerror', 'cuota', 'quota', 'ratelimit', 'rate_limit',
  'config_required', 'validacion', 'estado', 'resultado_error', 'otro'
]);

/** Clase de error acotada: enum permitido o 'otro'. Nunca un mensaje, un
 *  codigo arbitrario ni una clase no reconocida (secretos / cardinalidad). */
function claseErrorLabel(err) {
  const cruda = String(err && (err.name || err.tipo || err.code) || 'error');
  const normalizada = cruda.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return CLASES_ERROR_PERMITIDAS.has(normalizada) ? normalizada : 'otro';
}

/**
 * Registra un error en el span SIN contenido arbitrario: solo la CLASE del
 * enum. Nunca err.message ni stack: pueden arrastrar secretos o datos
 * privados a los atributos exception.* del span.
 */
function registrarErrorEnSpan(span, err) {
  try {
    span.recordException({ name: claseErrorLabel(err), message: '' });
    span.setStatus({ code: 2, message: 'error' }); // 2 = ERROR, mensaje estatico
  } catch { /* nada */ }
}

export async function conSpan(nombre, atributos, fn) {
  if (typeof atributos === 'function') { fn = atributos; atributos = {}; }
  if (!estado.trazasActivas || !estado.tracer) return fn();
  return estado.tracer.startActiveSpan(nombre, { attributes: sanitizarAtributos(atributos) }, async (span) => {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      registrarErrorEnSpan(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Whitelist de claves + solo escalares + recorte. Cualquier clave no
 *  permitida se DESCARTA (defensa frente a secretos, no truncado). */
function sanitizarAtributos(atributos = {}) {
  const limpios = {};
  for (const [k, v] of Object.entries(atributos || {})) {
    if (!ATRIBUTOS_PERMITIDOS.has(k)) continue;
    if (typeof v === 'boolean' || typeof v === 'number') limpios[k] = v;
    else if (typeof v === 'string') limpios[k] = v.slice(0, 120);
  }
  return limpios;
}

/**
 * Variante que conserva la sincronia del callback: con las trazas apagadas
 * devuelve fn() tal cual (sin Promise). Imprescindible para stores SQLite
 * (better-sqlite3 es sincrono; envolver con una funcion async romperia su
 * contrato). Si fn devuelve una Promise, el span se cierra al resolverse.
 */
export function conSpanPosibleSincrono(nombre, atributos, fn) {
  if (!estado.trazasActivas || !estado.tracer) return fn();
  return estado.tracer.startActiveSpan(nombre, { attributes: sanitizarAtributos(atributos) }, (span) => {
    try {
      const res = fn();
      if (res && typeof res.then === 'function') {
        return res.then(
          (v) => { span.end(); return v; },
          (err) => {
            registrarErrorEnSpan(span, err);
            span.end();
            throw err;
          }
        );
      }
      span.end();
      return res;
    } catch (err) {
      registrarErrorEnSpan(span, err);
      span.end();
      throw err;
    }
  });
}

/* -------------------------------- metricas ------------------------------ */

export function registrarFinConsulta({ via = 'desconocida', duracionSeg = 0 } = {}) {
  if (!estado.metricasActivas) return;
  estado.metricas.consultaDuracion.observe({ via: String(via).slice(0, 40) }, Math.max(0, duracionSeg));
}

export function registrarFinLLM({ modelo = 'desconocido', sesion = null, duracionSeg = 0, usage = null, error = null } = {}) {
  if (!estado.metricasActivas) return;
  const modeloLbl = String(modelo || 'desconocido').slice(0, 60);
  estado.metricas.llmDuracion.observe({ modelo: modeloLbl, resultado: error ? 'error' : 'ok' }, Math.max(0, duracionSeg));
  const sesionLbl = labelSesionMetrica(sesion);
  const prompt = Number(usage && (usage.prompt_tokens ?? usage.promptTokens)) || 0;
  const completion = Number(usage && (usage.completion_tokens ?? usage.completionTokens)) || 0;
  if (prompt > 0) estado.metricas.llmTokens.inc({ modelo: modeloLbl, tipo: 'entrada', sesion: sesionLbl }, prompt);
  if (completion > 0) estado.metricas.llmTokens.inc({ modelo: modeloLbl, tipo: 'salida', sesion: sesionLbl }, completion);
}

export function registrarFinTool({ herramienta = 'desconocida', duracionSeg = 0, error = null } = {}) {
  if (!estado.metricasActivas) return;
  const nombre = String(herramienta || 'desconocida').slice(0, 60);
  estado.metricas.toolDuracion.observe({ herramienta: nombre, resultado: error ? 'error' : 'ok' }, Math.max(0, duracionSeg));
  if (error) {
    estado.metricas.toolErrores.inc({ herramienta: nombre, tipo: claseErrorLabel(error) });
  }
}

/* ----------------------------- endpoint /metrics ------------------------ */

function ipV4(ip) {
  if (!ip) return null;
  const limpia = String(ip).startsWith('::ffff:') ? String(ip).slice(7) : String(ip);
  const partes = limpia.split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return partes.reduce((acc, n) => (acc << 8) + n, 0) >>> 0;
}

function ipEnCidr(ip, cidr) {
  const [base, bitsTxt] = String(cidr || '').split('/');
  const bits = Number(bitsTxt);
  const ipN = ipV4(ip);
  const baseN = ipV4(base);
  if (ipN === null || baseN === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mascara = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (ipN & mascara) === (baseN & mascara);
}

/**
 * Acceso a /metrics: localhost, o las redes internas declaradas en
 * DAVIS_METRICS_REDES_PERMITIDAS (CIDRs separados por coma, p. ej.
 * "172.30.50.0/24" para la red docker interna del stack de
 * observabilidad). Nada mas: cualquier otra IP recibe 403.
 */
function esOrigenPermitido(req) {
  const ip = req && req.socket && req.socket.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  const redes = String(process.env.DAVIS_METRICS_REDES_PERMITIDAS || '').split(',').map((r) => r.trim()).filter(Boolean);
  return redes.some((cidr) => ipEnCidr(ip, cidr));
}

/**
 * Manejador HTTP de /metrics para el servidor de api.js (node:http).
 * Solo localhost: Prometheus convive en el VPS; no se expone en publico.
 * Devuelve true si la peticion fue atendida aqui.
 */
export async function atenderMetricas(req, res) {
  if (!req.url || !req.url.split('?')[0].endsWith('/metrics')) return false;
  if (!esOrigenPermitido(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Solo localhost o redes internas permitidas.');
    return true;
  }
  if (!estado.metricasActivas || !estado.registry) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    // Si estaba habilitado explicitamente y fallo, la respuesta lo dice:
    // los flags globales no ocultan dependencias faltantes.
    res.end(`Metricas no activas. ${estado.error || 'Activalas con DAVIS_OTEL_ENABLED / DAVIS_METRICS_ENABLED.'}`);
    return true;
  }
  res.writeHead(200, { 'Content-Type': estado.registry.contentType });
  res.end(await estado.registry.metrics());
  return true;
}

/* --------------------- instrumentacion de stores SQLite ------------------ */

/**
 * Envuelve los metodos mutadores de un store con un span 'db_write'
 * (entidad/operacion como unicos atributos; nunca datos). Sincrono y
 * asincrono transparente. No-op si las trazas estan apagadas.
 */
export function instrumentarEscrituras(store, entidad, metodos = ['guardar', 'transaccion']) {
  if (!store || typeof store !== 'object') return store;
  const envuelto = Object.create(Object.getPrototypeOf(store) || Object.prototype);
  for (const k of Object.keys(store)) envuelto[k] = store[k];
  for (const metodo of metodos) {
    if (typeof store[metodo] !== 'function') continue;
    envuelto[metodo] = function (...args) {
      return conSpanPosibleSincrono('db_write', { entidad, operacion: metodo }, () => store[metodo](...args));
    };
  }
  return envuelto;
}
