'use strict';
// Existing-daemon read ONLY. No import of PM2 Client/API/CLI, no mutating method.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {closedLoader}=require('./closed_loader.cjs');
const closureManifest=require('./closure_manifest.json');
function fail() { throw new Error('PM2_READ_UNVERIFIABLE'); }
function start(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0)fail();
  const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
  return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
}
function key(s) {return [s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink].join(':');}
function project(rows, expected) {
  if (!Array.isArray(rows)||rows.length!==2||Object.keys(expected).length!==2) fail();
  const seen=new Set();
  return rows.map(row=>{
    const e=row && row.pm2_env;
    if (!e||!Number.isSafeInteger(e.pm_id)||!(String(e.pm_id) in expected)||seen.has(e.pm_id)||e.name!==expected[e.pm_id]) fail();
    seen.add(e.pm_id);
    const fields=['name','pm_exec_path','pm_cwd','exec_interpreter','exec_mode','autorestart','watch','cron_restart','kill_timeout','listen_timeout','restart_delay','exp_backoff_restart_delay','max_restarts','max_memory_restart'];
    const config={};
    for (const f of fields) {
      // No missing field is filled from a stale ecosystem. Unavailable config
      // blocks this read's interpretation. No env/unknown field is copied.
      if (!(f in e)) {if(fields.indexOf(f)<5)fail();continue;}
      const v=e[f];const watchArray=f==='watch'&&Array.isArray(v)&&v.length<=128&&v.every(x=>typeof x==='string'&&x.length<=4096)&&v.reduce((a,x)=>a+x.length,0)<=16384;
      if (v!==null && !['string','boolean','number'].includes(typeof v)&&!watchArray) fail();
      if(typeof v==='number'&&!Number.isSafeInteger(v))fail();
      if (typeof v==='string'&&v.length>4096)fail();
      config[f]=watchArray?v.slice():v;
    }
    if (!Number.isSafeInteger(row.pid)||row.pid<0||!Number.isSafeInteger(e.restart_time)||e.restart_time<0||!Number.isSafeInteger(e.pm_uptime)||e.pm_uptime<0)fail();
    if (!['online','stopped','stopping','launching','errored'].includes(e.status))fail();
    if(e.status==='online'&&row.pid===0)fail();
    return {pid:row.pid,pm2_env:{...config,pm_id:e.pm_id,status:e.status,restart_time:e.restart_time,pm_uptime:e.pm_uptime},
            processStart:row.pid>0?start(row.pid):null};
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
  custody();
  const loader=closedLoader(closureManifest);
  const axon=loader.load(modules[0]);
  const rpc=loader.load(modules[1]);
  const request=axon.socket('req');const client=new rpc.Client(request);
  return await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);request.close();error?reject(Error('PM2_READ_UNVERIFIABLE')):resolve(value);};
    const timer=setTimeout(()=>finish(true),config.timeoutMs);
    request.once('error',()=>finish(true));
    request.once('connect',()=>{
      try{custody();}catch{return finish(true);}
      client.call('getVersion',{},(error,version)=>{
        if(error||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return finish(true);
        client.call('getMonitorData',{},(error,rows)=>{
          if(error)return finish(true);
          try {const selected=project(rows,config.expected);custody();finish(false,{version,selected});}
          catch{finish(true);}
        });
      });
    });
    request.connect(config.socket);
  });
}
module.exports={project,collect,key};
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
