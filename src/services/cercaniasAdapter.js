/**
 * cercaniasAdapter.js - Adaptador Cercanias Renfe (GTFS-RT publico).
 *
 * Alcance: bloque extra de transporte aprobado por David (5 nov 2026).
 * Feed oficial sin credenciales: https://gtfsrt.renfe.com/trip_updates.json
 * (conjunto "Horarios de viaje", data.renfe.com; actualizacion cada 20 s,
 * licencia CC-BY 4.0). Cobertura del nucleo de Madrid verificada el 5 nov 2026
 * contra el feed en vivo (paradas 17xxx/18xxx presentes).
 *
 * Que da de verdad: viajes CON actualizacion en vivo (hora estimada + retraso
 * por parada, cancelaciones). Los servicios sin incidencia pueden no aparecer
 * en el feed: el bot lo declara y no inventa horarios.
 *
 * Strict Policy: Zero Emojis.
 */

const URL_FEED = 'https://gtfsrt.renfe.com/trip_updates.json';
const URL_FEED_LD = 'https://gtfsrt.renfe.com/trip_updates_LD.json';
const MAX_BYTES = 4 * 1024 * 1024;

async function llegadasFeedRenfe(stopId, urlFeed, deps = {}) {
  const estacion = String(stopId || '').replace(/\D/g, '');
  if (!estacion) return { ok: false, error: 'Estacion invalida.' };
  const ahora = deps.ahora ? new Date(deps.ahora) : new Date();
  try {
    const fetchFn = deps.fetchFn || fetch;
    const resp = await fetchFn(urlFeed, { signal: AbortSignal.timeout(deps.timeoutMs || 15000) });
    const texto = await resp.text();
    if (texto.length > MAX_BYTES) return { ok: false, error: 'El feed de Renfe ha superado el tamano maximo admitido.' };
    const feed = JSON.parse(texto);
    const entidades = Array.isArray(feed.entity) ? feed.entity : [];
    const llegadas = [];
    for (const e of entidades) {
      const tu = e.tripUpdate || e.trip_update;
      if (!tu) continue;
      const viaje = (tu.trip && (tu.trip.tripId || tu.trip.trip_id)) || e.id || 'desconocido';
      const cancelado = tu.trip && (tu.trip.scheduleRelationship === 'CANCELED' || tu.trip.schedule_relationship === 3 || tu.trip.scheduleRelationship === 3);
      const actualizaciones = tu.stopTimeUpdate || tu.stop_time_update || [];
      for (const stu of actualizaciones) {
        const sid = String(stu.stopId || stu.stop_id || '');
        if (sid !== estacion) continue;
        const arr = stu.arrival || stu.departure || null;
        const tiempo = arr && (arr.time !== undefined ? Number(arr.time) : null);
        if (!tiempo) continue;
        const segundos = Math.round(tiempo - ahora.getTime() / 1000);
        if (segundos < -120) continue; // ya paso
        llegadas.push({
          viaje: String(viaje),
          segundos,
          retrasoSegundos: typeof arr.delay === 'number' ? arr.delay : 0,
          cancelado: cancelado === true
        });
      }
    }
    llegadas.sort((a, b) => a.segundos - b.segundos);
    return {
      ok: true,
      llegadas: llegadas.slice(0, 8),
      nota: 'Solo aparecen servicios con informacion en vivo (el feed de Renfe no lista todos los trenes programados).'
    };
  } catch (err) {
    return { ok: false, error: `No he podido consultar el feed de Renfe: ${err.message}` };
  }
}

/**
 * Llegadas con informacion en vivo para una estacion de Cercanias
 * (stopId GTFS, ej "17000").
 */
export function llegadasCercanias(stopId, deps = {}) {
  return llegadasFeedRenfe(stopId, URL_FEED, deps);
}

/**
 * Llegadas con informacion en vivo para una estacion de Alta Velocidad,
 * Larga o Media Distancia (feed GTFS-RT LD de Renfe, actualizacion ~30 s).
 */
export function llegadasTrenLD(stopId, deps = {}) {
  return llegadasFeedRenfe(stopId, URL_FEED_LD, deps);
}
