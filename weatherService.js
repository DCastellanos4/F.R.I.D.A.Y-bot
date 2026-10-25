/**
 * weatherService.js
 * Servicio meteorológico táctico para J.A.R.V.I.S. utilizando Open-Meteo.
 * Geocodificación precisa y reportes rigurosos sin emojis ni relleno.
 */

const MAPA_CODIGOS_CLIMA = {
  0: 'Cielo despejado',
  1: 'Principalmente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna ligera',
  53: 'Llovizna moderada',
  55: 'Llovizna densa',
  61: 'Lluvia débil',
  63: 'Lluvia moderada',
  65: 'Lluvia fuerte',
  71: 'Nevada ligera',
  73: 'Nevada moderada',
  75: 'Nevada intensa',
  80: 'Chubascos ligeros',
  81: 'Chubascos moderados',
  82: 'Chubascos violentos',
  95: 'Tormenta eléctrica',
  96: 'Tormenta con granizo',
  99: 'Tormenta eléctrica severa'
};

function obtenerInfoCodigo(code) {
  return MAPA_CODIGOS_CLIMA[code] || 'Condiciones variables';
}

function normalizarHoraTexto(horaTexto) {
  if (!horaTexto) return null;
  const match = String(horaTexto).match(/(\d{1,2})/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  if (h >= 0 && h <= 23) return h;
  return null;
}

/**
 * Geocodifica un nombre de ubicación a coordenadas geográficas.
 */
export async function geocodificarLugar(nombreLugar) {
  try {
    let lugarLimpio = (nombreLugar || 'Madrid')
      .replace(/^(en|de|el|la|los|las|del|centro|ciudad|pueblo|municipio)\s+/gi, '')
      .replace(/\s+(centro|ciudad)$/gi, '')
      .trim();

    // Normalizaciones fonéticas comunes por notas de voz
    if (/^madr[ei]s?$/i.test(lugarLimpio)) {
      lugarLimpio = 'Madrid';
    }

    const candidatos = [lugarLimpio];

    if (lugarLimpio.includes(',')) {
      const partes = lugarLimpio.split(',');
      candidatos.push(partes[0].trim());
      candidatos.push(partes[1].trim());
    }

    const norm = lugarLimpio.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (norm !== lugarLimpio) candidatos.push(norm);

    for (const intento of candidatos) {
      if (!intento || intento.length < 2) continue;
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(intento)}&count=1&language=es&format=json`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          return data.results[0];
        }
      }
    }

    return null;
  } catch (err) {
    console.error('Error geocodificando lugar:', err.message);
    return null;
  }
}

/**
 * Consulta el clima actual y previsión (diaria y por horas) para cualquier ubicación.
 */
export async function consultarClima({ ubicacion = 'Madrid', momento = 'hoy', hora = null }) {
  try {
    const geo = await geocodificarLugar(ubicacion);
    if (!geo) {
      return {
        ok: false,
        error: `No he podido localizar las coordenadas geográficas de "${ubicacion}", señor. Le ruego confirme el nombre de la localidad.`
      };
    }

    const { latitude, longitude, name, admin1, country } = geo;
    const lugarCompleto = admin1 ? `${name} (${admin1}, ${country})` : `${name} (${country})`;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto`;
    const res = await fetch(weatherUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      return { ok: false, error: `Error de enlace con los satélites meteorológicos (HTTP ${res.status}).` };
    }

    const data = await res.json();
    const cur = data.current;
    const daily = data.daily;
    const hourly = data.hourly;

    const momentoNorm = (momento || 'hoy').toLowerCase();
    const horaNum = normalizarHoraTexto(hora);

    // Previsión para MAÑANA
    if (momentoNorm.includes('mañana') || momentoNorm.includes('manana')) {
      const idx = 1;
      const estadoCielo = obtenerInfoCodigo(daily.weather_code[idx]);
      const maxT = Math.round(daily.temperature_2m_max[idx]);
      const minT = Math.round(daily.temperature_2m_min[idx]);
      const probLluvia = daily.precipitation_probability_max ? daily.precipitation_probability_max[idx] : 0;
      const fechaManana = daily.time[idx];

      let detalleHora = '';
      if (horaNum !== null && hourly && hourly.time) {
        const horaStr = `${String(horaNum).padStart(2, '0')}:00`;
        const timestampBusqueda = `${fechaManana}T${horaStr}`;
        const idxHora = hourly.time.indexOf(timestampBusqueda);

        if (idxHora !== -1) {
          const tempHora = Math.round(hourly.temperature_2m[idxHora] * 10) / 10;
          const probHora = hourly.precipitation_probability[idxHora] ?? probLluvia;
          const estadoHora = obtenerInfoCodigo(hourly.weather_code[idxHora]);

          detalleHora = `\n- Previsión puntual para las ${horaStr} horas: ${tempHora}°C, ${estadoHora} con un ${probHora}% de probabilidad de lluvia.`;
        }
      }

      const evaluacionLluvia = probLluvia >= 40
        ? 'Le sugiero llevar paraguas, señor.'
        : 'Condiciones secas y estables, señor.';

      const evaluacionFrio = (horaNum !== null && horaNum <= 9)
        ? 'A primera hora el ambiente será fresco; le recomiendo abrigo adecuado.'
        : '';

      const evaluacion = [evaluacionLluvia, evaluacionFrio].filter(Boolean).join(' ');

      const resumen = `Previsión meteorológica para mañana (${fechaManana}) en ${lugarCompleto}:
- Estado general del día: ${estadoCielo}
- Rango de temperatura: ${minT}°C de mínima y ${maxT}°C de máxima.
- Probabilidad de precipitación máxima: ${probLluvia}%.${detalleHora}
- Evaluación: ${evaluacion}`;

      return {
        ok: true,
        lugar: lugarCompleto,
        momento: 'mañana',
        hora: horaNum,
        minT,
        maxT,
        probLluvia,
        resumen
      };
    }

    // Previsión para HOY
    const estadoActual = obtenerInfoCodigo(cur.weather_code);
    const tempActual = Math.round(cur.temperature_2m * 10) / 10;
    const sensacion = Math.round(cur.apparent_temperature * 10) / 10;
    const maxHoy = Math.round(daily.temperature_2m_max[0]);
    const minHoy = Math.round(daily.temperature_2m_min[0]);
    const probLluviaHoy = daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : 0;
    const viento = Math.round(cur.wind_speed_10m);
    const humedad = cur.relative_humidity_2m;

    let detalleHoraHoy = '';
    if (horaNum !== null && hourly && hourly.time) {
      const fechaHoy = daily.time[0];
      const horaStr = `${String(horaNum).padStart(2, '0')}:00`;
      const idxHora = hourly.time.indexOf(`${fechaHoy}T${horaStr}`);
      if (idxHora !== -1) {
        const tempHora = Math.round(hourly.temperature_2m[idxHora] * 10) / 10;
        const probHora = hourly.precipitation_probability[idxHora] ?? probLluviaHoy;
        const estadoHora = obtenerInfoCodigo(hourly.weather_code[idxHora]);
        detalleHoraHoy = `\n- Previsión puntual para las ${horaStr} horas: ${tempHora}°C, ${estadoHora} con un ${probHora}% de probabilidad de lluvia.`;
      }
    }

    const evaluacionHoy = probLluviaHoy >= 50
      ? 'Probabilidad significativa de lluvia en la jornada, señor.'
      : 'Condiciones despejadas y estables, señor.';

    const resumen = `Informe meteorológico para ${lugarCompleto}:
- Estado del cielo: ${estadoActual}
- Temperatura actual: ${tempActual}°C (sensación térmica: ${sensacion}°C).
- Rango de hoy: ${minHoy}°C de mínima y ${maxHoy}°C de máxima.
- Probabilidad de precipitación: ${probLluviaHoy}%.${detalleHoraHoy}
- Viento: ${viento} km/h | Humedad: ${humedad}%.
- Evaluación: ${evaluacionHoy}`;

    return {
      ok: true,
      lugar: lugarCompleto,
      momento: 'hoy',
      tempActual,
      maxHoy,
      minHoy,
      probLluvia: probLluviaHoy,
      estadoTexto: estadoActual,
      resumen
    };
  } catch (err) {
    console.error('Error en consultarClima:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Reporte compacto para el Briefing Diario
 */
export async function obtenerReporteClimaMatutino(ubicacion = 'Madrid') {
  try {
    const data = await consultarClima({ ubicacion, momento: 'hoy' });
    if (!data.ok) return `METEOROLOGÍA: No disponible temporalmente.`;

    let texto = `METEOROLOGÍA (${data.lugar.split('(')[0].trim()}):\n`;
    texto += `• Condiciones: ${data.estadoTexto}\n`;
    texto += `• Temperatura: ${data.minHoy}°C - ${data.maxHoy}°C (Actual: ${data.tempActual}°C)\n`;
    texto += `• Probabilidad de lluvia: ${data.probLluvia}%\n`;
    if (data.probLluvia >= 40) {
      texto += `• Sugerencia: Le aconsejo llevar paraguas, señor.`;
    }
    return texto;
  } catch (err) {
    return `METEOROLOGÍA: Error al contactar satélites.`;
  }
}
