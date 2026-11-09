// Presupuesto preventivo por proceso, NO garantia de cuota del proveedor.
// Groq puede compartir limites con otros procesos; sus cabeceras mandan.
import { createHash } from 'node:crypto';

export function estimarTokensPeticion(payload) {
  // Aproximacion conservadora por bytes, no un tokenizer ni una medicion.
  const entrada = Math.ceil(Buffer.byteLength(JSON.stringify({ messages: payload.messages, tools: payload.tools }), 'utf8') / 3);
  return { entrada, salida: payload.max_tokens || 1024, total: entrada + (payload.max_tokens || 1024) };
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

export function crearPresupuestoGroq({ limite = 8000, ahora = Date.now, esperar = ms => new Promise(r => setTimeout(r, ms)), esperaMaxima = 70000 } = {}) {
  let cola = Promise.resolve();
  let reservas = [];
  let saldo = null;
  let limiteEfectivo = limite;
  let bloqueoHasta = 0;
  const observar = (headers) => {
    const lim = Number(cabecera(headers, 'x-ratelimit-limit-tokens'));
    if (Number.isFinite(lim) && lim > 0) limiteEfectivo = Math.min(limite, lim);
    const raw = cabecera(headers, 'x-ratelimit-remaining-tokens');
    const reset = duracionCabecera(cabecera(headers, 'x-ratelimit-reset-tokens'));
    if (raw != null && Number.isFinite(Number(raw)) && reset > 0) {
      saldo = { tokens: Math.max(0, Number(raw)), hasta: ahora() + reset };
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
          if (consumido + estimacion.total > limiteEfectivo) hasta = Math.max(hasta, reservas[0]?.hasta || t);
          if (saldo && saldo.tokens < estimacion.total) hasta = Math.max(hasta, saldo.hasta);
          if (hasta <= t) break;
          if (hasta - inicio > esperaMaxima) {
            const err = new Error('Presupuesto de tokens temporalmente ocupado; no se ha enviado esta llamada.');
            err.name = 'PresupuestoTemporalError';
            throw err;
          }
          await esperar(hasta - t);
        }
        const reserva = { tokens: estimacion.total, hasta: ahora() + 60000 };
        reservas.push(reserva);
        if (saldo) saldo.tokens = Math.max(0, saldo.tokens - estimacion.total);
        const esperaMs = ahora() - inicio;
        try {
          const { data, headers } = await enviar();
          // El proveedor puede contabilizar al completar, no al enviar.
          reserva.hasta = ahora() + 60000;
          // Sin usage fiable se conserva la reserva completa. No presumir hits.
          const u = data?.usage;
          if (Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0) {
            reserva.tokens = Math.max(0, u.prompt_tokens + u.completion_tokens);
          }
          observar(headers);
          return { data, presupuesto: { entradaEstimada: estimacion.entrada, salidaReservada: estimacion.salida, esperaMs } };
        } catch (err) {
          reserva.hasta = ahora() + 60000;
          observar(err?.headers);
          // Un error puede haber consumido tokens: reserva conservadora.
          throw err;
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
