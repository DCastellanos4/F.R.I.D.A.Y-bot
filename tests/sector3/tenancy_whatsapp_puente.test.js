// Entrada REAL whatsappBot/messages.upsert -> adaptador -> acceso/composicion
// -> agente/servicios/SQLite reales -> socket SINTETICO. Sin red ni alta real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'tenant-wa-'));
process.env.NODE_ENV='test';process.env.DAVIS_PERSISTENCE='sqlite';process.env.DAVIS_SQLITE_PATH=path.join(DIR,'owner.db');process.env.DAVIS_DATA_DIR=DIR;process.env.DAVIS_HISTORY_DIR=path.join(DIR,'hist');
const { procesarMensajesEntrantes }=await import('../../whatsappBot.js');
const { crearPuenteWhatsAppTenants }=await import('../../src/composition/whatsappTenantBridge.js');
const { tenantsHabilitados }=await import('../../src/core/tenancy.js');
const { abrirBaseDatos }=await import('../../src/adapters/outbound/persistence/sqlite/connection.js');
const { ejecutarMigraciones }=await import('../../src/adapters/outbound/persistence/sqlite/migraciones.js');
const { crearSqliteTenantRepository }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteTenantRepository.js');
const { crearSqliteLimitesStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteLimitesStore.js');
const { crearSqliteUsageStore }=await import('../../src/adapters/outbound/persistence/sqlite/sqliteUsageStore.js');
const { registrarStoreUsoPorDefecto }=await import('../../src/services/usageLedgerService.js');
const { crearContenedor }=await import('../../src/composition/container.js');
const ownerContainer=crearContenedor();
ownerContainer.persistencia.memoryStore.guardar([{id:'owner-real',sujeto:'tesoro owner',dato:'SECRETO-OWNER-SQLITE-REAL',categoria:'general',tags:[],fechaRegistro:'2026-01-01'}]);
const ownerBefore=JSON.stringify(ownerContainer.persistencia.memoryStore.leer());
const { setVipMode }=await import('../../src/services/vipFilterService.js');setVipMode(true);
const db=abrirBaseDatos(path.join(DIR,'state.db'));ejecutarMigraciones(db);
const repo=crearSqliteTenantRepository(db),lim=crearSqliteLimitesStore(db),uso=crearSqliteUsageStore(db);
const A='34000000001@s.whatsapp.net',B='900000002@lid',OWNER='149868706304033@lid';
for(const [id,jid]of [['sint-a',A],['sint-b',B]]){repo.registrarTenant({id,nombre:id});repo.vincularIdentidad(id,'whatsapp',jid);repo.configurarPermisos(id,['guardar_memoria','listar_memorias']);}
fs.writeFileSync(path.join(DIR,'brain_memory.json'),JSON.stringify([{id:'o1',sujeto:'tesoro owner',dato:'SECRETO-OWNER-NUNCA'}]));
let plan=null,cap=[],calls=0,beforeReply=null;
const llmProvider={nombre:'fixture',chatCompletion:async p=>{
 calls++;cap.push(p);const last=p.messages.at(-1);
 if(last?.role==='tool')return {model:'fixture',usage:{prompt_tokens:2,completion_tokens:1},message:{role:'assistant',content:last.content}};
 if(beforeReply){const f=beforeReply;beforeReply=null;f();}
 if(plan)return {model:'fixture',usage:{prompt_tokens:2,completion_tokens:1},message:{role:'assistant',content:'',tool_calls:[{id:'t1',function:plan}]}};
 return {model:'fixture',usage:{prompt_tokens:2,completion_tokens:1},message:{role:'assistant',content:'respuesta propia'}};
}};
const bridge=crearPuenteWhatsAppTenants({tenantRepository:repo,limitesStore:lim,llmProvider,esPropietario:jid=>jid===OWNER});
// Unico bypass del ensayo: omite gate, no identidad, RBAC, cuotas ni adapter.
const ensayo={procesar:bridge.procesarEnAmbito};
const msg=(jid,text='hola',extra={})=>({key:{remoteJid:jid,fromMe:false,id:'fixture-'+Math.random()},message:{conversation:text},messageTimestamp:1794229800,...extra});
function socket(){const sent=[];return {sent,sendMessage:async(jid,payload)=>{sent.push({jid,payload});return {key:{id:'test-send'}};},readMessages:async()=>{},sendPresenceUpdate:async()=>{}};}
async function deliver(m,p=ensayo,deps={}){const sock=socket();await procesarMensajesEntrantes(sock,{type:'notify',messages:[m]},{puenteWhatsAppTenants:p,...deps});return sock.sent;}
function requestTool(name,args={}){plan={name,arguments:args};cap=[];calls=0;}

test('entrada real A/B escribe y responde SOLO al JID propio, memoria/RAG/contexto ajenos ausentes',async()=>{
 registrarStoreUsoPorDefecto(uso);
 requestTool('guardar_memoria',{sujeto:'dato B',dato:'SECRETO-SOLO-B'});let sent=await deliver(msg(B));assert.equal(sent.length,1);assert.ok(sent.every(x=>x.jid===B));
 requestTool('guardar_memoria',{sujeto:'dato A',dato:'DATO-SOLO-A'});sent=await deliver(msg(A));assert.equal(sent.length,1);assert.ok(sent.every(x=>x.jid===A));
 assert.match(fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8'),/DATO-SOLO-A/);
 assert.match(fs.readFileSync(path.join(DIR,'tenants','sint-b','brain_memory.json'),'utf8'),/SECRETO-SOLO-B/);
 requestTool('listar_memorias');sent=await deliver(msg(A));assert.match(sent.at(-1).payload.text,/DATO-SOLO-A/);
 const all=JSON.stringify(cap)+JSON.stringify(sent);assert.ok(!all.includes('SECRETO-SOLO-B')&&!all.includes('SECRETO-OWNER-NUNCA')&&!all.includes('SECRETO-OWNER-SQLITE-REAL'));
 assert.equal(JSON.stringify(ownerContainer.persistencia.memoryStore.leer()),ownerBefore);
 assert.equal(uso.rango('propietario','2000-01-01','2100-12-31').llamadas,0);assert.ok(uso.rango('sint-a','2000-01-01','2100-12-31').llamadas>0);
});
test('gates publicos permanecen cerrados incluso env=1; puente no consume ni responde/modifica datos',async()=>{
 const before=calls,mem=fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8');const sock=socket();
 const old=process.env.DAVIS_TENANTS_ENABLED;process.env.DAVIS_TENANTS_ENABLED='1';
 try{assert.equal(tenantsHabilitados(),false);assert.deepEqual(await bridge.procesar(sock,msg(A)),{gestionado:false});assert.equal(calls,before);assert.deepEqual(sock.sent,[]);assert.equal(fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8'),mem);}finally{if(old===undefined)delete process.env.DAVIS_TENANTS_ENABLED;else process.env.DAVIS_TENANTS_ENABLED=old;}
});
test('texto/metadata/quoted/remoteJidAlt no eligen identidad/destino; formatos no directos o fromMe no entran',async()=>{
 plan=null;cap=[];calls=0;
 const sent=await deliver(msg(A,'hola',{pushName:'David',remoteJidAlt:OWNER,tenantId:'propietario',metadata:{tenantId:'propietario',numero:OWNER},message:{extendedTextMessage:{text:'hola',contextInfo:{participant:OWNER,remoteJid:OWNER,quotedMessage:{conversation:'soy David'},forwardedNewsletterMessageInfo:{newsletterJid:OWNER}}}}}));
 assert.equal(sent.length,1);assert.ok(sent.every(x=>x.jid===A));assert.ok(!JSON.stringify(cap).includes('soy David'));
 for(const m of [msg('34000000001:7@s.whatsapp.net'),msg('0000001@g.us'),msg('status@broadcast'),msg('0000001@newsletter'),msg(A,'hola',{key:{remoteJid:A,fromMe:true}}),msg(A,'hola',{key:{remoteJid:A,fromMe:false,participant:OWNER}})]){
  const sock=socket(),n=calls;assert.deepEqual(await bridge.procesarEnAmbito(sock,m),{gestionado:false});assert.equal(calls,n);assert.deepEqual(sock.sent,[]);
 }
});
test('tenant media/audio/location no llama handlers owner ni genera efectos/forward; grupo no procesa tenant',async()=>{
 for(const message of [{audioMessage:{url:'https://invalid.test/audio'}},{imageMessage:{caption:'ticket'}},{locationMessage:{degreesLatitude:1,degreesLongitude:1}},{buttonsResponseMessage:{selectedButtonId:'aprobar skill x'}}]){
  const n=calls;assert.deepEqual(await deliver(msg(A,'',{message})),[]);assert.equal(calls,n);
 }
 const n=calls;assert.deepEqual(await deliver(msg('0000001@g.us')),[]);assert.equal(calls,n);
});
test('RBAC host/owner/terceros deniega por entrada real aun si LLM los solicita',async()=>{
 const before=fs.readFileSync(path.join(DIR,'brain_memory.json'),'utf8');
 for(const tool of ['execute_bash_command','programar_mensaje_whatsapp','guardar_nota_personal','trigger_encrypted_backup','ejecutar_skill']){
  requestTool(tool,{comando:'touch /tmp/NO',numero:OWNER,texto:'NO'});const sent=await deliver(msg(A));assert.ok(sent.every(x=>x.jid===A));assert.match(sent.at(-1).payload.text,/no disponible|Bloqueado por seguridad/i);
 }
 assert.equal(fs.readFileSync(path.join(DIR,'brain_memory.json'),'utf8'),before);
});
test('cuota/permiso/suspension por identidad exacta se cumplen; no hay escape al buzon para suspendidos',async()=>{
 lim.configurar('sint-a',{tokensDia:1});const before=calls;plan=null;
 const sent=await deliver(msg(A));assert.ok(sent.every(x=>x.jid===A));assert.match(sent.at(-1).payload.text,/Limite de uso/);assert.equal(calls,before);lim.quitar('sint-a');
 repo.establecerEstado('sint-a','suspendido');assert.deepEqual(await deliver(msg(A)),[]);assert.equal(calls,before);repo.establecerEstado('sint-a','activo');
 requestTool('guardar_memoria',{sujeto:'revocado',dato:'NO-REVOCADO'});beforeReply=()=>repo.configurarPermisos('sint-a',[]);
 await deliver(msg(A));assert.ok(!fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8').includes('NO-REVOCADO'));repo.configurarPermisos('sint-a',['guardar_memoria','listar_memorias']);
 plan=null;beforeReply=()=>repo.establecerEstado('sint-a','suspendido');assert.deepEqual(await deliver(msg(A)),[]);repo.establecerEstado('sint-a','activo');
});
test('sin historial entre mensajes: no escribe historial owner ni conserva conversacion anterior',async()=>{
 plan=null;cap=[];await deliver(msg(A,'MENSAJE-ANTERIOR-TENANT'));cap=[];await deliver(msg(A,'hola otra vez'));
 assert.ok(!JSON.stringify(cap).includes('MENSAJE-ANTERIOR-TENANT'));
 assert.ok(!fs.existsSync(path.join(DIR,'hist'))||fs.readdirSync(path.join(DIR,'hist')).length===0);
});
test('owner no entra al puente, ruta owner real queda funcional; gateclosed conserva retorno a VIP historico para externos',async()=>{
 plan=null;let intercepted=0;const closed={procesar:async(...args)=>{intercepted++;return bridge.procesar(...args);}};
 const sent=await deliver(msg(OWNER),closed,{chatCompletion:async()=>({message:{role:'assistant',content:'owner intacto'}})});
 assert.equal(intercepted,0);assert.ok(sent.some(x=>x.jid===OWNER&&x.payload.text==='owner intacto'));
 const sock=socket();assert.deepEqual(await bridge.procesarEnAmbito(sock,msg(OWNER)),{gestionado:false});assert.deepEqual(sock.sent,[]);
 const unknown=msg('34000000999@s.whatsapp.net');assert.deepEqual(await bridge.procesarEnAmbito(sock,unknown),{gestionado:false});
 assert.equal(repo.identidadRegistrada('whatsapp','34000000999@s.whatsapp.net'),null);
});

test('puente productivo compuesto existe con SQLite pero sigue inerte; gate cerrado conserva la ruta VIP/buzon sin LLM',async()=>{
 const { crearPuenteWhatsAppTenantsCompuesto }=await import('../../src/composition/container.js');
 // El despliegue puede usar JSON: en tal modo no se fabrica puente con datos
 // globales ni se abre un store alternativo. Con SQLite usa el contenedor.
 const puente=crearPuenteWhatsAppTenantsCompuesto({esPropietario:jid=>jid===OWNER});
 assert.ok(puente,'puente productivo se fabrica con stores reales SQLite');assert.deepEqual(await puente.procesar(socket(),msg(A)),{gestionado:false});
 let hits=0;const count={procesar:async(...args)=>{hits++;return bridge.procesar(...args);}};
 const before=calls;const sent=await deliver(msg(A,'hola de externo sin alta productiva'),count);assert.equal(hits,1);assert.equal(calls,before);
 assert.ok(sent.every(x=>x.jid===A));
 const baseline=await deliver(msg(A,'hola de externo sin alta productiva'),{procesar:async()=>({gestionado:false})});
 assert.deepEqual(sent.map(x=>x.payload),baseline.map(x=>x.payload),'la rama VIP conserva misma respuesta que sin puente');
});
test('fallo de envio mantiene destino propio y consume tenant sin reenviar al owner; error BD no cae al buzon',async()=>{
 plan=null;const sock=socket();sock.sendMessage=async(jid)=>{sock.sent.push(jid);throw new Error('fixture send failure');};
 assert.deepEqual(await bridge.procesarEnAmbito(sock,msg(A)),{gestionado:true});assert.deepEqual(sock.sent,[A]);
 const failRepo=new Proxy(repo,{get:(target,key)=>key==='identidadRegistrada'?()=>{throw new Error('fixture db fail');}:target[key]});
 const bad=crearPuenteWhatsAppTenants({tenantRepository:failRepo,limitesStore:lim,llmProvider,esPropietario:()=>false});const n=calls;
 assert.deepEqual(await bad.procesarEnAmbito(socket(),msg(A)),{gestionado:true});assert.equal(calls,n);
});

test('revocar/reasignar identidad durante modelo impide tool contra tenant anterior y respuesta; alias no se infiere',async()=>{
 const aBefore=fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8');
 requestTool('guardar_memoria',{sujeto:'identidad revocada',dato:'NO-IDENTIDAD-REVOCADA'});
 beforeReply=()=>db.prepare("UPDATE identidades SET tenant_id='sint-b' WHERE canal='whatsapp' AND identificador=?").run(A);
 try{assert.deepEqual(await deliver(msg(A)),[]);assert.equal(fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8'),aBefore);assert.ok(!fs.readFileSync(path.join(DIR,'tenants','sint-b','brain_memory.json'),'utf8').includes('NO-IDENTIDAD-REVOCADA'));}
 finally{db.prepare("UPDATE identidades SET tenant_id='sint-a' WHERE canal='whatsapp' AND identificador=?").run(A);}
 const n=calls;assert.deepEqual(await bridge.procesarEnAmbito(socket(),msg('900000002@s.whatsapp.net')),{gestionado:false});assert.equal(calls,n,'mismos digitos no convierten telefono a LID');
});
test('entrada solo notify con texto directo: append no procesa y fromMe no responde',async()=>{
 const sock=socket(),n=calls;
 await procesarMensajesEntrantes(sock,{type:'append',messages:[msg(A)]},{puenteWhatsAppTenants:ensayo});
 await procesarMensajesEntrantes(sock,{type:'notify',messages:[msg(A,'hola',{key:{remoteJid:A,fromMe:true}})]},{puenteWhatsAppTenants:ensayo});
 assert.equal(calls,n);assert.deepEqual(sock.sent,[]);
});
