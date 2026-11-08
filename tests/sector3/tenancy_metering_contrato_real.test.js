// Recorre SDK HTTP real -> llmService -> adaptador -> agente -> ledger/control
// SQLite. Solo el servidor del proveedor es un fixture local, sin red externa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'metering-real-'));
process.env.NODE_ENV='test';process.env.DAVIS_DATA_DIR=DIR;
const { config }=await import('../../src/config/config.js');
const { resetClients,reiniciarCircuitoModelos,normalizarUsoProveedor }=await import('../../src/core/llmService.js');
const { crearLLMServiceProviderAdapter }=await import('../../src/adapters/outbound/llm/llmServiceProviderAdapter.js');
const { consultarJarvisEnAmbito }=await import('../../src/core/jarvisAgent.js');
const { registrarStoreUsoPorDefecto }=await import('../../src/services/usageLedgerService.js');
const { abrirBaseDatos }=await import('../../src/adapters/outbound/persistence/sqlite/connection.js');
const { ejecutarMigraciones }=await import('../../src/adapters/outbound/persistence/sqlite/migraciones.js');
const { crearSqliteTenantRepository }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js');
const { crearSqliteUsageStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js');
const { crearSqliteLimitesStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js');
let script=[],requests=[];
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body:JSON.parse(body)});
 const step=script.shift();assert.ok(step,'transporte inesperado');
 res.writeHead(step.status||200,{'content-type':'application/json',...(step.headers||{})});
 res.end(JSON.stringify(step.data));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const original={...config.llm};
after(async()=>{Object.assign(config.llm,original);resetClients();registrarStoreUsoPorDefecto(null);await new Promise(r=>server.close(r));});
function cloud(content='ok',usage={prompt_tokens:7,completion_tokens:3},tool=null){return {data:{id:'fixture-local',model:'fixture-model',choices:[{message:{role:'assistant',content, ...(tool?{tool_calls:[{id:'t1',type:'function',function:{name:tool,arguments:JSON.stringify({fallo:'error publico',contexto:'codigo publico'})}}]}:{})},finish_reason:tool?'tool_calls':'stop'}],...(usage===null?{}:{usage})}};}
function setup(provider='openai'){
 script=[];requests=[];resetClients();reiniciarCircuitoModelos();
 Object.assign(config.llm,{provider,apiKey:'test-only-not-a-secret',baseUrl:base+'/v1',model:'fixture-model',ollamaHost:base,ollamaModel:'fixture-ollama'});
 const file=path.join(DIR,'state-'+Math.random()+'.db');const db=abrirBaseDatos(file);ejecutarMigraciones(db);
 const repo=crearSqliteTenantRepository(db);repo.registrarTenant({id:'sint-a',nombre:'A'});repo.registrarTenant({id:'sint-b',nombre:'B'});
 const uso=crearSqliteUsageStore(db),lim=crearSqliteLimitesStore(db),llmProvider=crearLLMServiceProviderAdapter();registrarStoreUsoPorDefecto(uso);
 return {db,file,uso,lim,llmProvider,opts:{tenantId:'sint-a',controlUso:lim,llmProvider,rolDeTenant:()=> 'usuario',permitidasUsuario:['guiar_depuracion']}};
}
const total=(uso,id='sint-a')=>uso.rango(id,'2000-01-01','2100-12-31');

