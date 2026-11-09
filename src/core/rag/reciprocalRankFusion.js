/**
 * Reciprocal Rank Fusion (RRF) con factor k=60 (RF-03).
 *
 * Combina listas de candidatos de canales distintos (denso, disperso)
 * usando SOLO el rango de cada documento en cada lista:
 *
 *   scoreRRF(d) = suma por canal de  peso_canal / (k + rango_canal(d))
 *
 * con rango empezando en 1. Los ids ausentes de una lista no aportan.
 * k=60 es el valor estandar del paper (Cormack et al., 2009) y el que
 * fija el ERS; amortigua el peso de las primeras posiciones y evita que
 * un solo canal domine por una puntuacion absoluta inflada.
 *
 * Modulo puro: sin IO, sin dependencias de infraestructura.
 *
 * Strict Policy: Zero Emojis.
 */

export const RRF_K_DEFECTO = 60;

/**
 * Fusiona varias listas ordenadas de candidatos.
 *
 * @param {Array<{canal: string, resultados: Array<{id: string}>, peso?: number}>} listas
 *   Cada lista viene ordenada de mejor a peor. `peso` opcional (defecto 1).
 * @param {object} [opciones]
 * @param {number} [opciones.k=60]  Factor RRF.
 * @returns {Array<{id: string, scoreRrf: number, canales: string[], rangos: Record<string, number>}>}
 *   Candidatos unicos ordenados por scoreRrf descendente. Los empates se
 *   deshacen por mejor rango individual y despues por id (determinista).
 */
export function fusionarRRF(listas, opciones = {}) {
  const k = Number.isFinite(opciones.k) && opciones.k > 0 ? opciones.k : RRF_K_DEFECTO;
  const acumulado = new Map();

  for (const lista of Array.isArray(listas) ? listas : []) {
    if (!lista || typeof lista.canal !== 'string' || !Array.isArray(lista.resultados)) {
      continue;
    }
    const peso = Number.isFinite(lista.peso) && lista.peso > 0 ? lista.peso : 1;
    const vistos = new Set();
    let rango = 0;
    for (const item of lista.resultados) {
      if (!item || typeof item.id !== 'string' || vistos.has(item.id)) {
        continue; // un duplicado dentro de la misma lista no sube el rango dos veces
      }
      vistos.add(item.id);
      rango += 1;
      let entrada = acumulado.get(item.id);
      if (!entrada) {
        entrada = { id: item.id, scoreRrf: 0, canales: [], rangos: {} };
        acumulado.set(item.id, entrada);
      }
      entrada.scoreRrf += peso / (k + rango);
      entrada.canales.push(lista.canal);
      entrada.rangos[lista.canal] = rango;
    }
  }

  const fusionados = Array.from(acumulado.values());
  for (const entrada of fusionados) {
    entrada.mejorRango = Math.min(...Object.values(entrada.rangos));
  }
  fusionados.sort((a, b) => {
    if (b.scoreRrf !== a.scoreRrf) return b.scoreRrf - a.scoreRrf;
    if (a.mejorRango !== b.mejorRango) return a.mejorRango - b.mejorRango;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const entrada of fusionados) {
    delete entrada.mejorRango;
    entrada.scoreRrf = Math.round(entrada.scoreRrf * 1e9) / 1e9;
  }
  return fusionados;
}
