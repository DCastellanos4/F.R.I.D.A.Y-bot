const path=require('node:path');
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert');
const source=fs.readFileSync(path.join(__dirname,'../../deploy/ers_recovery_diagnostics/pm2_read.cjs'),'utf8');
const fields=['name','pm_exec_path','pm_cwd','exec_interpreter','exec_mode','autorestart','watch','cron_restart','kill_timeout','listen_timeout','restart_delay','exp_backoff_restart_delay','max_restarts','max_memory_restart'];
function row(id){return {pid:0,pm2_env:{pm_id:id,name:id===0?'api':'wa',status:'stopped',restart_time:0,pm_uptime:1,pm_exec_path:'/release/app.js',pm_cwd:'/release',exec_interpreter:'node',exec_mode:'fork_mode',autorestart:true,watch:false,cron_restart:null,kill_timeout:1,listen_timeout:1,restart_delay:0,exp_backoff_restart_delay:0,max_restarts:1,max_memory_restart:0}};}
let count=0;
function probe(reason,fn){
 const module={exports:{}};
 const ctx={module,process:{},require(id){if(id==='node:fs')return {readFileSync(){throw Error('PRIVATE_RAW_NEVER_RETURNED');}};if(id==='../ers_recovery/closed_loader.cjs')return {};if(id==='../ers_recovery/closure_manifest.json')return {};return require(id);}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const rows=[row(0),row(1)];fn(rows);
 assert.throws(()=>module.exports.project(rows,{0:'api',1:'wa'}));assert.equal(module.exports.diagnosticReason(),reason);count++;
}
for(const f of fields){
 if(f!=='name')probe('MISSING_CONFIG_'+f,rows=>delete rows[0].pm2_env[f]);
 if(f!=='name')probe('CONFIG_TYPE_'+f,rows=>rows[0].pm2_env[f]={private:'PRIVATE_RAW_NEVER_RETURNED'});
 if(f!=='name')probe('CONFIG_STRING_SIZE_'+f,rows=>rows[0].pm2_env[f]='x'.repeat(4097));
}
probe('PROCESS_SET',rows=>rows.pop());probe('PROCESS_IDENTITY',rows=>rows[0].pm2_env.name='other');
probe('PROCESS_COUNTER_TYPE',rows=>rows[0].pm2_env.restart_time=true);probe('PROCESS_STATUS',rows=>rows[0].pm2_env.status='other');
probe('ONLINE_WITHOUT_PID',rows=>rows[0].pm2_env.status='online');probe('PROCESS_START_UNVERIFIABLE',rows=>{rows[0].pid=10;rows[0].pm2_env.status='online';});
console.log(count+' projection diagnostic reason probes PASS; missing/type/size names are fixed fields, no values/raw errors');
