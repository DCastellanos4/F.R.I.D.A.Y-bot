/**
 * Puerto de salida: proveedor de embeddings densos (RF-03).
 *
 * El nucleo RAG convierte texto en vectores densos SOLO a traves de esta
 * interfaz; no sabe si detras hay un Ollama local, un servidor de
 * inferencia dedicado o un stub de pruebas.
 *
 * Contrato:
 *  - embeber recibe un lote de textos y devuelve un vector por texto, en
 *    el mismo orden. Lote vacio devuelve [].
 *  - Todos los vectores del proveedor tienen EXACTAMENTE dimensiones()
 *    componentes. Un cambio de modelo implica reindexar: dos vectores de
 *    modelos distintos nunca se mezclan en la misma coleccion.
 *  - El proveedor NO decide tenancy ni filtrado: eso es del servicio.
 *
 * Strict Policy: Zero Emojis.
 */

/**
 * @typedef {Object} EmbeddingProviderPort
 * @property {string} id  Etiqueta estable del proveedor (telemetria y manifiestos).
 * @property {boolean} esReal  true solo en codificadores densos verdaderos (modelo de
 *   embeddings real); false en fakes de prueba. Un pipeline con esReal=false nunca
 *   esta listo para certificar RF-03.
 * @property {() => number} dimensiones  Dimensionalidad de los vectores que emite.
 * @property {(textos: string[]) => Promise<number[][]>} embeber  Un vector por texto, mismo orden.
 */

/**
 * Verifica que un objeto cumple el puerto. Lanza TypeError si falta algo.
 */
export function afirmarEmbeddingProvider(proveedor) {
  if (!proveedor || typeof proveedor !== 'object') {
    throw new TypeError('EmbeddingProviderPort: se esperaba un objeto proveedor.');
  }
  if (typeof proveedor.id !== 'string' || !proveedor.id) {
    throw new TypeError('EmbeddingProviderPort: id (string) es obligatorio.');
  }
  if (typeof proveedor.esReal !== 'boolean') {
    throw new TypeError('EmbeddingProviderPort: esReal (boolean) es obligatorio.');
  }
  if (typeof proveedor.dimensiones !== 'function' || typeof proveedor.embeber !== 'function') {
    throw new TypeError('EmbeddingProviderPort: dimensiones y embeber (funciones) son obligatorias.');
  }
  const dims = proveedor.dimensiones();
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new TypeError('EmbeddingProviderPort: dimensiones() debe devolver un entero positivo.');
  }
  return proveedor;
}
