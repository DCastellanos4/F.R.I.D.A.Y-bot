// Matrix E2E current datos_tenant only. Real tools/services, LLM stub emits calls;
// no executor overrides or RBAC changes. Synthetic A/B/owner, private roots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'tenant-catalog-'));
process.env.DAVIS_DATA_DIR=DIR;
const { consultarJarvisEnAmbito }=await import('../../src/core/jarvisAgent.js');
const { CLASIFICACION_HERRAMIENTAS }=await import('../../src/services/rbacService.js');
const allow=CLASIFICACION_HERRAMIENTAS.datos_tenant;
const controlUso={autorizar:()=>({permitido:true})};
async function tool(tid,name,args={}) {
 const cap=[];let n=0;
 const chatCompletion=async(p)=>{cap.push(JSON.stringify(p));n++;return {model:'stub',message:n===1?{role:'assistant',content:'',tool_calls:[{id:'x'+name,function:{name,arguments:args}}]}:{role:'assistant',content:'1,2,3'}};};
 await consultarJarvisEnAmbito('usa la herramienta solicitada',[],{tenantId:tid,controlUso,rolDeTenant:()=> 'usuario',permitidasUsuario:allow,chatCompletion,chatId:'same-chat'});
 const calls=cap.map(c=>JSON.parse(c).messages||[]).flat().filter(m=>m.role==='tool');
 assert.ok(calls.length>=1,'tool real produjo resultado '+name);
 return calls.map(m=>m.content||'').join('\n');
}
const families=[
 {file:'brain_memory.json',create:'guardar_memoria',args:m=>({sujeto:m,dato:m}),read:'listar_memorias',deletes:[['olvidar_memoria',m=>({criterio:m})]], extras:[['buscar_memoria',m=>({consulta:m})],['buscar_recuerdo_semantico',m=>({consulta:m})]]},
 {file:'contactos.json',create:'registrar_contacto',args:m=>({nombre:m,telefono:'+34600000001'}),read:'listar_contactos',extras:[['buscar_contacto',m=>({criterio:m})]]},
 {file:'habitos.json',create:'registrar_habito',args:m=>({nombre:m}),read:'listar_habitos',extras:[['marcar_habito',m=>({criterio:m})]]},
 {file:'compra.json',create:'anadir_compra',args:m=>({items:[m]}),read:'listar_compra',extras:[['tachar_compra',m=>({criterio:m})]],deletes:[['vaciar_compra',()=>({})]]},
 {file:'ideas.json',create:'anotar_idea',args:m=>({titulo:m,detalle:m}),read:'listar_ideas'},
 {file:'menus.json',create:'poner_menu',args:m=>({dia:'lunes',comida:m,cena:m}),read:'ver_menu'},
 {file:'quedadas.json',create:'crear_quedada',args:m=>({titulo:m,fecha:'2027-01-01',hora:'20:00',lugar:m,participantes:[m]}),read:'listar_quedadas'},
 {file:'entregas.json',create:'registrar_entrega',args:m=>({titulo:m,fecha:'2027-01-01',tipo:'entrega'}),read:'listar_entregas',deletes:[['eliminar_entrega',m=>({criterio:m})]]},
 {file:'fechas_senaladas.json',create:'registrar_fecha_senalada',args:m=>({nombre:m,dia:1,mes:1}),read:'listar_fechas_senaladas',deletes:[['eliminar_fecha_senalada',m=>({criterio:m})]]}
];
for(const f of families) test('E2E A/B/owner '+f.file+': alta/lectura/operaciones y borrado disponibles no mezclan',async()=>{
 const markerA='marca-a-'+f.file.split('.')[0],markerB='marca-b-'+f.file.split('.')[0],markerO='marca-owner-'+f.file.split('.')[0];
 for(const [tid,m]of [['propietario',markerO],['sint-b',markerB],['sint-a',markerA]]){
  fs.mkdirSync(tid==='propietario'?DIR:path.join(DIR,'tenants',tid),{recursive:true});
  await tool(tid,f.create,f.args(m));
 }
 const aFile=path.join(DIR,'tenants','sint-a',f.file),bFile=path.join(DIR,'tenants','sint-b',f.file),oFile=path.join(DIR,f.file);
 assert.ok(fs.existsSync(aFile),'escribe archivo A real'); assert.ok(fs.readFileSync(aFile,'utf8').includes(markerA));
 const bBefore=fs.readFileSync(bFile,'utf8'),oBefore=fs.readFileSync(oFile,'utf8');
 const own=await tool('sint-a',f.read);assert.ok(own.includes(markerA),'lectura no vacua');assert.ok(!own.includes(markerB)&&!own.includes(markerO),'no lee ajenos');
 for(const [name,args] of f.extras||[]) {const r=await tool('sint-a',name,args(markerA));assert.ok(!r.includes(markerB)&&!r.includes(markerO),name);}
 for(const [name,args] of f.deletes||[]) await tool('sint-a',name,args(markerA));
 assert.equal(fs.readFileSync(bFile,'utf8'),bBefore,'B intacto');assert.equal(fs.readFileSync(oFile,'utf8'),oBefore,'owner intacto');
 if(f.deletes?.length) assert.ok(!fs.readFileSync(aFile,'utf8').includes(markerA),'borra A realmente');
});
test('matriz cubre cada herramienta datos_tenant exactamente en familia o extra',()=>{
 const covered=families.flatMap(f=>[f.create,f.read,...(f.extras||[]).map(x=>x[0]),...(f.deletes||[]).map(x=>x[0])]);
 assert.deepEqual([...new Set(covered)].sort(),[...allow].sort());
});

test('guardar_memoria respeta A con store SQLite del propietario registrado y no invoca su escritor',async()=>{
 const { registrarStoreMemoriasPorDefecto }=await import('../../src/services/memoryService.js');
 let ownerWrites=0;
 registrarStoreMemoriasPorDefecto({leer:()=>[],guardar:()=>{ownerWrites++;}});
 try {await tool('sint-a','guardar_memoria',{sujeto:'solo-a-sqlite',dato:'solo-a-sqlite'});
 assert.equal(ownerWrites,0);assert.ok(fs.readFileSync(path.join(DIR,'tenants','sint-a','brain_memory.json'),'utf8').includes('solo-a-sqlite'));
 }finally{registrarStoreMemoriasPorDefecto(null);}
});
