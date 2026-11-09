/**
 * Adaptador EmbeddingProviderPort: embeddings densos via Ollama local (RF-03).
 *
 * Usa el endpoint /api/embed del Ollama que YA corre en el VPS
 * (localhost, restringido el 7 nov 2026). Sin coste por token y sin
 * enviar memorias a terceros: el canal denso no puede usar un proveedor
 * cloud nuevo por comodidad.
 *
 * Modelo objetivo del ERS: bge-m3 (1024d, multilingue, encaja con el
 * espanol del corpus) o nomic-embed-text (768d, alternativa mas ligera).
 * NINGUNO esta descargado aun: el pull entra en la ventana de
 * infraestructura autorizada. Hasta entonces este adaptador NO ha
 * generado un solo embedding real.
 *
 * Configuracion:
 *  - DAVIS_EMBEDDING_MODEL (defecto 'bge-m3')
 *  - OLLAMA_HOST (defecto http://127.0.0.1:11434, mismo convenio que config)
 *  - DAVIS_EMBEDDING_DIMS: dimensionalidad esperada; si se fija, el
 *    adaptador valida cada lote contra ella y falla en claro ante un
 *    modelo equivocado (mezclar dimensionalidades corrompe el indice).
 *
 * Strict Policy: Zero Emojis.
 */

import { afirmarEmbeddingProvider } from '../../../ports/outbound/EmbeddingProviderPort.js';

const MODELO_DEFECTO = 'bge-m3';
const HOST_DEFECTO = 'http://127.0.0.1:11434';

// Dimensionalidades conocidas de los modelos objetivo del ERS. Solo se
// usan como defensa cuando DAVIS_EMBEDDING_DIMS no esta fijada; la fuente
// de verdad en produccion es la variable de entorno.
const DIMS_CONOCIDAS = {
  'bge-m3': 1024,
  'nomic-embed-text': 768,
  'nomic-embed-text-v1.5': 768
};

/**
 * @param {object} [opciones]
 * @param {string} [opciones.modelo]  Modelo Ollama (defecto DAVIS_EMBEDDING_MODEL o bge-m3).
 * @param {string} [opciones.host]  Host Ollama (defecto OLLAMA_HOST o 127.0.0.1:11434).
 * @param {number} [opciones.dimensiones]  Dimensionalidad esperada.
 * @param {object} [opciones.cliente]  Cliente inyectado (pruebas): { embed({model, input}) }.
 */
export function crearOllamaEmbeddingAdapter(opciones = {}) {
  const modelo = opciones.modelo || process.env.DAVIS_EMBEDDING_MODEL || MODELO_DEFECTO;
  const host = opciones.host || process.env.OLLAMA_HOST || HOST_DEFECTO;
  const dimsConfig = Number.parseInt(process.env.DAVIS_EMBEDDING_DIMS || '', 10);
  const dimensiones = Number.isInteger(opciones.dimensiones) && opciones.dimensiones > 0
    ? opciones.dimensiones
    : (Number.isInteger(dimsConfig) && dimsConfig > 0 ? dimsConfig : (DIMS_CONOCIDAS[modelo] || 0));

  let cliente = opciones.cliente || null;
  async function resolverCliente() {
    if (cliente) return cliente;
    // Importacion perezosa: ni el modulo ni la conexion se tocan hasta la
    // primera llamada real, y los tests nunca pasan por aqui.
    const { Ollama } = await import('ollama');
    cliente = new Ollama({ host });
    return cliente;
  }

  async function embeber(textos) {
    const lista = Array.isArray(textos) ? textos : [];
    if (lista.length === 0) return [];
    const cli = await resolverCliente();
    const respuesta = await cli.embed({ model: modelo, input: lista });
    const vectores = respuesta && Array.isArray(respuesta.embeddings) ? respuesta.embeddings : null;
    if (!vectores || vectores.length !== lista.length) {
      throw new Error(`OllamaEmbedding: respuesta sin ${lista.length} embeddings (modelo ${modelo}).`);
    }
    if (dimensiones > 0) {
      for (const vector of vectores) {
        if (!Array.isArray(vector) || vector.length !== dimensiones) {
          throw new Error(`OllamaEmbedding: el modelo ${modelo} devolvio un vector de ${Array.isArray(vector) ? vector.length : '?'} dimensiones; se esperaban ${dimensiones}. Revisa DAVIS_EMBEDDING_MODEL/DAVIS_EMBEDDING_DIMS: el indice no admite mezcla de dimensionalidades.`);
        }
      }
    }
    return vectores;
  }

  return afirmarEmbeddingProvider({
    id: `ollama:${modelo}`,
    esReal: true,
    dimensiones: () => dimensiones,
    embeber
  });
}
