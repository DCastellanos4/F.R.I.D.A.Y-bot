/**
 * emtAdapter.js - Adaptador EMT Madrid (MobilityLabs) para llegadas en vivo.
 *
 * Alcance: bloque extra de transporte aprobado por David (5 nov 2026).
 * API oficial: https://openapi.emtmadrid.es/
 * - Login: GET /v1/mobilitylabs/user/login/ con cabeceras X-ClientId y passKey.
 * - Llegadas: POST /v2/transport/busemtmad/stops/{stopId}/arrives/ con
 *   accessToken (guia oficial: mobilitylabs.emtmadrid.es/help/new-app).
 *
 * Sin DAVIS_EMT_CLIENT_ID y DAVIS_EMT_PASS_KEY el adaptador esta DESACTIVADO
 * y la funcion lo declara (config-required), nunca simula llegadas.
 * Capacidad en vivo no verificada en tests: las pruebas usan fetch inyectado.
 *
 * Strict Policy: Zero Emojis.
 */

const BASE = 'https://openapi.emtmadrid.es';

function credenciales(deps = {}) {
  const clientId = deps.clientId || process.env.DAVIS_EMT_CLIENT_ID || '';
  const passKey = deps.passKey || process.env.DAVIS_EMT_PASS_KEY || '';
  return clientId && passKey ? { clientId, passKey } : null;
}

export function emtConfigurado(deps = {}) {
  return credenciales(deps) !== null;
}

async function login(deps) {
  const creds = credenciales(deps);
  const fetchFn = deps.fetchFn || fetch;
  const resp = await fetchFn(`${BASE}/v1/mobilitylabs/user/login/`, {
    method: 'GET',
    headers: { 'X-ClientId': creds.clientId, passKey: creds.passKey },
    signal: AbortSignal.timeout(deps.timeoutMs || 10000)
  });
  const datos = await resp.json();
  const token = datos && datos.data && datos.data[0] && datos.data[0].accessToken;
  if (!token) throw new Error('La EMT no devolvio accessToken (credenciales rechazadas o servicio caido).');
  return token;
}

/**
 * Llegadas en vivo de una parada EMT.
 * Devuelve { ok:true, llegadas:[{linea, destino, segundos, distanciaMetros}] }
 * o { ok:false, configRequired:true, error } si faltan credenciales.
 */
export async function llegadasEmt(stopId, deps = {}) {
  const parada = String(stopId || '').replace(/\D/g, '');
  if (!parada) return { ok: false, error: 'Parada EMT invalida.' };
  if (!emtConfigurado(deps)) {
    return {
      ok: false,
      configRequired: true,
      error: 'El acceso a la EMT aun no esta configurado (faltan DAVIS_EMT_CLIENT_ID y DAVIS_EMT_PASS_KEY en el entorno del bot). El alta se hace en el portal de desarrolladores de la EMT (MobilityLabs); en cuanto este, te digo los buses en vivo.'
    };
  }
  try {
    const token = await login(deps);
    const fetchFn = deps.fetchFn || fetch;
    const resp = await fetchFn(`${BASE}/v2/transport/busemtmad/stops/${parada}/arrives/`, {
      method: 'POST',
      headers: { accessToken: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cultureInfo: 'ES',
        Text_StopRequired_YN: 'Y',
        Text_EstimationsRequired_YN: 'Y',
        Text_IncidencesRequired_YN: 'N',
        DateTime_Referenced_Incidencies_YYYYMMDD: new Date().toISOString().slice(0, 10).replace(/-/g, '')
      }),
      signal: AbortSignal.timeout(deps.timeoutMs || 10000)
    });
    const datos = await resp.json();
    const llegadasCrudas = (datos && datos.data && datos.data[0] && Array.isArray(datos.data[0].Arrive)) ? datos.data[0].Arrive : [];
    const llegadas = llegadasCrudas
      .filter((a) => typeof a.estimateArrive === 'number' && a.estimateArrive >= 0 && a.estimateArrive < 999999)
      .map((a) => ({
        linea: String(a.line || ''),
        destino: String(a.destination || ''),
        segundos: a.estimateArrive,
        distanciaMetros: typeof a.DistanceBus === 'number' ? a.DistanceBus : null
      }))
      .sort((a, b) => a.segundos - b.segundos)
      .slice(0, 8);
    return { ok: true, llegadas };
  } catch (err) {
    return { ok: false, error: `No he podido consultar la EMT: ${err.message}` };
  }
}
