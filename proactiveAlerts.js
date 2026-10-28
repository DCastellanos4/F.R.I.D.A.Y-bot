import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';

const CARPETA_DATA = path.resolve('data');
const ARCHIVO_ESTADO = path.join(CARPETA_DATA, 'watchdog_state.json');
const ARCHIVO_LOG_ALERTAS = path.join(CARPETA_DATA, 'proactive_alerts.log');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

const ESTADO_DEFAULT = {
  minecraft: {
    nombre: 'Servidor de Minecraft',
    host: '192.168.1.24',
    port: 25565,
    activo: true,
    estadoActual: 'DESCONOCIDO',
    ultimoCambio: null
  },
  clima: {
    lat: 40.4168,
    lon: -3.7038,
    ciudad: 'Madrid',
    ultimoAvisoFecha: null
  },
  sistema: {
    umbralRamMinimaGB: 1.5,
    ultimoAvisoRam: null
  }
};

function leerEstado() {
  try {
    if (!fs.existsSync(ARCHIVO_ESTADO)) {
      fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify(ESTADO_DEFAULT, null, 2), 'utf-8');
      return ESTADO_DEFAULT;
    }
    const raw = fs.readFileSync(ARCHIVO_ESTADO, 'utf-8');
    return { ...ESTADO_DEFAULT, ...JSON.parse(raw) };
  } catch {
    return ESTADO_DEFAULT;
  }
}

function guardarEstado(estado) {
  try {
    fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify(estado, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando estado vigilante:', err.message);
  }
}

function registrarAlertaEnLog(texto) {
  const entrada = `[${new Date().toISOString()}] ${texto.replace(/\n/g, ' ')}\n`;
  fs.appendFileSync(ARCHIVO_LOG_ALERTAS, entrada, 'utf-8');
}

/**
 * Comprueba si un puerto TCP responde
 */
export function comprobarPuertoTCP(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responded = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      responded = true;
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Consulta la previsión de lluvia del día en Open-Meteo
 */
export async function consultarAlertaLluvia(lat = 40.4168, lon = -3.7038) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.daily || !data.daily.precipitation_probability_max) return null;

    const probLluvia = data.daily.precipitation_probability_max[0] || 0;
    const tempMax = data.daily.temperature_2m_max[0];
    const tempMin = data.daily.temperature_2m_min[0];

    return {
      hayRiesgoLluvia: probLluvia >= 50,
      probabilidad: probLluvia,
      tempMax,
      tempMin
    };
  } catch (err) {
    console.error('Error consultando Open-Meteo:', err.message);
    return null;
  }
}

/**
 * Consulta el estado de salud del servidor Oracle
 */
export function consultarSaludServidor() {
  const totalRamGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
  const libreRamGB = (os.freemem() / (1024 ** 3)).toFixed(1);
  const porcentajeUso = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(0);
  const cpus = os.cpus().length;
  const loadAvg = os.loadavg()[0].toFixed(2);

  return {
    totalRamGB,
    libreRamGB,
    porcentajeUso,
    cpus,
    loadAvg,
    critico: parseFloat(libreRamGB) < 1.0
  };
}

/**
 * Bucle del vigilante proactivo (revisa servicios y condiciones automáticamente)
 */
let intervaloVigilante = null;
let callbackAlertaGlobal = null;

