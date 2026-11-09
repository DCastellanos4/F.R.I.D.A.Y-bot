/**
 * ollamaSlmAdapter.js - Adaptador de salida: LLMProviderPort sobre un SLM
 * local servido por Ollama (RF-02, Nivel 1 del ERS).
 *
 * Pensado para modelos pequenos de clasificacion y extraccion (familia
 * Qwen 2.5 1.5B/3B o Llama 3.2 3B, segun la decision final de recursos).
 * El modelo NO se fija en codigo: llega por DAVIS_SLM_MODEL o por el
 * argumento modelo. Sin modelo configurado la factoria devuelve null y el
 * enrutador especulativo opera siempre en modo nube (fail-safe hacia el
 * comportamiento actual).
 *
 * Convivencia con el pipeline de tickets (qwen2.5vl:7b, bajo demanda con
 * keep_alive=0): este adaptador NUNCA toca el modelo de vision. La
 * residencia del SLM se controla con keepAlive propio; su valor final
 * depende de la medicion de RAM/concurrencia en el VPS.
 *
 * Admision CPU (VPS medido 2026-11-09: 4 vCPU CPU-only, 23.4 GiB RAM, sin
 * swap; qwen2.5:3b ya descargado, 1.9 GB): las inferencias se SERIALIZAN
 * (una en vuelo como maximo) porque Ollama no tiene concurrencia
 * configurada y dos cargas de CPU simultaneas (SLM + vision de tickets)
 * competirian por los mismos 4 vCPU. La integracion puede inyectar un
 * serializador compartido con el pipeline de tickets para una admision
 * global; sin el, este adaptador serializa solo las suyas. La cola de
 * presupuesto TPM de Groq (groqBudget) NO sirve para esto: aquella
 * admite tokens de red, esta admite CPU local.
 *
 * Sin efectos secundarios: no descarga modelos, no instala nada y no
 * cambia configuracion del servidor Ollama. La carga del paquete npm
 * 'ollama' es perezosa para que las pruebas puedan inyectar un cliente
 * falso sin instalar dependencias.
 *
 * Strict Policy: Zero Emojis.
 */
import { afirmarLLMProvider } from '../../../ports/outbound/LLMProviderPort.js';

const TIMEOUT_DEFECTO_MS = 2000;

async function cargarClienteOllama(host) {
  const mod = await import('ollama');
  return new mod.Ollama({ host });
}

function conLimiteDeTiempo(promesa, ms, etiqueta) {
  let temporizador;
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(() => {
      reject(new Error(`${etiqueta} agoto su tiempo (${ms} ms)`));
    }, ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

/**
 * Crea el adaptador del SLM local o null si no hay modelo configurado.
 *
 * @param {Object} [opts]
 * @param {string} [opts.modelo]      Modelo Ollama (def: DAVIS_SLM_MODEL).
 * @param {string} [opts.host]        Endpoint Ollama (def: DAVIS_SLM_HOST o
 *                                    http://127.0.0.1:11434; nunca expuesto).
 * @param {number} [opts.timeoutMs]   Techo de espera por llamada (def:
 *                                    DAVIS_SLM_TIMEOUT_MS o 2000 ms; el
 *                                    objetivo del ERS es < 80 ms por
 *                                    inferencia, el timeout es solo la
 *                                    red de seguridad antes de escalar).
 * @param {string|number} [opts.keepAlive] Residencia del modelo en Ollama
 *                                    (def: DAVIS_SLM_KEEP_ALIVE o '5m';
 *                                    '0' descarga tras cada llamada, -1 lo
 *                                    deja residente: decision pendiente de
 *                                    la medicion de recursos del VPS).
 * @param {Object} [opts.cliente]     Cliente Ollama ya construido (pruebas).
 * @param {Function} [opts.serializador] Admision inyectada: envuelve cada
 *                                    inferencia (fn) => Promise. Sin el, se
 *                                    usa una cola interna de una inferencia
 *                                    en vuelo (ver Admision CPU arriba).
 */
export function crearOllamaSlmAdapter({ modelo, host, timeoutMs, keepAlive, cliente, serializador } = {}) {
  const modeloElegido = modelo || process.env.DAVIS_SLM_MODEL || null;
  if (!modeloElegido) return null;

  const hostElegido = host || process.env.DAVIS_SLM_HOST || 'http://127.0.0.1:11434';
  const limiteMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : (Number.parseInt(process.env.DAVIS_SLM_TIMEOUT_MS || '', 10) || TIMEOUT_DEFECTO_MS);
  const residencia = keepAlive ?? process.env.DAVIS_SLM_KEEP_ALIVE ?? '5m';

  let clienteReal = cliente || null;

  // Cola interna por defecto: una inferencia SLM en vuelo como maximo.
  let colaInterna = Promise.resolve();
  const serializar = typeof serializador === 'function'
    ? serializador
    : (fn) => {
        const ejecucion = colaInterna.then(fn);
        colaInterna = ejecucion.catch(() => {});
        return ejecucion;
      };

  async function obtenerCliente() {
    if (!clienteReal) {
      clienteReal = await cargarClienteOllama(hostElegido);
    }
    return clienteReal;
  }

  async function chatCompletion(peticion) {
    const cli = await obtenerCliente();
    const inicio = Date.now();
    const respuesta = await serializar(() => conLimiteDeTiempo(
      cli.chat({
        model: modeloElegido,
        messages: peticion?.messages || [],
        keep_alive: residencia,
        options: {
          temperature: peticion?.options?.temperature ?? 0,
          num_predict: peticion?.options?.num_predict ?? 256,
          num_ctx: peticion?.options?.num_ctx ?? 4096
        }
      }),
      limiteMs,
      'La inferencia del SLM local'
    ));
    const latenciaMs = Date.now() - inicio;
    return {
      message: {
        role: 'assistant',
        content: respuesta?.message?.content ?? ''
      },
      modelo: modeloElegido,
      proveedor: 'ollama-local',
      latenciaMs,
      uso: {
        entrada: respuesta?.prompt_eval_count ?? null,
        salida: respuesta?.eval_count ?? null
      }
    };
  }

  return afirmarLLMProvider(Object.freeze({
    nombre: `ollama-slm(${modeloElegido})`,
    chatCompletion
  }));
}
