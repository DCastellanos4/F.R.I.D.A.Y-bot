/**
 * ticketVisionAdapter.js - Adaptador real de lectura de tickets (nº 24)
 *
 * Crea la funcion analizarTicket que whatsappBot inyecta al pipeline de
 * gastos por foto. Configuracion REAL (documentada en el roadmap):
 *   - DAVIS_TICKET_VISION_MODEL: modelo con vision del proveedor configurado
 *     (por ejemplo "gpt-4o-mini"). Sin esta variable el adaptador NO se crea
 *     y la funcion queda desactivada: el bot lo dice y ofrece la via de texto.
 *   - DAVIS_TICKET_VISION_PROVIDER / DAVIS_TICKET_VISION_BASE_URL: proveedor
 *     opcional para esta lectura (por ejemplo "ollama" para un modelo local).
 *     Sin ellas se usa el proveedor global de config.llm.
 *   - DAVIS_TICKET_VISION_TIMEOUT_MS: techo de espera por foto (180 s por
 *     defecto; la inferencia local por CPU puede ser lenta).
 *
 * Ciclo de vida (pedido por David, 7 nov 2026): el trabajo de vision arranca
 * SOLO cuando llega un ticket y no deja nada residente al terminar: la
 * llamada viaja con keep_alive = 0 para que Ollama descargue el modelo al
 * acabar, tambien si la lectura falla o agota su tiempo (la descarga la
 * hace el propio Ollama al cerrar la peticion; nosotros no dejamos ningun
 * proceso ni worker). Las lecturas se SERIALIZAN (una foto cada vez) para
 * acotar CPU/RAM en el VPS.
 *
 * El parser envia la foto al modelo con un prompt estricto y devuelve solo
 * datos estructurados {importe, comercio, moneda, fecha, camposDudosos};
 * cualquier campo dudoso o ausente se declara y David confirma antes de que
 * se registre nada. El contenido leido nunca se ejecuta: es datos para un
 * borrador.
 *
 * Strict Policy: Zero Emojis.
 */
import { chatCompletion } from '../core/llmService.js';

const PROMPT = `Lee el ticket de la foto y devuelve SOLO un JSON con esta forma exacta:
{"importe": 12.50, "comercio": "Mercadona", "moneda": "EUR", "fecha": "2026-11-05", "camposDudosos": ["moneda"]}
Reglas: importe es el TOTAL en numero (punto decimal); comercio es el nombre del establecimiento; moneda es el codigo ISO de 3 letras; fecha en AAAA-MM-DD. En camposDudosos lista los campos que no leas con claridad (o todos si la foto no es un ticket). Sin texto fuera del JSON.`;

const TIMEOUT_DEFECTO_MS = Number.parseInt(process.env.DAVIS_TICKET_VISION_TIMEOUT_MS || '180000', 10) || 180000;

// Cola interna: una lectura de ticket en vuelo como maximo.
let colaAnalisis = Promise.resolve();

function conLimiteDeTiempo(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(() => {
      reject(new Error(`La lectura del ticket agoto su tiempo (${Math.round(ms / 1000)} s)`));
    }, ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

export function crearAnalizadorTicket({ modelo, provider, baseUrl, timeoutMs, chatCompletion: chatInyectado } = {}) {
  const modeloElegido = modelo || process.env.DAVIS_TICKET_VISION_MODEL || null;
  if (!modeloElegido) return null;
  const llamar = chatInyectado || ((args) => chatCompletion(args));
  const proveedor = provider || process.env.DAVIS_TICKET_VISION_PROVIDER || undefined;
  const url = baseUrl || process.env.DAVIS_TICKET_VISION_BASE_URL || undefined;
  const limiteMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUT_DEFECTO_MS;

  async function analizar(buffer) {
    const b64 = Buffer.from(buffer).toString('base64');
    const respuesta = await llamar({
      model: modeloElegido,
      provider: proveedor,
      baseUrl: url,
      // keep_alive 0: el modelo local se descarga al terminar esta llamada;
      // los proveedores cloud ignoran la opcion.
      options: { keep_alive: 0, num_predict: 300 },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
        ]
      }]
    });
    const texto = respuesta?.message?.content || respuesta?.content || '';
    const m = String(texto).match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      const datos = JSON.parse(m[0]);
      return {
        importe: typeof datos.importe === 'number' ? datos.importe : undefined,
        comercio: typeof datos.comercio === 'string' ? datos.comercio : undefined,
        moneda: typeof datos.moneda === 'string' ? datos.moneda : undefined,
        fecha: typeof datos.fecha === 'string' ? datos.fecha : undefined,
        camposDudosos: Array.isArray(datos.camposDudosos) ? datos.camposDudosos.filter((c) => typeof c === 'string') : []
      };
    } catch {
      return {};
    }
  }

  // Serializa las lecturas y acota cada una en el tiempo; un fallo o un
  // timeout no rompe la cola para la foto siguiente.
  return (buffer) => {
    const tarea = colaAnalisis.then(() => conLimiteDeTiempo(analizar(buffer), limiteMs));
    colaAnalisis = tarea.catch(() => {});
    return tarea;
  };
}
