// Adversarial offline: filesystem real, enlaces a propietario/B, puerto de
// compatibilidad por segundo argumento. Sin red, usuarios reales ni gate abierto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-adversarial-'));
process.env.DAVIS_DATA_DIR = DIR;
const { consultarJarvis, consultarJarvisEnAmbito } = await import('../../src/core/jarvisAgent.js');
const controlUso = { autorizar: () => ({ permitido: true }) };
const owner = path.join(DIR, 'brain_memory.json');
const mem = [{ id: 'o1', sujeto: 'tesoro azul', dato: 'tesoro azul SECRETO-OWNER-LINK', categoria: 'general', tags: [], fechaRegistro: '2026-01-01T00:00:00Z' }];
fs.writeFileSync(owner, JSON.stringify(mem));
function reset() { fs.rmSync(path.join(DIR, 'tenants'), { recursive: true, force: true }); fs.mkdirSync(path.join(DIR, 'tenants', 'sint-a'), { recursive: true }); fs.writeFileSync(owner, JSON.stringify(mem)); }
function stub(cap, tool = null) {
 let n = 0;
 return async (p) => { cap.push(JSON.stringify(p)); n++; return { model: 'stub', message: tool && n === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'a1', function: tool }] } : { role: 'assistant', content: 'ok' } }; };
}

