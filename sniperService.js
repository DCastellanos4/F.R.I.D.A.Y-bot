import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_DATA = path.join(__dirname, 'data');
const ARCHIVO_SNIPER = path.join(CARPETA_DATA, 'tracked_items.json');
const ARCHIVO_LOG_ALERTAS = path.join(CARPETA_DATA, 'proactive_alerts.log');

if (!fs.existsSync(CARPETA_DATA)) {
  fs.mkdirSync(CARPETA_DATA, { recursive: true });
}

function leerItems() {
  try {
    if (!fs.existsSync(ARCHIVO_SNIPER)) return [];
    const raw = fs.readFileSync(ARCHIVO_SNIPER, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function guardarItems(lista) {
  try {
    fs.writeFileSync(ARCHIVO_SNIPER, JSON.stringify(lista, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando items sniper:', err.message);
  }
}

function parsearPrecioTexto(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/[^\d.,]/g, '').trim();
  if (!limpio) return null;

  if (limpio.includes(',') && !limpio.includes('.')) {
    return parseFloat(limpio.replace(',', '.'));
  }
  if (limpio.includes('.') && limpio.includes(',')) {
    return parseFloat(limpio.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(limpio);
}

export async function extraerPrecioYTitulo(url) {
  try {
    const asinMatch = url.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|asin=)([A-Z0-9]{10})/i);

    // Bypass especial para AMAZON: endpoint móvil para evitar filtros anti-datacenter
    if (asinMatch && /amazon\./i.test(url)) {
      const asin = asinMatch[1];
      const mobileUrl = `https://www.amazon.es/gp/aw/d/${asin}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(mobileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);

        let titulo = $('#productTitle, #title').first().text().trim() ||
                     $('meta[property="og:title"]').attr('content') ||
                     $('title').text().split(':')[0].trim() ||
                     'Artículo Amazon';
        titulo = titulo.replace(/\s+/g, ' ').slice(0, 90).trim();

        let precio = null;
        $('.a-price .a-offscreen').each((_, el) => {
          if (!precio) {
            const p = parsearPrecioTexto($(el).text());
            if (p && p > 0) precio = p;
          }
        });

        if (!precio) {
          const whole = $('.a-price-whole').first().text().replace(/[^\d]/g, '');
          const frac = $('.a-price-fraction').first().text().replace(/[^\d]/g, '') || '00';
          if (whole) {
            precio = parseFloat(`${whole}.${frac}`);
          }
        }

        if (!precio) {
          const match = html.match(/(\d+[\.,]\d{2})\s*(?:€|&euro;|EUR)/);
          if (match) {
            precio = parsearPrecioTexto(match[1]);
          }
        }

        if (precio) {
          return {
            ok: true,
            titulo,
            precio: Number(precio.toFixed(2)),
            url: `https://www.amazon.es/dp/${asin}`
          };
        }
      }
    }

    // Para el resto de plataformas (PcComponentes, Wallapop, AliExpress, genéricos)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `Error HTTP ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let titulo = $('meta[property="og:title"]').attr('content') ||
                 $('meta[name="twitter:title"]').attr('content') ||
                 $('#productTitle').text().trim() ||
                 $('h1').first().text().trim() ||
                 $('title').text().trim() ||
                 'Producto';
    titulo = titulo.replace(/\s+/g, ' ').slice(0, 90).trim();

    let precio = parsearPrecioTexto($('meta[property="product:price:amount"]').attr('content')) ||
                 parsearPrecioTexto($('meta[property="og:price:amount"]').attr('content'));

    if (!precio) {
      const match = html.match(/(\d+[\.,]\d{2})\s*(?:€|&euro;|EUR)/);
      if (match) precio = parsearPrecioTexto(match[1]);
    }

    return {
      ok: true,
      titulo,
      precio: precio ? Number(precio.toFixed(2)) : null,
      url
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function vigilarProducto({ url, nombre = null, precioObjetivo }) {
  const precioObj = parseFloat(precioObjetivo);
  if (isNaN(precioObj) || precioObj <= 0) {
    return { ok: false, error: 'Debes indicar un precio objetivo numérico válido en euros.' };
  }

  // Caso especial: actualizar el precio de un producto ya en seguimiento sin necesidad de volver a pasar la URL
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    if (nombre && nombre.trim().length > 2) {
      const lista = leerItems();
      const nLower = nombre.toLowerCase().trim();
      const itemExistente = lista.find(i => i.nombre.toLowerCase().includes(nLower) || nLower.includes(i.nombre.toLowerCase()));

      if (itemExistente) {
        const precioViejo = itemExistente.precioObjetivo;
        itemExistente.precioObjetivo = precioObj;
        itemExistente.alertaDisparada = false;
        guardarItems(lista);
        console.log(`🎯 [Sniper Actualizado] "${itemExistente.nombre}" -> Precio objetivo modificado: ${precioViejo}€ ➔ ${precioObj}€`);
        return {
          ok: true,
          accion: 'actualizado',
          item: itemExistente,
          mensaje: `Precio objetivo actualizado para "${itemExistente.nombre}" de ${precioViejo}€ a ${precioObj}€.`
        };
      }
    }
    return { ok: false, error: 'Debes proporcionar un enlace web válido (URL con http:// o https://) del producto a vigilar.' };
  }

  console.log(`🎯 [Sniper] Analizando producto en ${url}...`);
  const data = await extraerPrecioYTitulo(url);

  const nombreFinal = (nombre && nombre.trim().length > 2) ? nombre.trim() : (data.titulo || 'Artículo sin nombre');
  const precioActual = data.precio || null;

  const id = `snip_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const fechaStr = new Date().toISOString();
  const urlFinal = data.url || url.trim();

  const lista = leerItems();

  // Si la misma URL ya estaba vigilada, actualizarla
  const idxExistente = lista.findIndex(i => i.url === urlFinal);
  if (idxExistente !== -1) {
    lista[idxExistente].precioObjetivo = precioObj;
    if (precioActual) lista[idxExistente].precioActual = precioActual;
    lista[idxExistente].alertaDisparada = false;
    guardarItems(lista);
    return {
      ok: true,
      accion: 'actualizado',
      item: lista[idxExistente],
      mensaje: `Precio objetivo actualizado para "${lista[idxExistente].nombre}" a ${precioObj}€.`
    };
  }

  const nuevo = {
    id,
    nombre: nombreFinal,
    url: urlFinal,
    precioObjetivo: precioObj,
    precioActual: precioActual || precioObj,
    precioInicial: precioActual || precioObj,
    disponible: true,
    ultimaComprobacion: fechaStr,
    alertaDisparada: false,
    activo: true
  };

  lista.push(nuevo);
  guardarItems(lista);

  console.log(`🎯 [Sniper Activado] "${nuevo.nombre}" -> Precio actual: ${nuevo.precioActual}€ | Meta: ${nuevo.precioObjetivo}€`);

  return {
    ok: true,
    item: nuevo
  };
}

export function listarProductosVigilados() {
  const lista = leerItems();
  return lista.filter(i => i.activo);
}

export function cancelarVigilancia(criterio) {
  const lista = leerItems();
  const crit = (criterio || '').toLowerCase().trim();

  if (crit === '*' || crit === 'todos' || crit === 'todas' || crit.includes('todo') || crit.includes('toda')) {
    const total = lista.length;
    guardarItems([]);
    return { ok: true, mensaje: `Se han cancelado todas las vigilancias activas (${total} artículos eliminados del tracker).` };
  }

  const idx = lista.findIndex(i => i.id === crit || i.nombre.toLowerCase().includes(crit));
  if (idx === -1) {
    return { ok: false, error: 'No se encontró ningún artículo vigilado con ese nombre o ID.' };
  }

  const [eliminado] = lista.splice(idx, 1);
  guardarItems(lista);
  return { ok: true, item: eliminado, mensaje: `Vigilancia cancelada para: "${eliminado.nombre}".` };
}

export async function ejecutarRondaSniper(callbackAlerta = null) {
  const lista = leerItems();
  const activos = lista.filter(i => i.activo);
  if (activos.length === 0) return [];

  console.log(`🎯 [Sniper] Comprobando precios de ${activos.length} productos vigilados...`);
  const alertasGeneradas = [];

  for (const item of activos) {
    const data = await extraerPrecioYTitulo(item.url);
    item.ultimaComprobacion = new Date().toISOString();

    if (data.ok && data.precio) {
      item.precioActual = data.precio;

      if (item.precioActual <= item.precioObjetivo && !item.alertaDisparada) {
        item.alertaDisparada = true;
        const ahorro = (item.precioInicial - item.precioActual).toFixed(2);

        const textoAlerta = `🎯 *¡ALERTA TÁCTICA DE FRIDAY (SNIPER)!* 🎯\n\nJefe, el objetivo que teníamos fijado acaba de caer a tu precio deseado:\n\n📦 *${item.nombre}*\n🏷️ *Precio actual:* ${item.precioActual}€ (Meta: ${item.precioObjetivo}€)\n💰 *Ahorro respecto al inicio:* ${ahorro > 0 ? ahorro + '€' : 'En precio objetivo'}\n\n🛒 *Comprar antes de que se agote:* ${item.url}`;

        console.log(`\n========================================\n${textoAlerta}\n========================================\n`);
        alertasGeneradas.push(textoAlerta);

        fs.appendFileSync(ARCHIVO_LOG_ALERTAS, `[${new Date().toISOString()}] SNIPER: ${item.nombre} bajó a ${item.precioActual}€\n`, 'utf-8');

        if (typeof callbackAlerta === 'function') {
          callbackAlerta(textoAlerta).catch(() => {});
        }
      } else if (item.precioActual > item.precioObjetivo) {
        item.alertaDisparada = false;
      }
    }
  }

  guardarItems(lista);
  return alertasGeneradas;
}

let intervaloSniper = null;
let callbackSniperGlobal = null;

export function iniciarSniperWatchdog(callbackAlerta = null) {
  if (callbackAlerta) callbackSniperGlobal = callbackAlerta;
  if (intervaloSniper) return;

  console.log('🎯 [Sniper Watchdog] Vigilancia automática de ofertas y stock iniciada (revisión cada 20 min).');

  intervaloSniper = setInterval(() => {
    ejecutarRondaSniper(callbackSniperGlobal).catch(err => {
      console.error('Error en ronda sniper:', err.message);
    });
  }, 20 * 60 * 1000);

  if (intervaloSniper && typeof intervaloSniper.unref === 'function') {
    intervaloSniper.unref();
  }
}
