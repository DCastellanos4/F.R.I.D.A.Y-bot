// LOCAL RNF-04 regression. Fake LLM/tool, in-memory DB, no live side effects.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {crearWorkerAgente} from '../../src/workers/agentWorker.js';
import {crearAuditLogService,canonizar} from '../../src/security/auditLogService.js';
import {crearPiiAnonymizer} from '../../src/security/piiAnonymizerService.js';
import {ejecutarMigraciones} from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {consultarJarvisAislado} from '../helpers/jarvisAislado.js';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function workerFixture({audit,processor}) {
 let handle,response;const marks=[];
 const cola={publicar(){},consumir(fn){handle=fn;},cerrar(){}};
 const store={ultimoCheckpoint(){return null;},guardarCheckpoint(id,ronda,estado){marks.push(estado);},encolarRespuesta(r){response=r;}};
 const worker=crearWorkerAgente({cola,outboxStore:store,auditoria:audit,procesar:processor});worker.iniciar();
 return {run:()=>handle({id:'synthetic-job',tipo:'mensaje_entrante',tenantId:'propietario',canal:'api',payload:{userId:'synthetic',text:'ejecuta la herramienta solicitada',channel:'api'}}),get response(){return response;},marks};
}
function fakeChat(tool,args={}) {let calls=0;return async()=>({message:++calls===1?{content:'',tool_calls:[{id:'t1',function:{name:tool,arguments:JSON.stringify(args)}}]}:{content:'respuesta sintetica final'}});}
function coreProcessor({tool='consultar_clima',execute,hookSeen,extra={}}={}) {
 return async(inbound,{opciones})=>consultarJarvisAislado(inbound.text,[],{...opciones,chatId:'audit-'+Math.random(),chatCompletion:fakeChat(tool),ejecutores:{[tool]:execute},...extra,onResultadoHerramienta:async event=>{hookSeen?.push(event);await opciones.onResultadoHerramienta(event);}});
}
test('real core wrapper to worker hashes returned PII response, not raw; chain intact',async()=>{
 const db=new Database(':memory:');ejecutarMigraciones(db);const audit=crearAuditLogService(db);const seen=[];let calls=0;
 const f=workerFixture({audit,processor:coreProcessor({execute:async()=>{calls++;return 'telefono 612 34 56 78 SENTINEL_RESPONSE';},hookSeen:seen})});
 await f.run();assert.equal(calls,1);assert.equal(seen.length,1);assert.equal(seen[0].estado,'retorno');
 const rows=db.prepare('SELECT * FROM audit_herramientas').all();assert.equal(rows.length,1);assert.equal(rows[0].herramienta,'consultar_clima');assert.ok(rows[0].respuesta_sha256);
 const canon=canonizar({fase:'post_wrapper',estado:'retorno',valor:seen[0].respuesta});const anon=crearPiiAnonymizer().anonimizar(canon).texto;
 assert.notEqual(rows[0].respuesta_sha256,sha(canon));assert.equal(rows[0].respuesta_sha256,sha(anon));assert.equal(JSON.stringify(rows).includes('SENTINEL_RESPONSE'),false);assert.equal(JSON.stringify(rows).includes('612 34 56 78'),false);assert.equal(audit.verificarCadena().ok,true);db.close();
});
test('prior durable intent preserved; result is a distinct row after invocation',async()=>{
 const db=new Database(':memory:');ejecutarMigraciones(db);const audit=crearAuditLogService(db);const order=[];
 const f=workerFixture({audit:{registrar(row){order.push(row.respuesta?'result':'intent');return audit.registrar(row);}},processor:coreProcessor({tool:'anotar_idea',execute:async()=>{order.push('tool');return 'sintetico';}})});
 await f.run();assert.deepEqual(order,['intent','tool','result']);assert.ok(f.marks.some(m=>m.accionesPlanificadas?.length));
 const rows=db.prepare('SELECT * FROM audit_herramientas').all();assert.equal(rows.length,2);assert.equal(rows[0].respuesta_sha256,null);assert.ok(rows[1].respuesta_sha256);assert.equal(audit.verificarCadena().ok,true);db.close();
});
test('audit failure after tool does not retry tool; response exposes degraded metadata without error text',async()=>{
 let calls=0;const f=workerFixture({audit:{registrar(){throw new Error('PRIVATE_AUDIT_SENTINEL');}},processor:coreProcessor({execute:async()=>{calls++;return 'ok';}})});
 await f.run();assert.equal(calls,1);assert.equal(f.response.payload.auditoriaResultados,'degradada');assert.equal(f.response.payload.fallosAuditoriaResultados,1);assert.equal(JSON.stringify(f.response).includes('PRIVATE_AUDIT_SENTINEL'),false);
});
test('tool exception is labeled error without retaining exception text or claiming no effect',async()=>{
 const events=[];const f=workerFixture({audit:{registrar(row){events.push(row);}},processor:coreProcessor({execute:async()=>{throw new Error('PRIVATE_TOOL_SENTINEL');}})});
 await f.run();const results=events.filter(e=>e.respuesta);assert.equal(results.length,1);assert.equal(results[0].respuesta.estado,'error');assert.deepEqual(results[0].respuesta.valor,{clase:'ERROR_HERRAMIENTA_EFECTO_NO_VERIFICADO'});assert.equal(JSON.stringify(results).includes('PRIVATE_TOOL_SENTINEL'),false);
});
test('unknown emitted tool names are never persisted as supplied',async()=>{
 const events=[];const f=workerFixture({audit:{registrar(row){events.push(row);}},processor:coreProcessor({tool:'PRIVATE_NAME_SENTINEL',execute:async()=> 'sintetico'})});
 await f.run();assert.equal(events.filter(e=>e.respuesta).length,1);assert.equal(events.filter(e=>e.respuesta)[0].herramienta,'desconocida');
 // Intent-audit legacy remains separate; this assertion is specifically the new hook.
 assert.equal(JSON.stringify(events.filter(e=>e.respuesta)).includes('PRIVATE_NAME_SENTINEL'),false);
});
test('no auditor configured preserves behavior and creates no outcome degradation',async()=>{
 let calls=0;const f=workerFixture({processor:coreProcessor({execute:async()=>{calls++;return 'ok';}})});await f.run();assert.equal(calls,1);assert.equal(f.response.payload.auditoriaResultados,undefined);
});
test('same actual result twice is two audit events, not falsely deduplicated',async()=>{
 const rows=[];const f=workerFixture({audit:{registrar(r){rows.push(r);}},processor:async(inbound,{opciones})=>{for(let n=0;n<2;n++)opciones.onResultadoHerramienta({herramienta:'consultar_clima',args:{},estado:'retorno',respuesta:{texto:'ok'}});return 'ok';}});await f.run();assert.equal(rows.length,2);
});
test('denied result category is persisted as a labeled outcome, not successful effect',async()=>{
 const rows=[];const f=workerFixture({audit:{registrar(r){rows.push(r);}},processor:async(inbound,{opciones})=>{opciones.onResultadoHerramienta({herramienta:'consultar_clima',args:{},estado:'acceso_denegado',respuesta:{texto:'denegado'}});return 'denegado';}});await f.run();assert.equal(rows[0].respuesta.estado,'acceso_denegado');
});
test('actual wrapper denial branch labels access_denied and never invokes executor',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../../src/core/jarvisAgent.js',import.meta.url),'utf8');const start=source.indexOf('async function ejecutarHerramientaJarvis(');const end=source.indexOf('\nasync function ejecutarHerramientaJarvisInterna(',start);assert.ok(start>=0&&end>start);
 let executed=0;const events=[];
 const wrapper=runInNewContext(source.slice(start,end)+'\nejecutarHerramientaJarvis',{
  verificarArbolTenant(){},DATA_DIR_TENANCY:'synthetic',NOMBRES_HERRAMIENTAS_JARVIS:new Set(['consultar_clima']),
  puedeEjecutarHerramienta(){return {permitido:false,motivo:'no_en_lista_blanca'};},registrarFinTool(){},
  ejecutarHerramientaJarvisInterna(){executed++;},Date,conSpan(){throw new Error('must not execute');}
 });
 const result=await wrapper('consultar_clima',{}, {onResultadoHerramienta:event=>events.push(event)});
 assert.equal(executed,0);assert.equal(events.length,1);assert.equal(events[0].estado,'acceso_denegado');assert.equal(events[0].respuesta,result);
});
test('actual wrapper swallows a rejected outcome hook after a returned tool without executing twice',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../../src/core/jarvisAgent.js',import.meta.url),'utf8');const start=source.indexOf('async function ejecutarHerramientaJarvis(');const end=source.indexOf('\nasync function ejecutarHerramientaJarvisInterna(',start);
 let executed=0;const wrapper=runInNewContext(source.slice(start,end)+'\nejecutarHerramientaJarvis',{
  verificarArbolTenant(){},DATA_DIR_TENANCY:'synthetic',NOMBRES_HERRAMIENTAS_JARVIS:new Set(['consultar_clima']),
  puedeEjecutarHerramienta(){return {permitido:true};},registrarFinTool(){},
  ejecutarHerramientaJarvisInterna(){executed++;return {texto:'synthetic'};},Date,conSpan:async(n,a,fn)=>fn()
 });
 const result=await wrapper('consultar_clima',{}, {onResultadoHerramienta:async()=>{throw new Error('AUDIT_PRIVATE_SENTINEL');}});
 assert.equal(executed,1);assert.equal(result.texto,'synthetic');
});
