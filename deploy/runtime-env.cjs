// Private, per-service activation config. Contains credentials on the host only.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const KEYS={
 'jarvis-api':new Set(['API_TOKEN','DAVIS_API_HOST','DAVIS_PERSISTENCE','DAVIS_SQLITE_PATH']),
 'jarvis-whatsapp':new Set(['DAVIS_ASYNC_PIPELINE','DAVIS_QUEUE','DAVIS_REDIS_URL','DAVIS_ERS_PIPELINE_DB','DAVIS_PERSISTENCE','DAVIS_SQLITE_PATH'])
};
function cargarEntornoRuntime({file=process.env.DAVIS_RUNTIME_CONFIG||path.join(os.homedir(),'jarvis-estado','secrets','runtime-env.json'),required=process.env.DAVIS_RUNTIME_CONFIG_REQUIRED==='1'||fs.existsSync(path.join(path.dirname(file),'runtime-env.required'))}={}){
 if(!fs.existsSync(file)){if(required)throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_REQUIRED');return{};}
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_PERMISSIONS');
 if(process.platform!=='win32'){
  if((stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_PERMISSIONS');
 }
 let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_FORMAT');}
 if(!value||value.schema!==1||!value.apps||Object.keys(value).sort().join(',')!=='apps,schema'||Object.keys(value.apps).sort().join(',')!=='jarvis-api,jarvis-whatsapp')throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_SCHEMA');
 const result={};for(const [name,env] of Object.entries(value.apps)){
  if(!env||typeof env!=='object'||Array.isArray(env)||Object.keys(env).some(k=>!KEYS[name].has(k)||typeof env[k]!=='string'||env[k].includes('\n')))throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_ENV');
  result[name]={...env};
 }
 const a=result['jarvis-api'],w=result['jarvis-whatsapp'];
 if(a.DAVIS_API_HOST!=='127.0.0.1'||!a.API_TOKEN||w.DAVIS_QUEUE!=='redis'||w.DAVIS_ASYNC_PIPELINE!=='1'||!w.DAVIS_REDIS_URL||a.DAVIS_PERSISTENCE!=='sqlite'||w.DAVIS_PERSISTENCE!=='sqlite'||!path.isAbsolute(a.DAVIS_SQLITE_PATH||'')||w.DAVIS_SQLITE_PATH!==a.DAVIS_SQLITE_PATH||w.DAVIS_ERS_PIPELINE_DB!==a.DAVIS_SQLITE_PATH)throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_CONTRACT');
 let url;try{url=new URL(w.DAVIS_REDIS_URL);}catch{throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_REDIS');}
 if(url.protocol!=='redis:'||url.hostname!=='127.0.0.1'||!url.username||!url.password||url.search||url.hash||(url.pathname&&url.pathname!=='/'))throw new Error('DAVIS_PRIVATE_RUNTIME_CONFIG_REDIS');
 return result;
}
module.exports={cargarEntornoRuntime};
