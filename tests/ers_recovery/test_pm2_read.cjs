'use strict';
const assert=require('node:assert/strict');
const {project}=require('../../deploy/ers_recovery/pm2_read.cjs');
function row(id){return {pid:process.pid,pm2_env:{pm_id:id,name:id===0?'api':'wa',status:'online',restart_time:0,pm_uptime:1000,name_unused:'private',env:{API_TOKEN:'synthetic-secret'},API_TOKEN:'synthetic-secret',pm_exec_path:'/release/api.js',pm_cwd:'/release',exec_interpreter:'/usr/bin/node',exec_mode:'fork_mode',autorestart:true,watch:false,cron_restart:null,kill_timeout:5000,listen_timeout:8000,restart_delay:4000,exp_backoff_restart_delay:100,max_restarts:10,max_memory_restart:'500M'}};}
const selected=project([row(0),row(1)],{0:'api',1:'wa'});
assert(!JSON.stringify(selected).includes('synthetic-secret'));
assert(selected[0].processStart);
assert.throws(()=>project([row(0),row(0)],{0:'api',1:'wa'}));
assert.throws(()=>project([row(0)],{0:'api',1:'wa'}));
const bad=row(0);bad.pm2_env.status='other';assert.throws(()=>project([bad,row(1)],{0:'api',1:'wa'}));
const incomplete=row(0);delete incomplete.pm2_env.watch;assert.throws(()=>project([incomplete,row(1)],{0:'api',1:'wa'}));
const stopped=row(0);stopped.pid=0;stopped.pm2_env.status='stopped';assert.equal(project([stopped,row(1)],{0:'api',1:'wa'})[0].processStart,null);
console.log('6 projection probes PASS; no real PM2 transport or daemon used');
