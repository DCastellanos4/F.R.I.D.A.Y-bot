// RF-01 same-host fenced claims. SQLite remains authoritative; Redis has IDs only.
import crypto from 'node:crypto';
export function crearSqliteClaimStore(db, base, {ahora=()=>Date.now()}={}) {
 const iso=()=>new Date(ahora()).toISOString();
 const row=db.prepare('SELECT * FROM outbox_events WHERE id=?');
 const claim=db.prepare("UPDATE outbox_events SET estado='en_curso',claim_token=@token,lease_until=@until,reclamado_en=@now WHERE id=@id AND estado='pendiente' AND transporte='redis' AND claim_token IS NULL AND disponible_en<=@now");
 const valid=db.prepare("SELECT 1 FROM outbox_events WHERE id=? AND estado='en_curso' AND claim_token=? AND lease_until>?");
 const renew=db.prepare("UPDATE outbox_events SET lease_until=@until WHERE id=@id AND estado='en_curso' AND claim_token=@token AND lease_until>@now");
 const expired=db.prepare("UPDATE outbox_events SET estado='pendiente',claim_token=NULL,lease_until=NULL,reclamado_en=NULL WHERE estado='en_curso' AND claim_token IS NOT NULL AND lease_until<=?");
 const ids=db.prepare("SELECT id FROM outbox_events WHERE estado='pendiente' AND transporte='redis' AND claim_token IS NULL AND disponible_en<=? ORDER BY creado_en,id LIMIT ?");
 const done=db.prepare("UPDATE outbox_events SET estado='completado',procesado_en=?,ultimo_error=NULL,claim_token=NULL,lease_until=NULL WHERE id=? AND claim_token=?");
 const failed=db.prepare("UPDATE outbox_events SET estado=?,intentos=intentos+1,disponible_en=?,procesado_en=?,ultimo_error='RF01_PROCESSING_FAILED',claim_token=NULL,lease_until=NULL,reclamado_en=NULL WHERE id=? AND claim_token=?");
 const cp=db.prepare('INSERT INTO job_checkpoints(job_id,ronda,estado,creado_en) VALUES(?,?,?,?) ON CONFLICT(job_id,ronda) DO UPDATE SET estado=excluded.estado,creado_en=excluded.creado_en');
 const response=db.prepare("INSERT OR IGNORE INTO channel_responses(id,job_id,canal,destinatario,payload,estado,creado_en) VALUES(?,?,?,?,?,'pendiente',?)");
 function check(id,token){if(typeof token!=='string'||!valid.get(id,token,iso()))throw new Error('RF01_CLAIM_LOST');}
 function owned(id,token,fn){return db.transaction(()=>{check(id,token);return fn();}).immediate();}
 function positive(n){if(!Number.isSafeInteger(n)||n<30||n>3600000)throw new TypeError('RF01_LEASE_BOUNDS');}
 return Object.freeze({
  pendientes({limite=32}={}){if(!Number.isSafeInteger(limite)||limite<1||limite>256)throw new TypeError('RF01_BATCH_BOUNDS');return ids.all(iso(),limite).map(r=>r.id);},
  recuperarExpirados(){return expired.run(iso()).changes;},
  reclamar(id,{leaseMs=60000}={}){
   positive(leaseMs);const token=crypto.randomUUID();const now=iso();const until=new Date(ahora()+leaseMs).toISOString();
   return db.transaction(()=>{if(claim.run({id,token,now,until}).changes!==1)return null;const r=row.get(id);return Object.freeze({id:r.id,tenantId:r.tenant_id,canal:r.canal,tipo:r.tipo,payload:JSON.parse(r.payload),intentos:r.intentos,claimToken:token});}).immediate();
  },
  renovar(id,token,{leaseMs=60000}={}){positive(leaseMs);const now=iso();if(renew.run({id,token,now,until:new Date(ahora()+leaseMs).toISOString()}).changes!==1)throw new Error('RF01_CLAIM_LOST');},
  comprobar:check,
  conReclamo:owned,
  completar(id,token){return owned(id,token,()=>done.run(iso(),id,token).changes);},
  fallar(id,token,{maxIntentos=5,backoffMs=1000}={}){
   if(!Number.isSafeInteger(maxIntentos)||maxIntentos<1||maxIntentos>100||!Number.isSafeInteger(backoffMs)||backoffMs<0||backoffMs>3600000)throw new TypeError('RF01_RETRY_BOUNDS');
   return owned(id,token,()=>{const r=row.get(id),terminal=r.intentos+1>=maxIntentos;return failed.run(terminal?'fallido':'pendiente',new Date(ahora()+backoffMs*(r.intentos+1)).toISOString(),terminal?iso():null,id,token).changes;});
  },
  paraWorker(trabajo){
   const {id,claimToken:token}=trabajo;
   const bound=fn=>owned(id,token,()=>{trabajo.leaseGuard?.();return fn();});
   return Object.freeze({
    comprobarReclamo:()=>{trabajo.leaseGuard?.();check(id,token);},
    conReclamo:bound,
    ultimoCheckpoint:jobId=>bound(()=>{if(jobId!==id)throw new Error('RF01_JOB_BINDING');return base.ultimoCheckpoint(id);}),
    guardarCheckpoint(jobId,ronda,estado){return bound(()=>{if(jobId!==id||!Number.isSafeInteger(ronda)||ronda<0)throw new Error('RF01_JOB_BINDING');cp.run(id,ronda,JSON.stringify(estado??{}),iso());});},
    encolarRespuesta(r){return bound(()=>{if(r.jobId!==id)throw new Error('RF01_JOB_BINDING');return response.run(`resp_${id}`,id,r.canal,r.destinatario,JSON.stringify(r.payload??{}),iso()).changes===1;});}
   });
  }
 });
}
