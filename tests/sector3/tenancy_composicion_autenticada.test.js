// Adaptador sintético autenticado (HMAC), repositorios/control/processor/agent
// reales, sin gate público abierto ni canal/identidad real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'tenant-auth-'));process.env.DAVIS_DATA_DIR=DIR;
const { abrirBaseDatos }=await import('../../src/adapters/outbound/persistence/sqlite/connection.js');
const { ejecutarMigraciones }=await import('../../src/adapters/outbound/persistence/sqlite/migraciones.js');
const { crearSqliteTenantRepository }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js');
const { crearSqliteLimitesStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js');
const { crearAccesoTenants }=await import('../../src/composition/tenantAccess.js');
const { crearMessageProcessor }=await import('../../src/core/messageProcessor.js');
const db=abrirBaseDatos(path.join(DIR,'auth.db'));ejecutarMigraciones(db);
const repo=crearSqliteTenantRepository(db),lim=crearSqliteLimitesStore(db);
for(const id of ['sint-a','sint-b']){repo.registrarTenant({id,nombre:id});repo.vincularIdentidad(id,'fixture','verified-'+id);repo.configurarPermisos(id,['guardar_memoria','listar_memorias']);}
const sign=(id,text)=>createHmac('sha256','clave-sintetica-solo-test').update(id+'|'+text).digest('hex');
const msg=(id,text='hola')=>({userId:id,text,channel:'fixture',metadata:{firma:sign(id,text)}});
const acceso=crearAccesoTenants({tenantRepository:repo,limitesStore:lim,esPropietario:i=>i.canal==='fixture'&&i.identificador==='owner-verificado',autenticar:async m=>{
 if(m.channel!=='fixture'||m.metadata?.firma!==sign(m.userId,m.text))return null;return {canal:m.channel,identificador:m.userId};
}});
async function run(identity,tool,args={},opciones={},beforeTool=null){
 let n=0;const cap=[];
 const p=crearMessageProcessor({accesoTenants:acceso,llmProvider:{nombre:'fixture',chatCompletion:async req=>{
  cap.push(JSON.stringify(req));n++;if(n===1){if(beforeTool)beforeTool();return {model:'fixture',message:{role:'assistant',content:'',tool_calls:[{id:'x',function:{name:tool,arguments:args}}]}};}return {model:'fixture',message:{role:'assistant',content:'ok'}};
 }}});
 const response=await p.procesarMensajeEnAmbito(msg(identity),{historial:[{role:'user',content:'HISTORIAL-OWNER-SIN-AMBITO'}],opciones});
 return {response,cap:cap.join('\n')};
}
test('identidad verificada A/B: tools reales escriben propios; tenant/rol/permisos/chat/rutas falsos de opciones no ganan',async()=>{
 await run('owner-verificado','guardar_memoria',{sujeto:'owner-secreto',dato:'OWNER-PRIVADO'});
 await run('verified-sint-b','guardar_memoria',{sujeto:'b-secreto',dato:'B-PRIVADO'});
 const attack={tenantId:'propietario',chatId:'chat-owner',rolDeTenant:()=> 'propietario',permitidasUsuario:['execute_bash_command'],permisosDeTenant:()=> ['execute_bash_command'],controlUso:{autorizar:()=>({permitido:true})},rutaArchivoMemorias:path.join(DIR,'brain_memory.json')};
 await run('verified-sint-a','guardar_memoria',{sujeto:'a-propio',dato:'A-PROPIO'},attack);
 const a=fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8');assert.match(a,/A-PROPIO/);assert.ok(!a.includes('OWNER-PRIVADO')&&!a.includes('B-PRIVADO'));
 const r=await run('verified-sint-a','listar_memorias',{},attack);assert.match(r.cap,/A-PROPIO/);for(const secret of ['OWNER-PRIVADO','B-PRIVADO','HISTORIAL-OWNER-SIN-AMBITO'])assert.ok(!r.cap.includes(secret));
});
test('publico sigue cerrado con identidad válida; no autenticado/desconocido no hereda propietario ni crea tenants',async()=>{
 let calls=0;const p=crearMessageProcessor({accesoTenants:acceso,llmProvider:{nombre:'fixture',chatCompletion:async()=>{calls++;return {message:{content:'NO'}};}}});
 const before=db.prepare('SELECT count(*) n FROM tenants').get().n;
 assert.match(await p.procesarMensajeEntrante(msg('verified-sint-a')),/Acceso no disponible/);
 const bad=msg('verified-sint-a');bad.metadata={firma:'falsa',tenantId:'propietario',rol:'propietario'};
 assert.match(await p.procesarMensajeEnAmbito(bad,{opciones:{tenantId:'propietario'}}),/Acceso no disponible/);
 assert.match(await p.procesarMensajeEnAmbito(msg('desconocido')),/Acceso no disponible/);
 assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) n FROM tenants').get().n,before);
});
test('permisos son durables y failclosed: host/desconocidos rechazados al configurar; retirada/suspension se releen',async()=>{
 assert.throws(()=>repo.configurarPermisos('sint-a',['execute_bash_command']),/catalogo apto/);
 assert.throws(()=>repo.configurarPermisos('sint-a',['tool-nueva']),/catalogo apto/);
 const another=abrirBaseDatos(path.join(DIR,'auth.db'));const r2=crearSqliteTenantRepository(another);
 assert.deepEqual(r2.leerPermisos('sint-a'),['guardar_memoria','listar_memorias']);r2.configurarPermisos('sint-a',[]);
 const denied=await run('verified-sint-a','guardar_memoria',{sujeto:'DENEGADO',dato:'NO-ESCRIBIR'});
 assert.ok(!fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8').includes('NO-ESCRIBIR'));
 r2.configurarPermisos('sint-a',['guardar_memoria','listar_memorias']);r2.establecerEstado('sint-a','suspendido');
 assert.match((await run('verified-sint-a','listar_memorias')).response,/Acceso no disponible/);r2.establecerEstado('sint-a','activo');another.close();
});
test('revocacion de permiso durante espera del modelo bloquea tool antes del efecto',async()=>{
 await run('verified-sint-a','guardar_memoria',{sujeto:'REVOCADO',dato:'NO-REVOCADO'}, {},()=>repo.configurarPermisos('sint-a',[]));
 assert.ok(!fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8').includes('NO-REVOCADO'));repo.configurarPermisos('sint-a',['guardar_memoria','listar_memorias']);
});

test('composicion autenticada conserva cuota SQLite propia y no permite sustituir controlador desde opciones',async()=>{
 lim.configurar('sint-a',{tokensDia:10});let calls=0;
 const { crearSqliteUsageStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js');
 const { registrarStoreUsoPorDefecto }=await import('../../src/services/usageLedgerService.js');const uso=crearSqliteUsageStore(db);registrarStoreUsoPorDefecto(uso);
 const p=crearMessageProcessor({accesoTenants:acceso,llmProvider:{nombre:'fixture',chatCompletion:async()=>{calls++;return {model:'fixture',usage:{prompt_tokens:7,completion_tokens:3},message:{role:'assistant',content:'ok'}};}}});
 try{
  const ataque={opciones:{tenantId:'propietario',controlUso:{autorizar:()=>({permitido:true})}}};
  await p.procesarMensajeEnAmbito(msg('verified-sint-a','hola'),ataque);assert.equal(calls,1);
  assert.match(await p.procesarMensajeEnAmbito(msg('verified-sint-a','hola otra vez'),ataque),/Limite de uso/);assert.equal(calls,1);
  assert.equal(uso.rango('sint-a','2000-01-01','2100-12-31').entrada,7);assert.equal(uso.rango('propietario','2000-01-01','2100-12-31').entrada,0);
 }finally{registrarStoreUsoPorDefecto(null);lim.quitar('sint-a');}
});
