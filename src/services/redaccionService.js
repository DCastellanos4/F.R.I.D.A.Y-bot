/**
 * redaccionService.js - Redaccion de datos sensibles antes de persistir.
 *
 * Fuente unica de la redaccion por regex (OTP y credenciales con formato
 * conocido; NO es un filtro semantico completo). La usan el historial de
 * conversacion y la memoria episodica para que nada sensible toque el disco.
 *
 * Strict Policy: Zero Emojis.
 */

const REGEX_DATOS_SENSIBLES = /(confirmar\s+otp\s+\d{6}|codigo de autorizacion 2fa|\b\d{6}\b(?=.*otp)|contrasena\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/i;

/**
 * Los registros persistentes nunca guardan codigos OTP ni credenciales
 * literales: se redactan antes de tocar el disco.
 */
export function redactarSensibles(texto) {
  if (REGEX_DATOS_SENSIBLES.test(texto)) {
    return texto.replace(REGEX_DATOS_SENSIBLES, '[redactado: dato sensible]');
  }
  return texto;
}