export function iniciarVigilanteProactivo(callbackAlerta = null) {
  if (callbackAlerta) callbackAlertaGlobal = callbackAlerta;
  if (intervaloVigilante) return;

  console.log('[Vigilante] [Modo Vigilante] Monitor proactivo iniciado (Minecraft, servidor y alertas climáticas).');

  const ejecutarRevisiones = async () => {
    const estado = leerEstado();
    const ahoraStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const hoyFechaStr = new Date().toISOString().slice(0, 10);

    // 1. REVISIÓN DEL SERVIDOR DE MINECRAFT
    if (estado.minecraft && estado.minecraft.activo) {
      const estaOnline = await comprobarPuertoTCP(estado.minecraft.host, estado.minecraft.port, 3000);
      const nuevoEstado = estaOnline ? 'ONLINE' : 'CAIDO';

      if (estado.minecraft.estadoActual !== 'DESCONOCIDO' && estado.minecraft.estadoActual !== nuevoEstado) {
        let mensajeAlerta = '';

        if (nuevoEstado === 'CAIDO') {
          mensajeAlerta = `[Aviso] *ALERTA VIGILANTE DE F.R.I.D.A.Y.* [Aviso]\n\nJefe, el *${estado.minecraft.nombre}* (${estado.minecraft.host}:${estado.minecraft.port}) ha dejado de responder a las ${ahoraStr}.\n\n¿Quieres que intente reiniciarlo?`;
        } else {
          mensajeAlerta = `[OK] *F.R.I.D.A.Y. INFORMA: SERVICIO RECUPERADO*\n\nEl *${estado.minecraft.nombre}* (${estado.minecraft.host}:${estado.minecraft.port}) vuelve a estar 100% operativo a las ${ahoraStr}.`;
        }

        console.log(`\n========================================`);
        console.log(`[Alerta] [ALERTA PROACTIVA DISPARADA]`);
        console.log(mensajeAlerta);
        console.log(`========================================\n`);

        registrarAlertaEnLog(mensajeAlerta);

        if (typeof callbackAlertaGlobal === 'function') {
          callbackAlertaGlobal(mensajeAlerta).catch(e => console.error('Error enviando alerta proactiva:', e.message));
        }
      }

      estado.minecraft.estadoActual = nuevoEstado;
      estado.minecraft.ultimoCambio = new Date().toISOString();
    }

    // 2. REVISIÓN METEOROLÓGICA MATUTINA (Solo 1 vez al día entre las 07:00 y las 09:00)
    const horaActual = new Date().getHours();
    if (horaActual >= 7 && horaActual <= 9 && estado.clima.ultimoAvisoFecha !== hoyFechaStr) {
      const datosClima = await consultarAlertaLluvia(estado.clima.lat, estado.clima.lon);
      if (datosClima && datosClima.hayRiesgoLluvia) {
        const alertaLluvia = `[Lluvia] *ALERTA METEOROLÓGICA DE F.R.I.D.A.Y.* [Lluvia]\n\nBuenos días David. Se prevé un *${datosClima.probabilidad}% de probabilidad de lluvia* hoy en ${estado.clima.ciudad} (Temp: ${datosClima.tempMin}°C - ${datosClima.tempMax}°C).\n\nTe sugiero coger paraguas antes de despegar.`;
        console.log(`\n========================================\n${alertaLluvia}\n========================================\n`);
        registrarAlertaEnLog(alertaLluvia);

        if (typeof callbackAlertaGlobal === 'function') {
          callbackAlertaGlobal(alertaLluvia).catch(e => console.error('Error enviando alerta de lluvia:', e.message));
        }
      }
      estado.clima.ultimoAvisoFecha = hoyFechaStr;
    }

    // 3. REVISIÓN DE SALUD DEL SERVIDOR ORACLE
    const salud = consultarSaludServidor();
    if (salud.critico) {
      const alertaRam = `[Aviso] *ALERTA DE SISTEMA*: Memoria RAM del servidor Oracle en nivel crítico (Quedan solo ${salud.libreRamGB} GB libres de ${salud.totalRamGB} GB).`;
      console.warn(alertaRam);
      registrarAlertaEnLog(alertaRam);
      if (typeof callbackAlertaGlobal === 'function') {
        callbackAlertaGlobal(alertaRam).catch(() => {});
      }
    }

    guardarEstado(estado);
  };

  setTimeout(ejecutarRevisiones, 2000);
  intervaloVigilante = setInterval(ejecutarRevisiones, 60000);
  if (intervaloVigilante && typeof intervaloVigilante.unref === 'function') {
    intervaloVigilante.unref();
  }
}
