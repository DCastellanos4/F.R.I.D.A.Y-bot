#!/usr/bin/env node
/**
 * watchdog.js - Watchdog EXTERNO de F.R.I.D.A.Y. (nº 23)
 *
 * Pensado para correr FUERA del VPS del bot (otro host, un cron gratuito de
 * un tercero, una GitHub Action programada...): si el bot o su servidor caen,
 * este vigilante sigue vivo y avisa. Un watchdog en el mismo host NO cubre la
 * caida del host completo, por eso la configuracion es explicita.
 *
 * Configuracion (variables de entorno; sin ellas el vigilante esta inactivo):
 *   DAVIS_HEALTHCHECK_URL   URL publica del bot a comprobar (por ejemplo la
 *                           del tunel de David apuntando a /api/salud).
 *   DAVIS_WATCHDOG_WEBHOOK  (opcional) URL de un webhook de notificacion que
 *                           recibira un POST JSON si el chequeo falla.
 *   DAVIS_WATCHDOG_TIMEOUT_MS (opcional, por defecto 10000).
 *
 * Uso:  DAVIS_HEALTHCHECK_URL=https://... node scripts/watchdog.js
 * Cron: cada 5 min (crontab clasico de 5 campos) -> DAVIS_HEALTHCHECK_URL=... node /ruta/watchdog.js
 *
 * Sale 0 si el bot responde (o si esta inactivo por falta de configuracion) y
 * 1 si el chequeo falla, para que el cron/servicio registre el fallo.
 */
const url = process.env.DAVIS_HEALTHCHECK_URL || null;
const webhook = process.env.DAVIS_WATCHDOG_WEBHOOK || null;
const timeoutMs = Number(process.env.DAVIS_WATCHDOG_TIMEOUT_MS) || 10000;

if (!url) {
  console.log('[Watchdog] Inactivo: define DAVIS_HEALTHCHECK_URL (y opcionalmente DAVIS_WATCHDOG_WEBHOOK) en el host externo.');
  process.exit(0);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('[Watchdog] DAVIS_HEALTHCHECK_URL debe empezar por http:// o https:// (https recomendado).');
  process.exit(1);
}

const controlador = new AbortController();
const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
try {
  const resp = await fetch(url, { signal: controlador.signal, redirect: 'error' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  console.log(`[Watchdog] Bot vivo (HTTP ${resp.status}).`);
  process.exit(0);
} catch (err) {
  console.error(`[Watchdog] El bot NO responde en ${url}: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  if (webhook && /^https:\/\//i.test(webhook)) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: `F.R.I.D.A.Y. no responde en ${url} (${err.message}). Revisa el VPS.` })
      });
      console.log('[Watchdog] Aviso enviado al webhook configurado.');
    } catch (errHook) {
      console.error(`[Watchdog] No se pudo notificar al webhook: ${errHook.message}`);
    }
  }
  process.exit(1);
} finally {
  clearTimeout(temporizador);
}
