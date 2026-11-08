/**
 * E2E con el agente REAL y un LLM stub: lo que recibe el modelo en nombre de un
 * tenant sintetico no contiene datos del propietario ni de otro tenant (memoria
 * exacta por puerto del propietario, semantica/RAG, grafo, episodios/historial).
 * Entra por consultarJarvisEnAmbito (interno, sin compuerta); la entrada
 * publica consultarJarvis sigue cerrada (se comprueba).
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-llm-'));
process.env.DAVIS_DATA_DIR = DIR;
const { consultarJarvis, consultarJarvisEnAmbito } = await import('../../src/core/jarvisAgent.js');
const H = await import('../../src/services/conversationHistoryService.js');
const { claveChatTenant } = await import('../../src/core/tenancy.js');
const E = await import('../../src/services/episodicMemoryService.js');
const G = await import('../../src/services/graphMemoryService.js');

const mem = (id, dato) => [{ id, sujeto: 'tesoro azul zeta', dato, categoria: 'general', tags: ['tesoro', 'azul', 'zeta'], fecha_registro: '2026-01-01' }];
const escribe = (ruta, obj) => { fs.mkdirSync(path.dirname(ruta), { recursive: true }); fs.writeFileSync(ruta, JSON.stringify(obj)); };
const grafo = (nota) => { const g = { nodos: {}, aristas: [] }; G.agregarNodo(g, { id: 'ana', nombre: 'ana', tipo: 'persona' }); G.agregarArista(g, { origen: 'ana', destino: 'madrid', relacion: nota }); return g; };

escribe(path.join(DIR, 'brain_memory.json'), mem('o1', 'tesoro azul zeta SECRETO-OWNER-JSON'));
escribe(path.join(DIR, 'knowledge_graph.json'), grafo('secreto-owner-grafo'));
escribe(path.join(DIR, 'tenants', 'sint-b', 'brain_memory.json'), mem('b1', 'tesoro azul zeta SECRETO-TENANT-B'));
escribe(path.join(DIR, 'tenants', 'sint-a', 'brain_memory.json'), mem('a1', 'tesoro azul zeta DATO-PROPIO-A'));
escribe(path.join(DIR, 'tenants', 'sint-a', 'knowledge_graph.json'), grafo('grafo-propio-a'));

const repoOwner = {
  guardar: () => ({ ok: true }), olvidar: () => ({ ok: true }), listar: () => mem('o2', 'SECRETO-OWNER-SQLITE'),
  buscar: () => mem('o2', 'tesoro azul zeta SECRETO-OWNER-SQLITE')
};

function llmStub(capturas) {
  return async (peticion) => { capturas.push(JSON.stringify(peticion)); return { model: 'stub', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], message: { role: 'assistant', content: 'ok' } }; };
}

test('entrada publica: tenant ajeno sigue cerrado (0 llamadas al LLM)', async () => {
  const cap = [];
  const r = await consultarJarvis('que sabes de ana y del tesoro azul zeta', [], { tenantId: 'sint-a', rolDeTenant: () => 'usuario', chatCompletion: llmStub(cap), memoryRepository: repoOwner });
  assert.equal(cap.length, 0);
  assert.match(r, /no disponible/i);
});

test('LLM de un tenant: recibe lo propio y NADA del propietario ni de otro tenant', async () => {
  const kA = claveChatTenant('sint-a', 'chat1');
  H.registrarIntercambio(claveChatTenant('sint-b', 'chat1'), 'HISTORIAL-SECRETO-B', 'r');
  H.registrarIntercambio('chat1', 'HISTORIAL-SECRETO-OWNER', 'r');
  const ep = (c, t) => E.archivarEpisodios(c, [{ role: 'user', content: `tesoro azul zeta ${t}` }]);
  ep('chat1', 'EPISODIO-SECRETO-OWNER'); ep(claveChatTenant('sint-b', 'chat1'), 'EPISODIO-SECRETO-B'); ep(kA, 'EPISODIO-PROPIO-A');
  const cap = [];
  await consultarJarvisEnAmbito('que sabes de ana y del tesoro azul zeta', [], {
    tenantId: 'sint-a', chatId: 'chat1', chatCompletion: llmStub(cap), memoryRepository: repoOwner,
    obtenerMemorias: () => mem('o3', 'SECRETO-OWNER-OBTENER'), contactosConocidos: ['SECRETO-CONTACTO-OWNER'],
    rutaArchivoGrafo: path.join(DIR, 'knowledge_graph.json'), storePath: path.join(DIR, 'brain_memory.json')
  });
  assert.ok(cap.length >= 1, 'el stub recibio la peticion');
  const todo = cap.join('\n');
  const todoMin = todo.toLowerCase();
  for (const s of ['SECRETO-OWNER-JSON', 'secreto-owner-grafo', 'SECRETO-OWNER-SQLITE', 'SECRETO-OWNER-OBTENER', 'SECRETO-TENANT-B', 'HISTORIAL-SECRETO-B', 'HISTORIAL-SECRETO-OWNER', 'EPISODIO-SECRETO-OWNER', 'EPISODIO-SECRETO-B']) {
    assert.ok(!todoMin.includes(s.toLowerCase()), `el LLM no recibe ${s}`);
  }
  assert.ok(todo.includes('DATO-PROPIO-A'), 'si recibe su propia memoria (el test no es vacuo)');
  assert.ok(todoMin.includes('grafo-propio-a'), 'si recibe su propio grafo');
  assert.ok(todoMin.includes('episodio-propio-a'), 'si recibe su propio episodio');
});

test('control: el propietario SI recibe sus datos (el stub detectaria una fuga)', async () => {
  const cap = [];
  await consultarJarvisEnAmbito('que sabes de ana y del tesoro azul zeta', [], { chatId: 'chat1', chatCompletion: llmStub(cap), memoryRepository: repoOwner });
  assert.ok(cap.join('\n').includes('SECRETO-OWNER-SQLITE'));
});

test('con la fuente SQLite del propietario REGISTRADA por defecto (como en prod), la semantica de un tenant sigue usando su ruta', async () => {
  const S = await import('../../src/services/semanticMemoryService.js');
  S.registrarFuenteMemoriasPorDefecto({
    leerMemorias: () => mem('o9', 'tesoro azul zeta SECRETO-OWNER-FUENTE-DEFECTO'),
    firma: () => 'firma-owner'
  });
  try {
    const cap = [];
    await consultarJarvisEnAmbito('que sabes de ana y del tesoro azul zeta', [], {
      tenantId: 'sint-a', chatId: 'chat1', chatCompletion: llmStub(cap)
    });
    const todo = cap.join('\n');
    assert.ok(!todo.includes('SECRETO-OWNER-FUENTE-DEFECTO'), 'el LLM del tenant no recibe la fuente por defecto del propietario');
    assert.ok(todo.includes('DATO-PROPIO-A'));
    // control: el propietario (sin ruta explicita) SI usa la fuente por defecto
    const cap2 = [];
    await consultarJarvisEnAmbito('que sabes de ana y del tesoro azul zeta', [], { chatId: 'chat1', chatCompletion: llmStub(cap2) });
    assert.ok(cap2.join('\n').includes('SECRETO-OWNER-FUENTE-DEFECTO'), 'control: propietario conserva su fuente');
  } finally { S.registrarFuenteMemoriasPorDefecto(null); }
});

// ---- Herramienta buscar_recuerdo_semantico por el bucle REAL del agente ----
const nota = (base, dia, nombre, titulo, cuerpo) => {
  const d = path.join(base, dia); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, nombre), `# ${titulo}\ncategoria: general\ntags: tesoro\n\n${cuerpo}\n`);
};
nota(path.join(DIR, 'notes'), '2026-01-01', 'o.md', 'nota tesoro propietario', 'tesoro azul zeta SECRETO-NOTA-OWNER');
nota(path.join(DIR, 'tenants', 'sint-b', 'notes'), '2026-01-01', 'b.md', 'nota tesoro b', 'tesoro azul zeta SECRETO-NOTA-B');
nota(path.join(DIR, 'tenants', 'sint-a', 'notes'), '2026-01-01', 'a.md', 'nota tesoro a', 'tesoro azul zeta NOTA-PROPIA-A');

function llmHerramienta(capturas) {
  let n = 0;
  return async (peticion) => {
    capturas.push(JSON.stringify(peticion));
    n++;
    if (n === 1) {
      return { model: 'stub', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'buscar_recuerdo_semantico', arguments: { consulta: 'tesoro azul zeta' } } }] } };
    }
    return { model: 'stub', message: { role: 'assistant', content: '1,2,3' } };
  };
}

async function correrHerramienta(opc) {
  const cap = [];
  await consultarJarvisEnAmbito('busca en mis recuerdos el tesoro azul zeta con la busqueda semantica', [], { chatId: 'chat1', chatCompletion: llmHerramienta(cap), ...opc });
  return cap.join('\n');
}

test('herramienta buscar_recuerdo_semantico (lista blanca abierta SOLO en el test): el modelo del tenant no ve memorias SQLite del propietario ni notas ajenas; ve lo propio', async () => {
  const S = await import('../../src/services/memoryService.js');
  S.registrarStoreMemoriasPorDefecto({
    buscar: () => mem('o7', 'tesoro azul zeta SECRETO-OWNER-STORE-DEFECTO'),
    listar: () => mem('o7', 'tesoro azul zeta SECRETO-OWNER-STORE-DEFECTO'),
    leer: () => mem('o7', 'tesoro azul zeta SECRETO-OWNER-STORE-DEFECTO'),
    guardar: () => {}, transaccion: (fn) => fn()
  });
  try {
    const todo = await correrHerramienta({ tenantId: 'sint-a', rolDeTenant: () => 'usuario', permitidasUsuario: ['buscar_recuerdo_semantico'] });
    assert.ok(todo.includes('buscar_recuerdo_semantico'), 'la herramienta se ejecuto (ver resultado en la segunda peticion)');
    assert.ok(todo.includes('NOTA-PROPIA-A') || todo.includes('DATO-PROPIO-A'), 've lo propio');
    for (const s of ['SECRETO-OWNER-STORE-DEFECTO', 'SECRETO-NOTA-OWNER', 'SECRETO-NOTA-B', 'SECRETO-TENANT-B']) {
      assert.ok(!todo.includes(s), `fuga: ${s}`);
    }
    // control: el propietario conserva su store y sus notas por defecto
    const cap2 = await correrHerramienta({ permitidasUsuario: ['buscar_recuerdo_semantico'] });
    assert.ok(cap2.includes('SECRETO-OWNER-STORE-DEFECTO') || cap2.includes('SECRETO-NOTA-OWNER'), 'control: propietario ve lo suyo');
  } finally { S.registrarStoreMemoriasPorDefecto(null); }
});

test('con la lista blanca vacia (produccion) un tenant no ejecuta buscar_recuerdo_semantico', async () => {
  const todo = await correrHerramienta({ tenantId: 'sint-a', rolDeTenant: () => 'usuario' });
  assert.ok(todo.includes('no_en_lista_blanca'));
  assert.ok(!todo.includes('NOTA-PROPIA-A'));
});

test('E2E RBAC: programadores owner-only se deniegan antes de ejecutar aun con allowlist completa', async () => {
  const herramientas = ['crear_recordatorio', 'configurar_repaso_flashcards', 'configurar_radar_ofertas', 'ejecutar_skill', 'trigger_encrypted_backup'];
  for (const nombre of herramientas) {
    let efectos = 0; let ronda = 0; const capturas = [];
    const chatCompletion = async (p) => {
      capturas.push(JSON.stringify(p)); ronda++;
      return ronda === 1
        ? { model: 'stub', message: { role: 'assistant', content: '', tool_calls: [{ id: 'deny-' + nombre, function: { name: nombre, arguments: {} } }] } }
        : { model: 'stub', message: { role: 'assistant', content: 'ok' } };
    };
    await consultarJarvisEnAmbito('ejecuta la accion solicitada', [], {
      tenantId: 'sint-a', chatId: 'denegar-' + nombre, rolDeTenant: () => 'usuario',
      permitidasUsuario: herramientas, chatCompletion,
      ejecutores: { [nombre]: () => { efectos++; return 'EJECUTADO'; } }
    });
    assert.equal(efectos, 0, nombre);
    assert.ok(capturas.join('\n').includes('solo_propietario'), nombre);
  }
});
