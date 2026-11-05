/**
 * ticketVisionAdapter.js - Adaptador real de lectura de tickets (nº 24)
 *
 * Crea la funcion analizarTicket que whatsappBot inyecta al pipeline de
 * gastos por foto. Configuracion REAL (documentada en el roadmap):
 *   - DAVIS_TICKET_VISION_MODEL: modelo con vision del proveedor configurado
 *     (por ejemplo "gpt-4o-mini"). Sin esta variable el adaptador NO se crea
 *     y la funcion queda desactivada: el bot lo dice y ofrece la via de texto.
 *   - La clave del proveedor es la ya configurada en config.llm / OPENAI_*.
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

export function crearAnalizadorTicket({ modelo, chatCompletion: chatInyectado } = {}) {
  const modeloElegido = modelo || process.env.DAVIS_TICKET_VISION_MODEL || null;
  const chat = chatInyectado || null;
  if (!modeloElegido) return null;
  return async (buffer) => {
    const b64 = Buffer.from(buffer).toString('base64');
    const llamar = chat || chatCompletion;
    const respuesta = await llamar({
      model: modeloElegido,
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
  };
}
