// Solo configura el planificador del runner de TESTS. Produccion no lo importa.
export function argumentosConcurrencia(valor) {
  if (valor === undefined || valor === '') return [];
  if (!/^[1-9][0-9]*$/.test(valor) || Number(valor) > 128) throw new Error('DAVIS_TEST_CONCURRENCY debe ser entero entre1y128.');
  return ['--test-concurrency=' + valor];
}
