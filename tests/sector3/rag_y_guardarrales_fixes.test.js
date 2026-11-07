/**
 * rag_y_guardarrales_fixes.test.js - Regresiones de la revision del 7 nov 2026:
 *
 * 1. RAG: guardar/actualizar/olvidar una memoria refresca el indice vectorial
 *    al momento (antes quedaba congelado en el primer knowledge_vectors.json).
 * 2. RAG: una escritura EXTERNA al archivo de memorias (otro proceso, un git
 *    pull) tambien se detecta por firma y reindexa.
 * 3. RAG: la categoria "clave" (credenciales) NUNCA se indexa ni se devuelve
 *    por el camino vectorial, ni siquiera desde un indice antiguo que la
 *    contuviera. La proteccion de memoryService no se puede rodear por RAG.
 * 4. Navegacion: los guardarrales bloquean login/compra/admin pero no la
 *    lectura publica legitima (noticias sobre bancos, /autor/, "Cartografia").
 * 5. Guardarrail de numeros: un numero que sale de un RESULTADO de herramienta
 *    es dato verificado y no se censura; uno inventado por el modelo, si.
 *
 * Strict Policy: Zero Emojis.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardarMemoria, olvidarMemoria } from '../../src/services/memoryService.js';
import {
  buscarMemoriaSemantica,
  cargarIndiceVectorial,
  guardarIndiceVectorial,
  getDefaultStorePath,
  getDefaultVectorsPath,
  invalidarIndiceSemantico
} from '../../src/services/semanticMemoryService.js';
import { validarGuardarrailesNavegacion } from '../../src/services/browserService.js';
import { guardHallucinations } from '../../src/services/preSendGuardrailService.js';

const STORE = getDefaultStorePath();
const VECTORS = getDefaultVectorsPath();

// La suite comparte un unico DAVIS_DATA_DIR temporal entre archivos: este
// archivo necesita un almacen vacio para sus regresiones, pero debe dejar
// el contenido previo intacto para los archivos que corren despues.
const respaldo = new Map();
for (const p of [STORE, VECTORS]) {
  try { respaldo.set(p, fs.readFileSync(p)); } catch { respaldo.set(p, null); }
}
after(() => {
  invalidarIndiceSemantico();
  for (const [p, contenido] of respaldo) {
    try {
      if (contenido === null) fs.rmSync(p, { force: true });
      else fs.writeFileSync(p, contenido);
    } catch { /* restauracion best-effort */ }
  }
});

