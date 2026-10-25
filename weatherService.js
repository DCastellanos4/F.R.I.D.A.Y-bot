/**
 * weatherService.js
 * Servicio meteorológico táctico para FRIDAY utilizando la API pública de Open-Meteo.
 * Permite geocodificar cualquier ciudad del mundo y obtener condiciones actuales y previsiones.
 */

const MAPA_CODIGOS_CLIMA = {
  0: { desc: 'Cielo completamente despejado', icono: '☀️' },
  1: { desc: 'Principalmente despejado', icono: '🌤️' },
  2: { desc: 'Parcialmente nublado', icono: '⛅' },
  3: { desc: 'Nublado', icono: '☁️' },
  45: { desc: 'Niebla en la zona', icono: '🌫️' },
  48: { desc: 'Niebla con escarcha', icono: '🌫️' },
  51: { desc: 'Llovizna ligera', icono: '🌦️' },
  53: { desc: 'Llovizna moderada', icono: '🌦️' },
  55: { desc: 'Llovizna densa', icono: '🌧️' },
  61: { desc: 'Lluvia débil', icono: '🌦️' },
  63: { desc: 'Lluvia moderada', icono: '🌧️' },
  65: { desc: 'Lluvia fuerte', icono: '🌧️' },
  71: { desc: 'Nevada ligera', icono: '🌨️' },
  73: { desc: 'Nevada moderada', icono: '🌨️' },
  75: { desc: 'Nevada intensa', icono: '❄️' },
  80: { desc: 'Chubascos ligeros', icono: '🌦️' },
  81: { desc: 'Chubascos moderados', icono: '🌧️' },
  82: { desc: 'Chubascos violentos', icono: '⛈️' },
  95: { desc: 'Tormenta eléctrica', icono: '⛈️' },
  96: { desc: 'Tormenta con granizo', icono: '⛈️' },
  99: { desc: 'Tormenta eléctrica severa', icono: '⛈️' }
};

function obtenerInfoCodigo(code) {
  return MAPA_CODIGOS_CLIMA[code] || { desc: 'Condiciones variables', icono: '⛅' };
}

/**
 * Geocodifica un nombre de ubicación a coordenadas (latitud, longitud y nombre formateado)
 * Maneja búsqueda en cascada para ciudades con comas o regiones (ej: "maratxi, mallorca" -> busca "maratxi", luego "mallorca")
 */
export async function geocodificarLugar(nombreLugar) {
  try {
    let lugarLimpio = (nombreLugar || 'Madrid')
      .replace(/^(en|de|el|la|los|las|centro|ciudad|pueblo|municipio)\s+/gi, '')
      .replace(/\s+(centro|ciudad)$/gi, '')
      .trim();

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
 * Consulta el clima actual y previsión para cualquier ubicación del mundo
 */
export async function consultarClima({ ubicacion = 'Madrid', momento = 'hoy' }) {
  try {
    const geo = await geocodificarLugar(ubicacion);
    if (!geo) {
      return {
        ok: false,
        error: `No he podido localizar las coordenadas de "${ubicacion}". Verifica el nombre de la ciudad o región.`
      };
    }

    const { latitude, longitude, name, admin1, country } = geo;
    const lugarCompleto = admin1 ? `${name} (${admin1}, ${country})` : `${name} (${country})`;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto`;
    const res = await fetch(weatherUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      return { ok: false, error: `Error conectando a los satélites meteorológicos (HTTP ${res.status}).` };
    }

    const data = await res.json();
    const cur = data.current;
    const daily = data.daily;

    const momentoNorm = (momento || 'hoy').toLowerCase();

    // Caso: Previsión para MAÑANA
    if (momentoNorm.includes('mañana') || momentoNorm.includes('manana')) {
      const idx = 1; // índice 1 es mañana
      const weatherInfo = obtenerInfoCodigo(daily.weather_code[idx]);
      const maxT = Math.round(daily.temperature_2m_max[idx]);
      const minT = Math.round(daily.temperature_2m_min[idx]);
      const probLluvia = daily.precipitation_probability_max ? daily.precipitation_probability_max[idx] : 0;
      const fechaManana = daily.time[idx];

      const resumen = `Previsión meteorológica de FRIDAY para mañana (${fechaManana}) en ${lugarCompleto}:
- Estado: ${weatherInfo.desc} ${weatherInfo.icono}
- Temperatura: ${minT}°C de mínima y ${maxT}°C de máxima.
- Probabilidad de lluvia: ${probLluvia}%.
- Recomendación: ${probLluvia >= 40 ? 'Te sugiero coger paraguas.' : 'No se esperan precipitaciones destacables.'}`;

      return {
        ok: true,
        lugar: lugarCompleto,
        momento: 'mañana',
        resumen
      };
    }

    // Caso: Previsión general de HOY
    const weatherInfoActual = obtenerInfoCodigo(cur.weather_code);
    const tempActual = Math.round(cur.temperature_2m * 10) / 10;
    const sensacion = Math.round(cur.apparent_temperature * 10) / 10;
    const maxHoy = Math.round(daily.temperature_2m_max[0]);
    const minHoy = Math.round(daily.temperature_2m_min[0]);
    const probLluviaHoy = daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : 0;
    const viento = Math.round(cur.wind_speed_10m);
    const humedad = cur.relative_humidity_2m;

    const resumen = `Informe meteorológico de FRIDAY para ${lugarCompleto}:
- Estado: ${weatherInfoActual.desc} ${weatherInfoActual.icono}
- Temperatura actual: ${tempActual}°C (Sensación térmica: ${sensacion}°C).
- Rango de hoy: Mínima de ${minHoy}°C y Máxima de ${maxHoy}°C.
- Probabilidad de lluvia: ${probLluviaHoy}%.
- Viento: ${viento} km/h | Humedad: ${humedad}%.
- Nota: ${probLluviaHoy >= 50 ? 'Alta probabilidad de precipitaciones hoy.' : 'Condiciones despejadas y estables.'}`;

    return {
      ok: true,
      lugar: lugarCompleto,
      momento: 'hoy',
      tempActual,
      maxHoy,
      minHoy,
      probLluvia: probLluviaHoy,
      estadoTexto: weatherInfoActual.desc,
      icono: weatherInfoActual.icono,
      resumen
    };
  } catch (err) {
    console.error('Error en consultarClima:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Genera el resumen compacto del clima matutino para insertar en el Briefing Diario
 */
export async function obtenerReporteClimaMatutino(ubicacion = 'Madrid') {
  try {
    const data = await consultarClima({ ubicacion, momento: 'hoy' });
    if (!data.ok) return `🌦️ *METEOROLOGÍA:* No disponible temporalmente.`;

    let texto = `🌦️ *RADAR METEOROLÓGICO MATUTINO (${data.lugar.split('(')[0].trim()}):*\n`;
    texto += `• Condiciones: ${data.estadoTexto} ${data.icono}\n`;
    texto += `• Temperatura: ${data.minHoy}°C - ${data.maxHoy}°C (Actual: ${data.tempActual}°C)\n`;
    texto += `• Probabilidad de lluvia: ${data.probLluvia}%`;
    if (data.probLluvia >= 40) {
      texto += ` ⚠️ _(Coge paraguas hoy, jefe)_`;
    }
    return texto;
  } catch (err) {
    return `🌦️ *METEOROLOGÍA:* Error recuperando satélites.`;
  }
}
