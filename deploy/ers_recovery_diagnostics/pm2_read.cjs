'use strict';
// Existing-daemon read ONLY. No import of PM2 Client/API/CLI, no mutating method.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {closedLoader}=require('../ers_recovery/closed_loader.cjs');
const closureManifest=require('../ers_recovery/closure_manifest.json');
let stage='VALIDATE_CONFIG';
let projectionReason=null;
function projectFail(reason){projectionReason=reason;fail();}
function fail() { throw new Error('PM2_READ_UNVERIFIABLE'); }
function start(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0)fail();
  const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
  return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
}
function key(s) {return [s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink].join(':');}
function project(rows, expected) {
  if (!Array.isArray(rows)||rows.length!==2||Object.keys(expected).length!==2) projectFail('PROCESS_SET');
  const seen=new Set();
  return rows.map(row=>{
    const e=row && row.pm2_env;
    if (!e||!Number.isSafeInteger(e.pm_id)||!(String(e.pm_id) in expected)||seen.has(e.pm_id)||e.name!==expected[e.pm_id]) projectFail('PROCESS_IDENTITY');
    seen.add(e.pm_id);
    const fields=['name','pm_exec_path','pm_cwd','exec_interpreter','exec_mode','autorestart','watch','cron_restart','kill_timeout','listen_timeout','restart_delay','exp_backoff_restart_delay','max_restarts','max_memory_restart'];
    const config={};
    for (const f of fields) {
      // No missing field is filled from a stale ecosystem. Unavailable config
      // blocks this read's interpretation. No env/unknown field is copied.
      if (!(f in e)) projectFail('MISSING_CONFIG_'+f);
      const v=e[f];if (v!==null && !['string','boolean','number'].includes(typeof v)) projectFail('CONFIG_TYPE_'+f);
      if (typeof v==='string'&&v.length>4096)projectFail('CONFIG_STRING_SIZE_'+f);
      config[f]=v;
    }
    if (!Number.isSafeInteger(row.pid)||row.pid<0||!Number.isSafeInteger(e.restart_time)||e.restart_time<0||!Number.isSafeInteger(e.pm_uptime)||e.pm_uptime<0)projectFail('PROCESS_COUNTER_TYPE');
    if (!['online','stopped','stopping','launching','errored'].includes(e.status))projectFail('PROCESS_STATUS');
    if(e.status==='online'&&row.pid===0)projectFail('ONLINE_WITHOUT_PID');
    let processStart=null;
    try{processStart=row.pid>0?start(row.pid):null;}catch{projectFail('PROCESS_START_UNVERIFIABLE');}
    return {pid:row.pid,pm2_env:{...config,pm_id:e.pm_id,status:e.status,restart_time:e.restart_time,pm_uptime:e.pm_uptime},
            processStart};
  });
}
async function collect(config) {
  // Caller binds socket/dev/inode, daemon PID/start and disk module pins from a
  // fresh directed observation. No defaults or discovery beyond these paths.
  if (Object.keys(config).sort().join(',')!=='daemon,expected,pins,root,socket,socketKey,timeoutMs,uid')fail();
  if(config.root!=='/usr/lib/node_modules/pm2'||!path.isAbsolute(config.socket)||!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<100||config.timeoutMs>5000)fail();
  if(!config.daemon||!Number.isSafeInteger(config.uid)||config.uid<0||typeof config.daemon.start!=='string'||!/^\d+$/.test(config.daemon.start)||!config.expected||!config.pins)fail();
  const modules=['modules/pm2-axon/index.js','modules/pm2-axon-rpc/index.js'];
  function custody(){
    const s=fs.lstatSync(config.socket);
    if(!s.isSocket()||s.uid!==config.uid||key(s)!==config.socketKey||start(config.daemon.pid)!==config.daemon.start)fail();
    for(const rel of modules){
      const p=path.join(config.root,rel);const s=fs.lstatSync(p);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.nlink!==1||s.mode&0o022)fail();
      if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==config.pins[rel])fail();
    }
  }
  stage='INITIAL_CUSTODY';custody();
  stage='CLOSURE_PREFLIGHT';const loader=closedLoader(closureManifest);
  stage='CLOSURE_LOAD';const axon=loader.load(modules[0]);
  const rpc=loader.load(modules[1]);
  stage='TRANSPORT_CONSTRUCT';const request=axon.socket('req');const client=new rpc.Client(request);
  stage='TRANSPORT_CONNECT';return await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);request.close();error?reject(Error('PM2_READ_UNVERIFIABLE')):resolve(value);};
    const timer=setTimeout(()=>finish(true),config.timeoutMs);
    request.once('error',()=>finish(true));
    request.once('connect',()=>{
      try{stage='CONNECTED_CUSTODY';custody();}catch{return finish(true);}
      stage='RPC_VERSION';client.call('getVersion',{},(error,version)=>{
        if(error||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return finish(true);
        stage='RPC_MONITOR';client.call('getMonitorData',{},(error,rows)=>{
          if(error)return finish(true);
          try {stage='PROJECT_RECORDS';const selected=project(rows,config.expected);stage='FINAL_CUSTODY';custody();finish(false,{version,selected});}
          catch{finish(true);}
        });
      });
    });
    request.connect(config.socket);
  });
}
module.exports={project,collect,key,diagnosticStage:()=>stage,diagnosticReason:()=>projectionReason};
if(require.main===module){
  // Fixed bounded config stdin, no private payload output on errors.
  let input='';process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{input+=chunk;if(input.length>16384)process.exit(2);});
  process.stdin.on('end',async()=>{
    const hard=setTimeout(()=>process.exit(2),6000);
    try{const result=await collect(JSON.parse(input));clearTimeout(hard);process.stdout.write(JSON.stringify(result)+'\n',()=>process.exit(0));}
    catch{clearTimeout(hard);process.exit(2);}
  });
}