test('contrato HTTP nube real/adaptador/SQLite: registra exacto, cuota diaria y mensual detienen siguiente proveedor',async()=>{
 for(const quota of [{tokensDia:10},{tokensMes:10}]){
  const x=setup();x.lim.configurar('sint-a',quota);script.push(cloud());
  try{
   await consultarJarvisEnAmbito('hola',[],x.opts);
   assert.deepEqual(total(x.uso),{entrada:7,salida:3,llamadas:1});assert.equal(requests.length,1);assert.equal(requests[0].url,'/v1/chat/completions');
   assert.equal(x.db.prepare('SELECT count(*) n FROM tenant_medicion_pendiente').get().n,0);
   assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Limite de uso/);assert.equal(requests.length,1);
   assert.deepEqual(total(x.uso,'sint-b'),{entrada:0,salida:0,llamadas:0});assert.deepEqual(total(x.uso,'propietario'),{entrada:0,salida:0,llamadas:0});
  }finally{x.db.close();}
 }
});
test('contrato HTTP Ollama real/adaptador normaliza prompt_eval_count/eval_count sin estimar',async()=>{
 const x=setup('ollama');x.lim.configurar('sint-a',{tokensDia:10});
 script.push({data:{model:'fixture-ollama',message:{role:'assistant',content:'ok'},done:true,prompt_eval_count:8,eval_count:2}});
 try{await consultarJarvisEnAmbito('hola',[],x.opts);assert.deepEqual(total(x.uso),{entrada:8,salida:2,llamadas:1});assert.equal(requests[0].url,'/api/chat');assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Limite de uso/);assert.equal(requests.length,1);}finally{x.db.close();}
});
test('secundario real guiar_depuracion usa adaptador, se mide y bloquea sintesis posterior',async()=>{
 const x=setup();x.lim.configurar('sint-a',{tokensDia:20});script.push(cloud('',{prompt_tokens:7,completion_tokens:3},'guiar_depuracion'),cloud('guia publica'));
 try{await consultarJarvisEnAmbito('hola',[],x.opts);assert.equal(requests.length,2);assert.ok(requests[1].body.messages.some(m=>m.content.includes('Modo pair programming')));assert.deepEqual(total(x.uso),{entrada:14,salida:6,llamadas:2});assert.equal(script.length,0);}finally{x.db.close();}
});
test('usage ausente/incompleto/invalido: no inventa cero, bloqueo durable tras abrir otra conexion',async()=>{
 for(const usage of [null,{prompt_tokens:3},{prompt_tokens:-1,completion_tokens:2},{prompt_tokens:'7',completion_tokens:3}]){
  const x=setup();x.lim.configurar('sint-a',{tokensDia:100});script.push(cloud('respuesta sin contabilidad',usage));
  try{
   assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Control de uso/);assert.equal(requests.length,1);assert.deepEqual(total(x.uso),{entrada:0,salida:0,llamadas:0});
   const otra=abrirBaseDatos(x.file);const control=crearSqliteLimitesStore(otra);
   assert.equal(control.autorizar({tenantId:'sint-a'}).motivo,'medicion_pendiente');
   assert.match(await consultarJarvisEnAmbito('hola otra',[],{...x.opts,controlUso:control}),/Control de uso/);assert.equal(requests.length,1);otra.close();
  }finally{x.db.close();}
 }
});
test('error ledger: marcador previo persiste y deniega otra llamada; owner sin usage conserva respuesta',async()=>{
 const x=setup();x.lim.configurar('sint-a',{tokensDia:100});script.push(cloud());registrarStoreUsoPorDefecto({registrar(){throw new Error('disk error fixture');}});
 try{
  assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Control de uso/);assert.equal(x.lim.autorizar({tenantId:'sint-a'}).motivo,'medicion_pendiente');assert.equal(requests.length,1);
  script.push(cloud('respuesta owner intacta',null));const r=await consultarJarvisEnAmbito('hola',[],{llmProvider:x.llmProvider,controlUso:x.lim});assert.match(r,/respuesta owner intacta/);assert.equal(requests.length,2);
 }finally{x.db.close();}
});
test('contador cero reportado es valido; contador no reportado no lo es',()=>{
 assert.deepEqual(normalizarUsoProveedor({usage:{prompt_tokens:0,completion_tokens:0}},'openai'),{prompt_tokens:0,completion_tokens:0});
 assert.equal(normalizarUsoProveedor({usage:{total_tokens:7}},'openai'),null);
});

test('reintento HTTP real: solo conteo final conocido, sin retries SDK ocultos; cuota queda pendiente por intento sin usage',async()=>{
 const x=setup();x.lim.configurar('sint-a',{tokensDia:100});
 script.push({status:500,headers:{'retry-after':'0'},data:{error:{message:'fixture temporal',type:'server_error'}}},cloud());
 try{
  assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Control de uso/);assert.equal(requests.length,2,'un intento por router, sin triplicar en SDK');
  assert.deepEqual(total(x.uso),{entrada:7,salida:3,llamadas:1},'no inventa coste de intento fallido');
  assert.equal(x.lim.autorizar({tenantId:'sint-a'}).motivo,'medicion_pendiente');
  assert.match(await consultarJarvisEnAmbito('hola de nuevo',[],x.opts),/Control de uso/);assert.equal(requests.length,2);
 }finally{x.db.close();}
});
test('error HTTP final conserva marcador; owner no se bloquea por marcador de otro tenant',async()=>{
 const x=setup();x.lim.configurar('sint-a',{tokensMes:100});
 script.push({status:400,data:{error:{message:'fixture invalid request',type:'invalid_request_error'}}});
 try{
  assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/Control de uso/);assert.equal(requests.length,1);assert.equal(x.lim.autorizar({tenantId:'sint-a'}).motivo,'medicion_pendiente');
  script.push(cloud('owner permitido'));assert.match(await consultarJarvisEnAmbito('hola',[],{...x.opts,tenantId:'propietario'}),/owner permitido/);
 }finally{x.db.close();}
});
test('sin cuota tokens no introduce bloqueo ni marker por usage ausente, incluso con rate configurado',async()=>{
 const x=setup();x.lim.configurar('sint-a',{peticionesMinuto:10});script.push(cloud('sin limite tokens',null));
 try{assert.match(await consultarJarvisEnAmbito('hola',[],x.opts),/sin limite tokens/);assert.equal(x.db.prepare('SELECT count(*) n FROM tenant_medicion_pendiente').get().n,0);}finally{x.db.close();}
});
