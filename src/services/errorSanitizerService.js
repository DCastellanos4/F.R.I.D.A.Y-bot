/**
 * errorSanitizerService.js - Convierte errores internos en mensajes honestos
 * y seguros para David. El texto crudo del proveedor (organizacion, cuotas,
 * claves, cuerpos HTTP) nunca sale por WhatsApp; queda en los logs, que son
 * el canal de diagnostico. Unico dato reutilizado: el tiempo de reintento
 * cuando el proveedor lo devuelve de verdad.
 *
 * Fallo observado en produccion (7 nov 2026): un 429 de Groq llegaba a
 * WhatsApp con organization id y detalle de cuota en el cuerpo del mensaje.
 *
 * Strict Policy: Zero Emojis.
 */

// Extrae el tiempo de reintento REAL del proveedor ("Please try again in
// 4m30.5s", "try again in 20s"). Nada mas del texto del error sale hacia el
// usuario.
export function extraerEsperaReintento(textoError) {
  const m = String(textoError || '').match(/try again in\s+((?:\d+h)?(?:\d+m)?(?:\d+(?:[.,]\d+)?s)?)/i);
  if (!m || !m[1]) return null;
  const partes = m[1].match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:[.,]\d+)?)s)?$/);
  if (!partes || (!partes[1] && !partes[2] && !partes[3])) return null;
  const trozos = [];
  if (partes[1]) trozos.push(`${partes[1]} hora${partes[1] === '1' ? '' : 's'}`);
  if (partes[2]) trozos.push(`${partes[2]} minuto${partes[2] === '1' ? '' : 's'}`);
  if (partes[3]) trozos.push(`${Math.ceil(Number.parseFloat(partes[3].replace(',', '.')))} segundos`);
  return trozos.length > 0 ? trozos.join(' ') : null;
}

export function esErrorDeLimite(textoError) {
  return /\b429\b|rate limit|tokens per (day|minute)|requests per (day|minute)|\bquota\b/i.test(String(textoError || ''));
}

/**
 * Mensaje seguro para el usuario: nunca incluye el texto crudo del error,
 * solo un resumen honesto y, cuando el proveedor lo devuelve, el tiempo de
 * reintento. Los logs conservan el error completo para diagnostico.
 */
export function mensajeErrorParaUsuario(err, { contexto = 'solicitud', numero } = {}) {
  const crudo = String(err?.message || err || '');
  if (err?.name === 'PresupuestoTemporalError') {
    return 'La siguiente llamada no cabe ahora en el presupuesto preventivo de tokens y no se ha enviado. Divide la consulta o intentalo de nuevo en unos minutos.';
  }
  if (err?.name === 'CuotaAgotadaError') {
    // Sin afirmaciones sobre acciones: desde aqui no se sabe si algo se
    // ejecuto; el agente informa del resultado parcial por su propio camino.
    return 'Señor, tanto el modelo principal como el de respaldo han llegado a su limite temporal o no estan disponibles. Intentelo de nuevo en unos minutos.';
  }
  if (esErrorDeLimite(crudo)) {
    const espera = extraerEsperaReintento(crudo);
    return espera
      ? `Señor, el servicio de inteligencia ha llegado a su limite temporal. Puede reintentar en aproximadamente ${espera}.`
      : 'Señor, el servicio de inteligencia ha llegado a su limite temporal; intentelo de nuevo en unos minutos.';
  }
  if (contexto === 'audio') {
    return 'Ha ocurrido una anomalía al procesar su nota de voz, señor; el detalle tecnico queda en el registro. ¿Puede repetirmela?';
  }
  if (contexto === 'despacho') {
    const destino = numero ? ` al numero +${String(numero).replace(/[^\d]/g, '')}` : '';
    return `No se pudo entregar el mensaje${destino}; el detalle tecnico queda en el registro y el mensaje sigue pendiente.`;
  }
  return 'Señor, se ha producido una anomalía al procesar su solicitud; el detalle tecnico queda en el registro.';
}
