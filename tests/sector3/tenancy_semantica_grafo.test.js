/**
 * Memoria semantica, vectores y grafo con ruta por tenant (rutaDatosTenant):
 * dos tenants SINTETICOS alternando consultas no se ven entre si (incluida la
 * cache en memoria), el propietario conserva su ruta historica, y NINGUNA
 * herramienta del catalogo real es ejecutable por un tenant no propietario.
 * Prueba a nivel de servicio con rutas explicitas: no afirma que el agente
 * ya enrute por tenant (la compuerta sigue cerrada).
 * Strict Policy: Zero Emojis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rutaDatosTenant } from '../../src/core/tenancy.js';
import { buscarMemoriaSemantica } from '../../src/services/semanticMemoryService.js';
import { cargarGrafo, guardarGrafo, agregarNodo, obtenerContextoGrafo } from '../../src/services/graphMemoryService.js';
import { NOMBRES_HERRAMIENTAS_JARVIS } from '../../src/core/tools.js';
import { puedeEjecutarHerramienta } from '../../src/services/rbacService.js';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'davis-sem-'));
const dirDe = (t) => { const r = rutaDatosTenant(BASE, t, 'x.json'); fs.mkdirSync(path.dirname(r), { recursive: true }); return path.dirname(r); };

test('rutaDatosTenant: propietario en la raiz historica; tenants en subcarpetas distintas', () => {
  assert.equal(rutaDatosTenant(BASE, 'propietario', 'brain_memory.json'), path.join(BASE, 'brain_memory.json'));
  assert.notEqual(rutaDatosTenant(BASE, 'sint-a', 'brain_memory.json'), rutaDatosTenant(BASE, 'sint-b', 'brain_memory.json'));
});

test('semantica y vectores por tenant: sin fuga cruzada alternando consultas', async () => {
  const mem = (dato) => [{ id: 'm1', sujeto: 'secreto', dato, categoria: 'general', tags: [], fecha_registro: '2026-01-01' }];
  const rutas = {};
  for (const [t, dato] of [['sint-a', 'la clave del tesoro azul esta en Toledo'], ['sint-b', 'la receta de paella naranja usa azafran'], [undefined, 'el pin del propietario violeta es de David']]) {
    const d = t ? dirDe(t) : BASE;
    rutas[t || 'o'] = { storePath: path.join(d, 'brain_memory.json'), vectorsPath: path.join(d, 'knowledge_vectors.json') };
    fs.writeFileSync(rutas[t || 'o'].storePath, JSON.stringify(mem(dato)));
  }
  const buscar = (k, q) => buscarMemoriaSemantica(q, { ...rutas[k], minScore: 0.01 }).then((r) => JSON.stringify(r));
  for (let i = 0; i < 3; i++) {
    const a = await buscar('sint-a', 'clave tesoro azul Toledo paella azafran pin David');
    assert.ok(a.includes('Toledo'));
    assert.ok(!a.includes('azafran') && !a.includes('David'), 'A no ve datos de B ni del propietario');
    const b = await buscar('sint-b', 'clave tesoro azul Toledo paella azafran pin David');
    assert.ok(b.includes('azafran'));
    assert.ok(!b.includes('Toledo') && !b.includes('David'), 'B no ve A ni propietario');
    const o = await buscar('o', 'clave tesoro azul Toledo paella azafran pin David');
    assert.ok(o.includes('David') && !o.includes('Toledo') && !o.includes('azafran'), 'propietario no ve tenants');
  }
});

test('grafo por tenant: contexto de un tenant no incluye nodos de otro', () => {
  const dA = dirDe('sint-a'), dB = dirDe('sint-b');
  const gA = cargarGrafo({ dataDir: dA });
  agregarNodo(gA, { id: 'persona_zeta', nombre: 'Zeta', tipo: 'persona', metadata: { nota: 'DATO-PRIVADO-A' } });
  guardarGrafo(gA, { dataDir: dA });
  const gB = cargarGrafo({ dataDir: dB });
  agregarNodo(gB, { id: 'persona_zeta', nombre: 'Zeta', tipo: 'persona', metadata: { nota: 'DATO-PRIVADO-B' } });
  guardarGrafo(gB, { dataDir: dB });
  const ctxA = JSON.stringify(cargarGrafo({ dataDir: dA })) + obtenerContextoGrafo('Zeta', { dataDir: dA });
  assert.ok(ctxA.includes('DATO-PRIVADO-A') && !ctxA.includes('DATO-PRIVADO-B'));
  const ctxB = JSON.stringify(cargarGrafo({ dataDir: dB })) + obtenerContextoGrafo('Zeta', { dataDir: dB });
  assert.ok(ctxB.includes('DATO-PRIVADO-B') && !ctxB.includes('DATO-PRIVADO-A'));
});

test('catalogo real completo: NINGUNA herramienta ejecutable por usuario/tenant desconocido; propietario todas', () => {
  assert.ok(NOMBRES_HERRAMIENTAS_JARVIS.size > 50, 'catalogo real cargado');
  for (const h of NOMBRES_HERRAMIENTAS_JARVIS) {
    assert.equal(puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS, rolDe: () => 'usuario' }).permitido, false, `usuario denegado: ${h}`);
    assert.equal(puedeEjecutarHerramienta({ tenantId: 'sint-zz', herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS }).permitido, false, `desconocido denegado: ${h}`);
    assert.equal(puedeEjecutarHerramienta({ tenantId: undefined, herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS }).permitido, true, `propietario: ${h}`);
  }
});

test('aislarOpcionesTenant: fuerza rutas y chatId del tenant, ignora overrides; propietario intacto', async () => {
  const { aislarOpcionesTenant } = await import('../../src/core/tenancy.js');
  const o = { chatId: 'c1', rutaArchivoGrafo: '/x' };
  assert.equal(aislarOpcionesTenant(o, BASE), o, 'sin tenant: mismo objeto');
  assert.equal(aislarOpcionesTenant({ ...o, tenantId: 'propietario' }, BASE).chatId, 'c1');
  const t = aislarOpcionesTenant({ tenantId: 'sint-a', chatId: 'c1', rutaArchivoGrafo: '/etc/passwd', storePath: '/otro/brain.json', rutaArchivoMemorias: '/otro/m.json', vectorsPath: '/otro/v.json' }, BASE);
  assert.equal(t.chatId, 't:sint-a:c1');
  assert.equal(t.rutaArchivoGrafo, path.join(BASE, 'tenants', 'sint-a', 'knowledge_graph.json'));
  assert.equal(t.rutaArchivoMemorias, path.join(BASE, 'tenants', 'sint-a', 'brain_memory.json'));
  assert.equal(t.vectorsPath, path.join(BASE, 'tenants', 'sint-a', 'knowledge_vectors.json'));
  assert.equal(t.storePath, undefined);
  assert.throws(() => aislarOpcionesTenant({ tenantId: '../x' }, BASE));
});

test('aislarOpcionesTenant: TODAS las rutas personales del agente quedan bajo tenants/<id>/ aunque vengan overrides', async () => {
  const { aislarOpcionesTenant, RUTAS_DATOS_TENANT } = await import('../../src/core/tenancy.js');
  const sucio = { tenantId: 'sint-a' };
  for (const k of Object.keys(RUTAS_DATOS_TENANT)) sucio[k] = `/datos-del-propietario/${k}.json`;
  const t = aislarOpcionesTenant(sucio, BASE);
  for (const [k, nombre] of Object.entries(RUTAS_DATOS_TENANT)) {
    assert.equal(t[k], path.join(BASE, 'tenants', 'sint-a', nombre), k);
  }
  assert.ok(Object.keys(RUTAS_DATOS_TENANT).length >= 25);
  // Todas las opciones ruta* que lee jarvisAgent estan cubiertas o excluidas a proposito
  const src = fs.readFileSync(new URL('../../src/core/jarvisAgent.js', import.meta.url), 'utf-8');
  const usadas = [...new Set([...src.matchAll(/opciones\.(ruta[A-Za-z]+)/g)].map((m) => m[1]))];
  const excluidas = new Set(['rutaArchivoMemorias', 'rutaVectores', 'rutaArchivoGrafo', 'rutaArchivoProgramados', 'rutaArchivoIdempotencia', 'rutaArchivoMetricas', 'rutaCacheHorariosRenfe', 'rutaCacheEstacionesRenfe']);
  const sinCubrir = usadas.filter((k) => !(k in RUTAS_DATOS_TENANT) && !excluidas.has(k));
  assert.deepEqual(sinCubrir, [], 'toda ruta personal nueva debe mapearse o excluirse explicitamente');
});

test('clasificacion por impacto: TODO el catalogo real clasificado, sin duplicados ni nombres obsoletos', async () => {
  const R = await import('../../src/services/rbacService.js');
  const todos = Object.values(R.CLASIFICACION_HERRAMIENTAS).flat();
  assert.equal(new Set(todos).size, todos.length, 'una herramienta, una clase');
  const sinClase = [...NOMBRES_HERRAMIENTAS_JARVIS].filter((h) => !R.claseDeHerramienta(h));
  assert.deepEqual(sinClase, [], 'toda herramienta del catalogo debe clasificarse (una nueva sin clase falla aqui y se deniega en runtime)');
  const obsoletas = todos.filter((h) => !NOMBRES_HERRAMIENTAS_JARVIS.has(h) && h !== 'confirm_bash_otp');
  assert.deepEqual(obsoletas, []);
  assert.deepEqual([...R.CLASES_APTAS_TENANT].sort(), ['datos_tenant', 'sin_estado']);
});

test('lista blanca con TODO el catalogo: un tenant solo ejecuta clases aptas; host/credenciales/identidad/terceros/sistema/datos sin aislar, NUNCA', async () => {
  const R = await import('../../src/services/rbacService.js');
  const todos = [...NOMBRES_HERRAMIENTAS_JARVIS];
  const nunca = {
    host: ['execute_bash_command', 'manage_tunnel', 'trigger_encrypted_backup', 'get_infrastructure_status', 'encender_pc', 'controlar_domotica', 'crear_backup_sesion', 'capturar_pagina', 'descargar_multimedia', 'resumir_enlace'],
    credenciales: ['generate_crypto_credential', 'revisar_pr', 'actividad_repos', 'configurar_alertas_repos'],
    identidad: ['activar_modo_vip', 'agregar_contacto_vip', 'estado_modo_vip', 'ejecutar_skill', 'proponer_skill'],
    terceros: ['programar_mensaje_whatsapp', 'enviar_contacto_vcard', 'crear_encuesta_whatsapp', 'resumir_grupo', 'buscar_en_historial'],
    global_sistema: ['configurar_radar_ofertas', 'vigilar_producto', 'crear_recordatorio', 'programar_snooze', 'vigilar_ruta', 'configurar_modo_nocturno'],
    datos_propietario: ['registrar_gasto', 'guardar_nota_personal', 'leer_diario', 'preguntar_documentos', 'registrar_candidatura']
  };
  for (const [clase, lista] of Object.entries(nunca)) {
    for (const h of lista) {
      assert.equal(R.claseDeHerramienta(h), clase, `${h} es ${clase}`);
      const r = R.puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS, permitidasUsuario: todos, rolDe: () => 'usuario' });
      assert.equal(r.permitido, false, `${h} denegada aunque este en la lista blanca`);
    }
  }
  const permitidas = todos.filter((h) => R.puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS, permitidasUsuario: todos, rolDe: () => 'usuario' }).permitido);
  assert.deepEqual(permitidas.sort(), todos.filter((h) => R.CLASES_APTAS_TENANT.includes(R.claseDeHerramienta(h))).sort());
  assert.ok(permitidas.length > 0 && permitidas.length < todos.length / 2);
  // desconocida/nueva sin clasificar: denegada incluso si el catalogo la contuviera
  const nueva = new Set([...NOMBRES_HERRAMIENTAS_JARVIS, 'herramienta_nueva_x']);
  assert.equal(R.puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: 'herramienta_nueva_x', catalogo: nueva, permitidasUsuario: ['herramienta_nueva_x'], rolDe: () => 'usuario' }).motivo, 'sin_clasificar');
  // propietario intacto: todas
  for (const h of todos) assert.equal(R.puedeEjecutarHerramienta({ tenantId: undefined, herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS }).permitido, true);
  // sin lista blanca (defecto vacio): nada
  assert.equal(todos.filter((h) => R.puedeEjecutarHerramienta({ tenantId: 'sint-a', herramienta: h, catalogo: NOMBRES_HERRAMIENTAS_JARVIS, rolDe: () => 'usuario' }).permitido).length, 0);
});
