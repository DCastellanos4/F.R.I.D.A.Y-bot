/** RF01 ID-only BullMQ transport. Business state and content stay in SQLite.
 * Inert until publicar/consumir. Does not provision Redis or choose retention
 * for application records. Removed Redis notifications may be republished;
 * deduplication here is NOT the authority for executing tools.
 */
import {afirmarJobQueue} from '../../../ports/outbound/JobQueuePort.js';
export function crearBullmqQueueAdapter({url=process.env.DAVIS_REDIS_URL||'redis://127.0.0.1:6379',nombreCola='davis-agente',cargarModulo=()=>import('bullmq')}={}){
 let parsed,username,password;
 try{
  parsed=new URL(url);
  if(parsed.protocol!=='redis:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/'&&parsed.pathname!==''||parsed.search||parsed.hash)throw new Error();
  username=parsed.username?decodeURIComponent(parsed.username):'';
  password=parsed.password?decodeURIComponent(parsed.password):'';
 }catch{throw new TypeError('RF01_LOCAL_REDIS_URL_REQUIRED');}
 const connection={host:parsed.hostname==='[::1]'?'::1':parsed.hostname,port:Number(parsed.port||6379),maxRetriesPerRequest:null,...(username?{username}:{}),...(password?{password}:{})};
 let queue=null,worker=null,loading=null,mod=null,closed=false,errorCount=0,consumerStarted=false,consumerFn=null;
 const idOk=id=>typeof id==='string'&&/^evt_[a-f0-9-]{36}$/.test(id);
 function notification(v){if(!v||Object.keys(v).length!==1||!idOk(v.id))throw new TypeError('RF01_ID_NOTIFICATION_REQUIRED');return {id:v.id};}
 function ensureWorker(){
  if(!closed&&consumerFn&&queue&&!worker){
   worker=new mod.Worker(nombreCola,async job=>{const data=notification(job.data);if(String(job.id)!==data.id)throw new Error('RF01_BROKER_ID_BINDING');return consumerFn(data);},{connection,concurrency:1});
   worker.on?.('error',()=>{errorCount++;});
  }
 }
 async function cargar(){
  if(closed)throw new Error('RF01_BROKER_CLOSED');if(queue){ensureWorker();return;}
  if(!loading)loading=(async()=>{mod=await cargarModulo();if(closed)throw new Error('RF01_BROKER_CLOSED');queue=new mod.Queue(nombreCola,{connection:{...connection,maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:2000}});queue.on?.('error',()=>{errorCount++;});ensureWorker();})().finally(()=>{loading=null;});
  await loading;
 }
 return afirmarJobQueue(Object.freeze({
  async publicar(value){const data=notification(value);await cargar();if(closed)throw new Error('RF01_BROKER_CLOSED');const job=await queue.add('outbox_id',data,{jobId:data.id,attempts:1,removeOnComplete:true,removeOnFail:true});return String(job.id);},
  async consumir(fn){
   if(consumerStarted||typeof fn!=='function'||closed)throw new Error('RF01_BROKER_START_STATE');consumerStarted=true;consumerFn=fn;
   await cargar();
  },
  estado:()=>({closed,errorCount,consumerStarted,queueCreated:!!queue,workerCreated:!!worker}),
  async cerrar(){closed=true;if(loading)await loading.catch(()=>{});if(worker)await worker.close();if(queue)await queue.close();}
 }));
}