test('gate publico tambien rechaza tenant pasado en segundo argumento legacy', async () => {
 const cap = [];
 const r = await consultarJarvis('tesoro azul', { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
 assert.equal(cap.length, 0); assert.match(String(r), /Acceso no disponible/);
});

test('read/RAG: fichero memoria symlink al propietario se rechaza antes del LLM', async () => {
 reset(); fs.symlinkSync(owner, path.join(DIR, 'tenants', 'sint-a', 'brain_memory.json'));
 const cap = [];
 const r = await consultarJarvisEnAmbito('tesoro azul', [], { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
 assert.equal(cap.length, 0); assert.match(String(r), /almacenamiento/i);
});

test('write: guardar_memoria nunca sigue symlink hacia archivo propietario', async () => {
 reset(); fs.symlinkSync(owner, path.join(DIR, 'tenants', 'sint-a', 'brain_memory.json'));
 const antes = fs.readFileSync(owner, 'utf8'); const cap = [];
 await consultarJarvisEnAmbito('guarda el dato', [], { tenantId: 'sint-a', controlUso, rolDeTenant: () => 'usuario', permitidasUsuario: ['guardar_memoria'], chatCompletion: stub(cap, { name: 'guardar_memoria', arguments: { sujeto: 'ajeno', dato: 'DATO-INTRUSO' } }) });
 assert.equal(fs.readFileSync(owner, 'utf8'), antes); assert.equal(cap.length, 0);
});

test('directorio tenant enlazado al propietario o a B: no sigue el enlace', async () => {
 for (const target of [DIR, path.join(DIR, 'otro-b')]) {
  reset(); fs.mkdirSync(target, { recursive: true }); fs.rmSync(path.join(DIR, 'tenants', 'sint-a'), { recursive: true });
  fs.symlinkSync(target, path.join(DIR, 'tenants', 'sint-a'));
  const cap = [];
  await consultarJarvisEnAmbito('tesoro azul', [], { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
  assert.equal(cap.length, 0);
 }
});

test('nota symlink a secreto ajeno: no llega al ranking secundario', async () => {
 reset(); const notas = path.join(DIR, 'tenants', 'sint-a', 'notes', '2026-01-01'); fs.mkdirSync(notas, { recursive: true });
 const ajena = path.join(DIR, 'secreto.md'); fs.writeFileSync(ajena, '# tesoro azul\nSECRETO-NOTA-AJENA'); fs.symlinkSync(ajena, path.join(notas, 'x.md'));
 const cap = [];
 await consultarJarvisEnAmbito('busca tesoro azul', [], { tenantId: 'sint-a', controlUso, rolDeTenant: () => 'usuario', permitidasUsuario: ['buscar_recuerdo_semantico'], chatCompletion: stub(cap, { name: 'buscar_recuerdo_semantico', arguments: { consulta: 'tesoro azul' } }) });
 assert.equal(cap.length, 0);
});

test('legacy interno se normaliza antes de control de uso y aislamiento; owner ambas firmas sin cambios', async () => {
 reset(); const cap = [];
 const r = await consultarJarvisEnAmbito('hola', { tenantId: 'sint-a', chatCompletion: stub(cap) });
 assert.match(String(r), /Control de uso/); assert.equal(cap.length, 0);
 await consultarJarvisEnAmbito('tesoro azul', { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap), rutaArchivoMemorias: owner });
 assert.ok(cap.length >= 1); assert.ok(!cap.join('\n').includes('SECRETO-OWNER-LINK'));
 const o = [];
 await consultarJarvis('hola', { chatCompletion: stub(o) });
 await consultarJarvis('hola', [], { chatCompletion: stub(o) });
 assert.ok(o.length >= 2);
});

test('puertos de datos, callbacks e historial sin ambito del owner no se heredan', async () => {
 reset(); let efectos = 0; const cap = [];
 const { aislarOpcionesTenant } = await import('../../src/core/tenancy.js');
 const peligros = { metricasClasificador: { registrar: () => { efectos++; }, leerEventos: () => [] },
  avisarSaludClasificador: () => { efectos++; }, ejecutores: { listar_memorias: () => { efectos++; return 'SECRETO-CALLBACK'; } },
  obtenerNoticiasDeportes: () => { efectos++; return []; }, buscarEnFuenteCompras: () => { efectos++; return []; },
  carpetaEpisodios: DIR, carpetaIndices: DIR, carpetaTrazas: DIR, rutaArchivoIdempotencia: owner,
  memoryRepository: { buscar: () => { efectos++; return mem; } }, datosNuevosNoClasificados: 'SECRETO-OPCION' };
 const clean = aislarOpcionesTenant({ tenantId: 'sint-a', ...peligros }, DIR);
 for (const k of ['metricasClasificador','avisarSaludClasificador','ejecutores','obtenerNoticiasDeportes','buscarEnFuenteCompras','memoryRepository','datosNuevosNoClasificados']) assert.equal(clean[k], undefined, k);
 for (const k of ['carpetaEpisodios','carpetaIndices','carpetaTrazas','rutaArchivoIdempotencia']) assert.ok(clean[k].startsWith(path.join(DIR,'tenants','sint-a') + path.sep), k);
 await consultarJarvisEnAmbito('lista mis memorias', [{ role: 'user', content: 'HISTORIAL-OWNER-INYECTADO' }], {
  tenantId: 'sint-a', controlUso, chatCompletion: stub(cap, { name: 'listar_memorias', arguments: {} }), rolDeTenant: () => 'usuario', permitidasUsuario: ['listar_memorias'], ...peligros
 });
 assert.equal(efectos, 0); assert.ok(!cap.join('\n').includes('HISTORIAL-OWNER-INYECTADO')); assert.ok(!cap.join('\n').includes('SECRETO-CALLBACK'));
});

test('vecinos directos URL/trenes no saltan RBAC ni usan red/LLM para tenant', async () => {
 reset(); const cap = [];
 for (const m of ['https://example.com/', 'resume https://example.com/', 'salidas de trenes desde Atocha']) {
  const r = await consultarJarvisEnAmbito(m, [], { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
  assert.match(String(r), /Capacidad no disponible/);
 }
 assert.equal(cap.length, 0);
});

test('hardlink y enlaces en ancestros son rechazados sin borrar/reubicar archivos', async () => {
 reset(); fs.linkSync(owner, path.join(DIR, 'tenants','sint-a','brain_memory.json'));
 const cap = []; await consultarJarvisEnAmbito('tesoro azul', [], { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
 assert.equal(cap.length, 0); assert.ok(fs.existsSync(owner));
 reset(); fs.rmSync(path.join(DIR,'tenants'), { recursive: true }); const alt = fs.mkdtempSync(path.join(os.tmpdir(),'alt-tenants-')); fs.mkdirSync(path.join(alt,'sint-a'));
 fs.symlinkSync(alt,path.join(DIR,'tenants'));
 await consultarJarvisEnAmbito('tesoro azul', [], { tenantId: 'sint-a', controlUso, chatCompletion: stub(cap) });
 assert.equal(cap.length, 0); assert.ok(fs.lstatSync(path.join(DIR,'tenants')).isSymbolicLink());
});

test('open final con O_NOFOLLOW y fstat: lectura/escritura rechazan enlaces; no truncan hardlink', async () => {
 reset(); const { default: safe } = await import('../../src/security/tenantFileSystem.js');
 const p = path.join(DIR,'tenants','sint-a','dato.json'); fs.writeFileSync(p, 'contenido-propio');
 assert.equal(safe.readFileSync(p,'utf8'),'contenido-propio'); safe.writeFileSync(p,'nuevo','utf8'); assert.equal(fs.readFileSync(p,'utf8'),'nuevo');
 fs.unlinkSync(p); fs.symlinkSync(owner,p);
 assert.throws(() => safe.readFileSync(p,'utf8'),/tenant/); assert.throws(() => safe.writeFileSync(p,'AJENO','utf8'),/tenant/);
 fs.unlinkSync(p); fs.linkSync(owner,p); const antes = fs.readFileSync(owner,'utf8');
 assert.throws(() => safe.writeFileSync(p,'AJENO','utf8'),/tenant/); assert.equal(fs.readFileSync(owner,'utf8'), antes);
 fs.unlinkSync(p); fs.writeFileSync(p,'original');
 const open = fs.openSync; let flagsVistos;
 fs.openSync = (f, flags, ...rest) => { if (f === p) flagsVistos = flags; return open(f,flags,...rest); };
 try { safe.readFileSync(p,'utf8'); assert.ok((flagsVistos & fs.constants.O_NOFOLLOW) !== 0); } finally { fs.openSync = open; }
});

test('enlace introducido durante espera del modelo se rechaza antes de tool write', async () => {
 reset(); const antes = fs.readFileSync(owner,'utf8'); let n=0;
 await consultarJarvisEnAmbito('guarda el dato', [], { tenantId:'sint-a', controlUso, rolDeTenant:()=> 'usuario', permitidasUsuario:['guardar_memoria'], chatCompletion: async () => {
  n++; if(n===1) { fs.symlinkSync(owner,path.join(DIR,'tenants','sint-a','brain_memory.json')); return { model:'stub', message:{ role:'assistant',content:'', tool_calls:[{ id:'x',function:{ name:'guardar_memoria',arguments:{sujeto:'x',dato:'ajeno'} } }] } }; }
  return { model:'stub',message:{content:'ok'} };
 } });
 assert.equal(fs.readFileSync(owner,'utf8'),antes); assert.equal(n,1);
});

test('modelo tenant no recibe inventario/configuracion owner ni herramientas fuera de sus permisos', async () => {
 reset(); const cap=[];
 await consultarJarvisEnAmbito('busca mis recuerdos',[],{tenantId:'sint-a',controlUso,rolDeTenant:()=> 'usuario',permitidasUsuario:['buscar_memoria'],chatCompletion:stub(cap)});
 const peticiones=cap.map(x=>JSON.parse(x));const principal=peticiones.find(x=>(x.messages||[]).some(m=>m.role==='system'&&m.content.includes('RECUERDOS DE ESTE USUARIO')||m.role==='system'&&m.content.includes('asistente personal para este usuario')));
 assert.ok(principal,'prompt tenant propio no vacuo');
 const system=principal.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
 for(const texto of ['CONFIGURACION PENDIENTE','Home Assistant','qBittorrent','diagnostico_davis','Tony Stark']) assert.ok(!system.includes(texto),texto);
 for(const h of principal.tools||[]) assert.equal(h.function.name,'buscar_memoria');
});

test('cache de clasificacion se separa por tenant, sin heredar resultados ni saltar su modelo',async()=>{
 const { clasificarIntencionConModelo,limpiarCacheClasificaciones }=await import('../../src/core/intentRouterService.js');limpiarCacheClasificaciones();let a=0,b=0;
 const msg='identico mensaje sintetico de cache';
 const ra=await clasificarIntencionConModelo(msg,{tenantId:'sint-a',chatCompletion:async()=>{a++;return {message:{content:'{"intencion":"conversacion","confianza":0.99}'}};}});
 const rb=await clasificarIntencionConModelo(msg,{tenantId:'sint-b',chatCompletion:async()=>{b++;return {message:{content:'{"intencion":"conversacion","confianza":0.99}'}};}});
 assert.ok(ra&&rb);assert.equal(a,1);assert.equal(b,1);assert.equal(rb.origen,'modelo');limpiarCacheClasificaciones();
});
