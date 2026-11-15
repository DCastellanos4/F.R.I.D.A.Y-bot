// Presupuesto preventivo por proceso, NO garantia de cuota del proveedor.
// Groq puede compartir limites con otros procesos; sus cabeceras mandan.
import { createHash } from 'node:crypto';

export function estimarTokensPeticion(payload) {
  // Aproximacion conservadora por bytes, no un tokenizer ni una medicion.
  const bytesMessages = payload.messages ? Buffer.byteLength(JSON.stringify(payload.messages), 'utf8') : 0;
  const bytesTools = payload.tools ? Buffer.byteLength(JSON.stringify(payload.tools), 'utf8') : 0;
  const entrada = Math.ceil((bytesMessages / 3) + (bytesTools / 8));
  const salida = payload.max_tokens ? Math.min(payload.max_tokens, 512) : 256;
  return { entrada, salida, total: entrada + salida };
}

function cabecera(headers, name) {
  return typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
}
export function duracionCabecera(valor) {
  if (!valor) return 0;
  const texto = String(valor);
  if (/^\d+(\.\d+)?$/.test(texto)) return Number(texto) * 1000;
  const partes = [...texto.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
  return partes.reduce((n, p) => n + Number(p[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[p[2]]), 0);
}

export function crearPresupuestoGroq({ limite = (typeof process !== 'undefined' && Number(process.env.GROQ_TOKEN_BUDGET)) || 8000, ahora = Date.now, esperar = ms => new Promise(r => setTimeout(r, ms)), esperaMaxima = 70000 } = {}) {
  let cola = Promise.resolve();
  let reservas = [];
  let saldo = null;
  let limiteEfectivo = limite;
  let bloqueoHasta = 0;
  const despertadores = new Set();
  const notificar = () => { for (const d of despertadores) d(); despertadores.clear(); };
  const observar = (headers) => {
    const lim = Number(cabecera(headers, 'x-ratelimit-limit-tokens'));
    if (Number.isFinite(lim) && lim > 0) limiteEfectivo = Math.min(limite, lim);
    const raw = cabecera(headers, 'x-ratelimit-remaining-tokens');
    const reset = duracionCabecera(cabecera(headers, 'x-ratelimit-reset-tokens'));
    if (raw != null && Number.isFinite(Number(raw))) {
      saldo = { tokens: Math.max(0, Number(raw)), hasta: ahora() + Math.max(reset || 0, 200) };
      if (reservas.length > 0) {
        const vigencia = ahora() + Math.min(reset > 0 ? reset : 1000, 60000);
        for (const r of reservas) {
          if (r.hasta > vigencia) r.hasta = vigencia;
        }
      }
    }
    const retry = cabecera(headers, 'retry-after');
    const segundos = Number(retry);
    const retryMs = retry == null ? 0 : (Number.isFinite(segundos) ? segundos * 1000 : Math.max(0, Date.parse(retry) - ahora()));
    // Un bloqueo diario sigue siendo responsabilidad del circuito por modelo.
    if (retryMs > 0 && retryMs <= esperaMaxima) bloqueoHasta = Math.max(bloqueoHasta, ahora() + retryMs);
  };
  return {
    ejecutar(payload, enviar) {
      const encolado = ahora();
      const trabajo = async () => {
        const estimacion = estimarTokensPeticion(payload);
        const inicio = encolado;
        if (ahora() - inicio > esperaMaxima) {
          const err = new Error('La espera en cola ha superado el plazo preventivo; no se ha enviado esta llamada.');
          err.name = 'PresupuestoTemporalError';
          throw err;
        }
        if (estimacion.total > limiteEfectivo) {
          const err = new Error('La peticion estimada supera el presupuesto por minuto. Reduce el contexto o divide la consulta.');
          err.name = 'PresupuestoTemporalError';
          throw err;
        }
        for (;;) {
          const t = ahora();
          reservas = reservas.filter(r => r.hasta > t);
          if (saldo && saldo.hasta <= t) saldo = null;
          const consumido = reservas.reduce((n, r) => n + r.tokens, 0);
          let hasta = bloqueoHasta;
          if (!saldo && consumido + estimacion.total > limiteEfectivo) hasta = Math.max(hasta, reservas[0]?.hasta || t);
          if (saldo && saldo.tokens < estimacion.total) hasta = Math.max(hasta, saldo.hasta);
          if (hasta <= t) break;
          if (hasta - inicio > esperaMaxima) {
            const err = new Error('Presupuesto de tokens temporalmente ocupado; no se ha enviado esta llamada.');
            err.name = 'PresupuestoTemporalError';
            throw err;
          }
          let despertar = null;
          const promesaDespertar = new Promise(r => { despertar = r; despertadores.add(r); });
          await Promise.race([esperar(hasta - t), promesaDespertar]).finally(() => despertadores.delete(despertar));
        }
        const reserva = { tokens: estimacion.total, hasta: ahora() + 60000 };
        reservas.push(reserva);
        if (saldo) saldo.tokens = Math.max(0, saldo.tokens - estimacion.total);
        const esperaMs = ahora() - inicio;
        try {
          const { data, headers } = await enviar();
          // El proveedor puede contabilizar al completar, no al enviar.
          const resetPost = duracionCabecera(cabecera(headers, 'x-ratelimit-reset-tokens'));
          reserva.hasta = ahora() + (resetPost > 0 ? resetPost : 60000);
          // Sin usage fiable se conserva la reserva completa. No presumir hits.
          const u = data?.usage;
          if (Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0) {
            reserva.tokens = Math.max(0, u.prompt_tokens + u.completion_tokens);
          }
          observar(headers);
          return { data, presupuesto: { entradaEstimada: estimacion.entrada, salidaReservada: estimacion.salida, esperaMs } };
        } catch (err) {
          const errHeaders = err?.headers || err?.response?.headers;
          const retryMs = duracionCabecera(cabecera(errHeaders, 'retry-after'));
          reserva.hasta = ahora() + (retryMs > 0 ? retryMs : 60000);
          observar(errHeaders);
          // Un error puede haber consumido tokens: reserva conservadora.
          throw err;
        } finally {
          notificar();
        }
      };
      const pendiente = cola.then(trabajo, trabajo);
      cola = pendiente.catch(() => {});
      return pendiente;
    }
  };
}

const presupuestos = new Map();
export function presupuestoGroqPara({ baseUrl, apiKey }) {
  // Identidad privada: no mezclar cuentas ni guardar claves en mapas/logs.
  const clave = createHash('sha256').update(`${baseUrl}\0${apiKey}`).digest('hex');
  if (!presupuestos.has(clave)) presupuestos.set(clave, crearPresupuestoGroq());
  return presupuestos.get(clave);
}
export function reiniciarPresupuestosGroq() { presupuestos.clear(); }
