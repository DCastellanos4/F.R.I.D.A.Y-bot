// LOCAL ONLY real Redis subprocess runner. Never connects to production.
import fs from 'node:fs';import path from 'node:path';import Database from 'better-sqlite3';
import {ejecutarMigraciones} from '../../src/adapters/outbound/persistence/sqlite/migraciones.js';
import {crearPipelineAsincrono} from '../../src/composition/asyncPipeline.js';
import {crearBullmqQueueAdapter} from '../../src/adapters/outbound/queue/bullmqQueueAdapter.js';
import {crearAuditLogService} from '../../src/security/auditLogService.js';
import {consultarJarvisAislado} from './jarvisAislado.js';
const [dir,port,mode]=process.argv.slice(2);const db=new Database(path.join(dir,'synthetic.db'));db.pragma('journal_mode=WAL');ejecutarMigraciones(db);
const broker=crearBullmqQueueAdapter({url:`redis://127.0.0.1:${port}`,nombreCola:'ers-real-local'});
const pipeline=crearPipelineAsincrono({db,selectorCola:'redis',brokerIds:broker,auditoria:crearAuditLogService(db),intervaloColaMs:50,intervaloEntregaMs:50,opcionesPuente:{leaseMs:900,heartbeatMs:100},procesar:async(inbound,{opciones})=>{
 let round=0;
 if(mode==='fast-local'){fs.appendFileSync(path.join(dir,'synthetic-calls.txt'),inbound.messageId+'\n');opciones.onCheckpointRonda(1,{synthetic:true});return 'synthetic fast';}
 if(mode==='slow-read'){
  opciones.onCheckpointRonda(1,{accionesPlanificadas:[],accionesConEfectos:[]});process.send?.({event:'processing'});await new Promise(r=>setTimeout(r,2000));return 'slow synthetic result';
 }
 return consultarJarvisAislado('ejecuta la accion de prueba',[],{...opciones,chatId:'real-redis-synthetic',chatCompletion:async()=>({message:++round===1?{content:'',tool_calls:[{id:'call1',function:{name:'anotar_idea',arguments:JSON.stringify({titulo:'SYNTHETIC'})}}]}:{content:'synthetic final'}}),ejecutores:{anotar_idea:async()=>{
  fs.appendFileSync(path.join(dir,'synthetic-effects.txt'),'effect\n');process.send?.({event:'effect_entered'});
  if(mode==='crash-during-effect')await new Promise(()=>{});
  if(mode==='pause-effect')await new Promise(r=>setTimeout(r,2000));
  return 'SYNTHETIC_PRIVATE_RESPONSE 612 34 56 78';
 }}});
}});
pipeline.iniciar();process.send?.({event:'ready'});
process.on('message',async m=>{if(m==='close'){await pipeline.cerrar();db.close();process.send?.({event:'closed'});process.exit(0);}});