function limpiar() {
  invalidarIndiceSemantico();
  for (const p of [STORE, VECTORS]) {
    try { fs.rmSync(p, { force: true }); } catch { /* aislado */ }
  }
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, '[]', 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Refresco del indice RAG en el camino real de escritura del bot
// ---------------------------------------------------------------------------

test('RAG: una memoria guardada por el camino normal es encontrable al momento', async () => {
  limpiar();

  const antes = await buscarMemoriaSemantica('talla de zapatillas');
  assert.equal(antes.length, 0, 'sin memorias no hay resultados');

  const g = guardarMemoria({ sujeto: 'Talla de zapatillas', dato: 'David usa la talla 44 en zapatillas Nike.', categoria: 'persona', tags: ['talla', 'zapatillas'] });
  assert.equal(g.ok, true);

  const despues = await buscarMemoriaSemantica('que talla de zapatillas usa David');
  assert.ok(despues.length > 0, 'la memoria recien guardada debe aparecer en la busqueda semantica');
  assert.match(despues[0].dato, /talla 44/);
});

test('RAG: actualizar una memoria actualiza lo que devuelve la busqueda', async () => {
  limpiar();
  guardarMemoria({ sujeto: 'Talla de zapatillas', dato: 'David usa la talla 44.', categoria: 'persona' });
  const primera = await buscarMemoriaSemantica('talla zapatillas');
  assert.match(primera[0].dato, /talla 44/);

  // Mismo hecho, dato nuevo: memoryService lo trata como actualizacion.
  guardarMemoria({ sujeto: 'Talla de zapatillas', dato: 'David usa la talla 45.', categoria: 'persona' });
  const segunda = await buscarMemoriaSemantica('talla zapatillas');
  assert.match(segunda[0].dato, /talla 45/, 'la busqueda debe reflejar el dato actualizado');
  assert.doesNotMatch(segunda[0].dato, /talla 44/);
});

test('RAG: olvidar una memoria la retira del indice', async () => {
  limpiar();
  guardarMemoria({ sujeto: 'Talla de zapatillas', dato: 'David usa la talla 44.', categoria: 'persona' });
  assert.ok((await buscarMemoriaSemantica('talla zapatillas')).length > 0);

  const borrado = olvidarMemoria('zapatillas');
  assert.equal(borrado.ok, true);

  const despues = await buscarMemoriaSemantica('talla zapatillas');
  assert.equal(despues.length, 0, 'una memoria olvidada no puede seguir saliendo por RAG');
});

test('RAG: una escritura externa al archivo de memorias se detecta y reindexa', async () => {
  limpiar();
  guardarMemoria({ sujeto: 'Ciudad favorita', dato: 'La ciudad favorita de David es Granada.', categoria: 'persona' });
  assert.ok((await buscarMemoriaSemantica('ciudad favorita')).length > 0);

  // Otro proceso (o un git pull) modifica el archivo por detras.
  const externas = [
    { id: 'mem_ext_1', sujeto: 'Equipo de futbol', dato: 'David es del Atletico de Madrid.', categoria: 'persona', tags: ['futbol'], fechaRegistro: new Date().toISOString(), fechaLocal: '07/11/2026, 16:00' }
  ];
  fs.writeFileSync(STORE, JSON.stringify(externas, null, 2), 'utf8');
  // Fuerza una mtime claramente distinta por si la resolucion es grosera.
  const futuro = new Date(Date.now() + 5000);
  fs.utimesSync(STORE, futuro, futuro);

  const despues = await buscarMemoriaSemantica('equipo de futbol');
  assert.ok(despues.some((r) => /Atletico/.test(r.dato)), 'la escritura externa debe reindexarse sola');
  const soloNuevas = await buscarMemoriaSemantica('ciudad favorita');
  assert.equal(soloNuevas.length, 0, 'la memoria anterior ya no existe en el archivo');
});

// ---------------------------------------------------------------------------
// 2. Credenciales fuera del camino RAG
// ---------------------------------------------------------------------------

test('RAG: una memoria de categoria clave nunca se indexa ni se devuelve', async () => {
  limpiar();
  const SECRETO_TEST = 'TEST-SECRET-x9Qwen23zK74Lm01';
  process.env.MEMORY_ENCRYPTION_KEY = 'test_key_rag_regression';
  try {
    const g = guardarMemoria({ sujeto: 'Clave del laboratorio', dato: SECRETO_TEST, categoria: 'clave', tags: ['laboratorio'] });
    assert.equal(g.ok, true, 'con clave de cifrado el guardado de credenciales funciona');

    const res = await buscarMemoriaSemantica('clave del laboratorio');
    assert.equal(res.length, 0, 'una credencial no sale por la busqueda semantica');

    const indice = cargarIndiceVectorial(VECTORS);
    if (indice) {
      assert.ok(!JSON.stringify(indice).includes(SECRETO_TEST), 'el indice en disco no contiene la credencial');
    }
  } finally {
    delete process.env.MEMORY_ENCRYPTION_KEY;
  }
});

test('RAG: un indice antiguo con una credencial indexada se ignora y se reconstruye sin ella', async () => {
  limpiar();
  const SECRETO_TEST = 'TEST-SECRET-Legacy55AAbb99';
  // Simula un knowledge_vectors.json heredado que SI contenia una clave.
  guardarIndiceVectorial({
    version: '1.0.0',
    fechaActualizacion: new Date().toISOString(),
    totalDocumentos: 1,
    vocabulary: ['vps', 'root', 'clave'],
    idfMap: { vps: 0.5, root: 0.5, clave: 0.5 },
    vectors: [{
      id: 'mem_vieja',
      sujeto: 'Test VPS Server Root',
      dato: SECRETO_TEST,
      categoria: 'clave',
      tags: ['vps'],
      vector: [0.5, 0.5, 0.5],
      sparseVector: { vps: 0.5, root: 0.5, clave: 0.5 }
    }]
  }, VECTORS);

  const res = await buscarMemoriaSemantica('vps root clave');
  assert.equal(res.length, 0, 'una credencial indexada en el pasado tampoco sale');
  const crudo = fs.existsSync(VECTORS) ? fs.readFileSync(VECTORS, 'utf8') : '';
  assert.ok(!crudo.includes(SECRETO_TEST), 'tras la reconstruccion el indice ya no contiene la credencial');
});

// ---------------------------------------------------------------------------
// 3. Guardarrales de navegacion: seguridad sin censurar lectura publica
// ---------------------------------------------------------------------------

test('Navegacion: siguen bloqueadas login, compra y administracion', () => {
  const prohibidas = [
    'https://tienda.com/checkout/step1',
    'https://banco.es/login',
    'https://ejemplo.com/cart',
    'https://sitio.com/auth/oauth/authorize',
    'https://comercio.es/carrito/pagar',
    'https://servidor.com/admin/dashboard',
    'https://github.com/login',
    'https://tienda.com/pago/tarjeta',
    'https://app.com/sign-in?next=/home'
  ];
  for (const url of prohibidas) {
    assert.equal(validarGuardarrailesNavegacion(url).permitido, false, `deberia bloquear: ${url}`);
  }
});

test('Navegacion: ya no se bloquea lectura publica legitima', () => {
  const permitidas = [
    'https://www.elconfidencial.com/economia/2026-11-07/banco-santander-resultados_123/',
    'https://es.wikipedia.org/wiki/Cartografia',
    'https://elpais.com/autor/juan-lopez/',
    'https://www.renfe.com/es/es/viajar/prepara-tu-viaje',
    'https://www.amazon.es/dp/B0CX23V2ZK',
    'https://nodejs.org/api/fs.html',
    'https://elpais.com/economia/administracion-publica.html'
  ];
  for (const url of permitidas) {
    assert.equal(validarGuardarrailesNavegacion(url).permitido, true, `deberia permitir: ${url}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Guardarrail de numeros: verificado por herramienta vs inventado
// ---------------------------------------------------------------------------

test('Numeros: uno devuelto por una herramienta no se censura', () => {
  const texto = 'El telefono de atencion de Renfe es 912320320, por si quieres llamar.';
  const contexto = {
    destinatario: '34600112233@s.whatsapp.net',
    contactosConocidos: [],
    traza: {
      llamadas: [{ nombre: 'navegar_y_leer_noticia', ronda: 1, resultado: 'ok' }],
      reactSteps: [{
        round: 1,
        phase: 'observe',
        toolResults: [{ id: 't1', name: 'navegar_y_leer_noticia', result: 'Atencion al viajero Renfe: 912320320. Horario de 6:00 a 24:00.', status: 'ok' }]
      }]
    }
  };
  const res = guardHallucinations(texto, contexto);
  assert.ok(res.textoModificado.includes('912320320'), 'el numero vino de una herramienta: es dato verificado');
  assert.equal(res.huboCorreccion, false);
});

test('Numeros: uno inventado por el modelo sigue censurandose', () => {
  const texto = 'He programado el mensaje para el numero +34699887766 como pediste.';
  const contexto = {
    destinatario: '34600112233@s.whatsapp.net',
    contactosConocidos: ['34600112233'],
    traza: { llamadas: [], reactSteps: [] }
  };
  const res = guardHallucinations(texto, contexto);
  assert.equal(res.huboCorreccion, true);
  assert.match(res.textoModificado, /NUMERO_NO_VERIFICADO/);
});
