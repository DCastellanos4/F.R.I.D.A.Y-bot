// Same-host outbox -> ID broker. No messages or tenant data reach the broker.
import {afirmarJobQueue} from '../../../ports/outbound/JobQueuePort.js';
export function crearOutboxBrokerBridge({outboxStore,claimStore,broker,leaseMs=60000,intervaloMs=1000,heartbeatMs=10000,maxIntentos=5,backoffMs=1000}={}) {
 afirmarJobQueue(broker);
 if(!outboxStore||!claimStore)throw new TypeError('RF01_STORES_REQUIRED');
 if(!Number.isSafeInteger(leaseMs)||leaseMs<90||!Number.isSafeInteger(heartbeatMs)||heartbeatMs<10||heartbeatMs*3>leaseMs||!Number.isSafeInteger(intervaloMs)||intervaloMs<10)throw new TypeError('RF01_TIMING_BOUNDS');
 let closed=false,handler=null,timer=null,cycle=null,started=false,lost=0,brokerErrors=0;const active=new Set();
 const idOk=id=>typeof id==='string'&&/^evt_[a-f0-9-]{36}$/.test(id);
 async function consume(notification){
  if(closed)return;
  if(!notification||Object.keys(notification).length!==1||!idOk(notification.id))throw new Error('RF01_ID_NOTIFICATION_REQUIRED');
  const job=claimStore.reclamar(notification.id,{leaseMs});if(!job)return;
  let ownershipLost=false;
  const heartbeat=setInterval(()=>{if(ownershipLost)return;try{claimStore.renovar(job.id,job.claimToken,{leaseMs});}catch{ownershipLost=true;lost++;}},heartbeatMs);heartbeat.unref?.();
  try{
   await handler(Object.freeze({...job,leaseGuard:()=>{if(ownershipLost)throw new Error('RF01_CLAIM_LOST');}}));
   if(ownershipLost)throw new Error('RF01_CLAIM_LOST');
   claimStore.completar(job.id,job.claimToken);
  }catch{
   // SQLite is the only business-attempt/backoff authority. A stale worker
   // cannot mutate the new owner's job or insert an old response.
   if(!ownershipLost){try{claimStore.fallar(job.id,job.claimToken,{maxIntentos,backoffMs});}catch{lost++;}}
  }finally{clearInterval(heartbeat);}
 }
 async function reconcile(){
  if(closed)return;
  claimStore.recuperarExpirados();
  for(const id of claimStore.pendientes()){
   if(closed)return;
   if(!idOk(id))throw new Error('RF01_OUTBOX_ID_SCHEMA');
   await broker.publicar({id});
  }
 }
 function schedule(){
  if(closed)return;
  cycle=reconcile().catch(()=>{brokerErrors++;}).finally(()=>{cycle=null;if(!closed){timer=setTimeout(schedule,intervaloMs);timer.unref?.();}});
 }
 return Object.freeze({
  publicar:job=>{if(closed)throw new Error('RF01_BRIDGE_CLOSED');if(job.id!==undefined&&job.id!==null&&!idOk(job.id))throw new TypeError('RF01_OUTBOX_ID_SCHEMA');return outboxStore.publicar({...job,transporte:'redis'});},
  consumir(fn){if(started||closed||typeof fn!=='function')throw new Error('RF01_BRIDGE_START_STATE');started=true;handler=fn;
   // Track every in-flight task even if an injected broker does not await it.
   let ready;try{ready=broker.consumir(n=>{if(closed)return;const task=consume(n);active.add(task);task.finally(()=>active.delete(task)).catch(()=>{});return task;});}catch{brokerErrors++;}
   Promise.resolve(ready).catch(()=>{brokerErrors++;});schedule();
  },
  reconciliar:reconcile,
  estado:()=>({started,closed,brokerErrors,claimsLost:lost,active:active.size,brokerState:broker.estado?.()||null,scope:'SAME_HOST_SQLITE_AUTHORITATIVE_NOT_EXACTLY_ONCE'}),
  async cerrar(){closed=true;if(timer)clearTimeout(timer);if(cycle)await cycle;await broker.cerrar();await Promise.allSettled([...active]);}
 });
}
