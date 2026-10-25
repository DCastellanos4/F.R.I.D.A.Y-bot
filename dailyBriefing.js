import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extraerResumenTodasLasRamas } from './newsService.js';
import { obtenerReporteClimaMatutino } from './weatherService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_BRIEFINGS = path.join(__dirname, 'briefings');

if (!fs.existsSync(CARPETA_BRIEFINGS)) {
  fs.mkdirSync(CARPETA_BRIEFINGS, { recursive: true });
}

/**
 * Genera el reporte matutino con meteorología y 5 noticias clave por sector
 */
export async function generarBriefingCompleto(ciudadClima = 'Madrid') {
  const fecha = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  console.log(`☀️ Generando Briefing Matutino táctico (${fecha})...`);

  let reporte = `☀️ *BRIEFING MATUTINO DE F.R.I.D.A.Y.* ☀️\n`;
  reporte += `📅 ${fecha.charAt(0).toUpperCase() + fecha.slice(1)}\n\n`;

  // 1. Sección de Meteorología Matutina
  try {
    const climaInfo = await obtenerReporteClimaMatutino(ciudadClima);
    reporte += `${climaInfo}\n\n`;
  } catch (err) {
    console.error('Error recuperando clima para el briefing:', err.message);
  }

  reporte += `Buenos días, jefe. Sistemas online. Aquí tienes la selección táctica de noticias en tu radar:\n\n`;

  // 2. Sección de Noticias por Ramas
  const ramas = await extraerResumenTodasLasRamas(5);

  for (const [clave, data] of Object.entries(ramas)) {
    reporte += `═════════════════════\n`;
    reporte += `${data.tituloRama}\n`;
    reporte += `═════════════════════\n`;

    if (!data.items || data.items.length === 0) {
      reporte += `_No se pudieron recuperar noticias en esta sección hoy._\n\n`;
      continue;
    }

    data.items.forEach((item, index) => {
      reporte += `*${index + 1}.* ${item.titulo}\n`;
      if (item.link) {
        reporte += `   🔗 ${item.link}\n`;
      }
      reporte += `\n`;
    });
  }

  reporte += `═════════════════════\n`;
  reporte += `🤖 _Informe procesado tácticamente por FRIDAY en tu servidor._`;

  // Guardar archivo del briefing diario
  const hoyStr = new Date().toISOString().slice(0, 10);
  const rutaArchivo = path.join(CARPETA_BRIEFINGS, `briefing-${hoyStr}.txt`);
  fs.writeFileSync(rutaArchivo, reporte, 'utf-8');
  console.log(`📁 Briefing guardado en: ${rutaArchivo}`);

  return reporte;
}

/**
 * Función exportable para programar el envío automático a WhatsApp a las 07:00 AM
 */
export function programarEnvioMatutino(enviarMensajeWhatsApp = null) {
  console.log('⏰ Programador de briefing activado: Se ejecutará todos los días a las 07:00 AM (Europe/Madrid).');

  cron.schedule('0 7 * * *', async () => {
    console.log('⏰ [07:00 AM] Ejecutando generación de briefing matutino...');
    const textoBriefing = await generarBriefingCompleto();

    if (typeof enviarMensajeWhatsApp === 'function') {
      try {
        await enviarMensajeWhatsApp(textoBriefing);
        console.log('📤 Briefing enviado a WhatsApp correctamente.');
      } catch (err) {
        console.error('❌ Error enviando briefing a WhatsApp:', err.message);
      }
    } else {
      console.log('⚠️ WhatsApp no conectado aún. Briefing almacenado en disco.');
    }
  }, {
    timezone: 'Europe/Madrid'
  });
}

// Si se ejecuta directamente desde la terminal
if (process.argv[1] && process.argv[1].endsWith('dailyBriefing.js')) {
  if (process.argv.includes('--now')) {
    generarBriefingCompleto().then(reporte => {
      console.log('\n========================================');
      console.log(reporte);
      console.log('========================================\n');
    });
  } else {
    programarEnvioMatutino();
    console.log('Presiona Ctrl+C para detener el servicio.');
  }
}
