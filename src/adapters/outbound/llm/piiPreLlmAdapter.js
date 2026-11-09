/**
 * Adaptador envolvente LLMProviderPort: anonimizacion PII PRE-LLM (RNF-04).
 *
 * Todo el texto que sale hacia el proveedor cloud pasa por el anonimizador
 * (telefonos, DNI, IBAN, tarjetas, emails); la respuesta del modelo se
 * restaura localmente. El mapa de tokens es POR PETICION (nunca compartido
 * entre peticiones ni tenants) y NUNCA sale hacia la nube.
 *
 * Reglas duras:
 *  - Estructura intacta: roles, nombres, tool_call ids, esquemas y
 *    opciones se conservan; solo se reescribe el CONTENIDO textual.
 *  - Nada se muta in situ: la peticion e historia del llamador no cambian.
 *  - La restauracion solo conoce los tokens de ESTA peticion (valores que
 *    el propio usuario ya aporto): nunca crea datos ni permisos nuevos.
 *    Un token que el modelo invente y no este en el mapa se queda como
 *    esta (validacion por pertenencia al mapa).
 *  - Fail-closed: si el anonimizador falla, la llamada NO sale.
 *  - Streaming NO soportado en este corte: si la peticion pide stream,
 *    se rechaza (mejor cortar que filtrar PII por chunks sin restaurar).
 *  - Reintentos/failover del proveedor quedan DENTRO del adaptador
 *    envuelto: una sola anonimizacion por peticion, contexto preservado.
 *
 * LIMITES DECLARADOS: solo contenido textual de mensajes (string) y
 * arguments de tool_calls (string JSON); contenido binario o partes
 * no textuales no se anonimizan (no existe hoy en este sistema).
 *
 * Strict Policy: Zero Emojis.
 */
import { crearPiiAnonymizer } from '../../../security/piiAnonymizerService.js';
import { afirmarLLMProvider } from '../../../ports/outbound/LLMProviderPort.js';

/**
 * @param {Object} deps
 * @param {Object} deps.inner        LLMProviderPort real (p. ej. llmService historico).
 * @param {Object} [deps.anonimizador]  crearPiiAnonymizer() por defecto.
 * @param {string[]} [deps.permitir]    Identificadores autorizados que NO se
 *        enmascaran (lista blanca acotada; NO es un permiso general).
 */
export function crearAnonimizadorPreLlm({ inner, anonimizador = null, permitir = [] } = {}) {
  afirmarLLMProvider(inner);
  const pii = anonimizador || crearPiiAnonymizer();
  const permitidos = Array.isArray(permitir) ? permitir.map((p) => String(p).trim()).filter(Boolean) : [];

  // El anonimizador numera desde 1 en cada llamada; el canon de la
  // peticion necesita tokens unicos por VALOR. Si el token fresco ya esta
  // asignado a otro valor, se renombra al siguiente libre de su tipo.
  function tokenLibre(token, mapa) {
    if (!(token in mapa)) return token;
    const m = token.match(/^\[PII_(.+)_(\d+)\]$/);
    if (!m) {
      let i = 2;
      while (`${token}#${i}` in mapa) i += 1;
      return `${token}#${i}`;
    }
    let n = Number(m[2]) + 1;
    let candidato = `[PII_${m[1]}_${n}]`;
    while (candidato in mapa) {
      n += 1;
      candidato = `[PII_${m[1]}_${n}]`;
    }
    return candidato;
  }

  function anonimizarTexto(texto, mapa, valorAToken) {
    if (typeof texto !== 'string' || !texto) return texto;
    // Mapa acumulado de la peticion: el mismo valor PII recibe EL MISMO
    // token en todos los mensajes (coherencia para el modelo); dos valores
    // distintos nunca comparten token. El mapa no sale de esta llamada.
    const r = pii.anonimizar(texto, { permitir: permitidos });
    let out = r.texto;
    for (const [token, valor] of Object.entries(r.mapa)) {
      if (valor in valorAToken) {
        out = out.split(token).join(valorAToken[valor]);
      } else {
        const canonico = tokenLibre(token, mapa);
        if (canonico !== token) out = out.split(token).join(canonico);
        valorAToken[valor] = canonico;
        mapa[canonico] = valor;
      }
    }
    return out;
  }

  function anonimizarMensaje(mensaje, mapa, valorAToken) {
    if (!mensaje || typeof mensaje !== 'object') return mensaje;
    const copia = { ...mensaje };
    if (typeof copia.content === 'string') {
      copia.content = anonimizarTexto(copia.content, mapa, valorAToken);
    }
    if (Array.isArray(copia.tool_calls)) {
      copia.tool_calls = copia.tool_calls.map((tc) => {
        if (!tc || typeof tc !== 'object') return tc;
        const copiaTc = { ...tc, function: tc.function ? { ...tc.function } : tc.function };
        if (copiaTc.function && typeof copiaTc.function.arguments === 'string') {
          copiaTc.function.arguments = anonimizarTexto(copiaTc.function.arguments, mapa, valorAToken);
        }
        return copiaTc;
      });
    }
    return copia;
  }

  function restaurarTexto(texto, mapa) {
    if (typeof texto !== 'string' || !texto) return texto;
    return pii.restaurar(texto, mapa);
  }

  return Object.freeze({
    nombre: `${inner.nombre || 'llm'}+pii-prellm`,
    async chatCompletion(peticion) {
      if (peticion && peticion.options && peticion.options.stream === true) {
        throw new Error('PII pre-LLM: streaming no soportado en este corte; llamada bloqueada (fail-closed).');
      }
      // Mapa por peticion: nunca compartido, nunca enviado.
      const mapa = {};
      const valorAToken = {};
      const peticionAnon = {
        ...peticion,
        messages: Array.isArray(peticion?.messages)
          ? peticion.messages.map((m) => anonimizarMensaje(m, mapa, valorAToken))
          : peticion?.messages
      };
      const respuesta = await inner.chatCompletion(peticionAnon);
      if (!respuesta || typeof respuesta !== 'object') return respuesta;
      // Restauracion local: solo tokens del mapa de esta peticion.
      const salida = { ...respuesta, message: respuesta.message ? { ...respuesta.message } : respuesta.message };
      if (salida.message && typeof salida.message.content === 'string') {
        salida.message.content = restaurarTexto(salida.message.content, mapa);
      }
      if (salida.message && Array.isArray(salida.message.tool_calls)) {
        salida.message.tool_calls = salida.message.tool_calls.map((tc) => {
          if (!tc || typeof tc !== 'object') return tc;
          const copiaTc = { ...tc, function: tc.function ? { ...tc.function } : tc.function };
          if (copiaTc.function && typeof copiaTc.function.arguments === 'string') {
            copiaTc.function.arguments = restaurarTexto(copiaTc.function.arguments, mapa);
          }
          return copiaTc;
        });
      }
      return salida;
    }
  });
}
