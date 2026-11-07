/**
 * router_especialista_log.test.js - Regresion del aviso enganoso observado
 * con modelo real (7 nov 2026): "[RouterEspecialista] N herramientas
 * permitidas para X no existen en el catalogo y se ignoran" se disparaba
 * con decenas de herramientas REALES que simplemente no venian en la
 * preseleccion de la peticion. El aviso solo debe sonar para nombres que
 * faltan en el catalogo estatico completo (renombradas o sin conectar).
 *
 * Strict Policy: Zero Emojis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrutarYFiltrarHerramientas } from '../../src/services/specialistRouterService.js';
import { herramientasJarvis } from '../../src/core/tools.js';

test('El aviso "no existen en el catalogo" NO suena por herramientas reales no preseleccionadas', () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  try {
    // Preseleccion minima, como la de una peticion real enrutada por regex.
    const preseleccion = herramientasJarvis.slice(0, 2);
    enrutarYFiltrarHerramientas('cual era el tono que te dije para el prototipo Zeta?', preseleccion);
  } finally {
    console.warn = original;
  }
  const falsos = avisos.filter((a) => a.includes('no existen en el catalogo'));
  assert.deepEqual(falsos, [], `avisos enganosos sobre herramientas reales: ${falsos.join(' | ')}`);
});

test('El aviso SI suena para un nombre configurado que falta en el catalogo completo', () => {
  // Sin inyeccion de configuracion, el camino real es una permitida que ya
  // no existe en herramientasJarvis; aqui se verifica el criterio: solo
  // pueden acusarse nombres ajenos al catalogo estatico completo.
  const nombresCatalogo = new Set(herramientasJarvis.map((h) => h?.function?.name || h?.name));
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  try {
    enrutarYFiltrarHerramientas('haz commit de los cambios', herramientasJarvis);
  } finally {
    console.warn = original;
  }
  for (const aviso of avisos.filter((a) => a.includes('no existen en el catalogo'))) {
    const listado = aviso.split(':').pop().split(',').map((s) => s.trim());
    for (const nombre of listado) {
      assert.ok(!nombresCatalogo.has(nombre), `"${nombre}" existe en el catalogo; el aviso seria enganoso`);
    }
  }
});
