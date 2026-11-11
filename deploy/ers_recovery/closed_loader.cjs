'use strict';
// Not a sandbox. Execute only the pre-reviewed fixed source graph after all
// bytes and custody checks pass. No native resolver or global require cache.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Module=require('node:module');
const FIXED_ROOT='/usr/lib/node_modules/pm2';
const BUILTINS=new Set(['node:events','node:net','node:fs','node:stream','node:tty','node:util']);
function fail(){throw Error('CLOSURE_UNVERIFIABLE');}
function checkDir(p){
 const s=fs.lstatSync(p);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||fs.realpathSync(p)!==p)fail();
}
function readPinned(p,sha){
 let fd;
 try{
  fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const s=fs.fstatSync(fd),a=fs.lstatSync(p);
  if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>262144||a.dev!==s.dev||a.ino!==s.ino||fs.realpathSync(p)!==p)fail();
  const b=fs.readFileSync(fd),z=fs.fstatSync(fd),q=fs.lstatSync(p);
  if(b.length!==s.size||z.size!==s.size||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs||z.ino!==q.ino||z.dev!==q.dev||crypto.createHash('sha256').update(b).digest('hex')!==sha)fail();
  return b.toString('utf8');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function closedLoader(manifest){
 if(!manifest||manifest.schema!==1||manifest.root!==FIXED_ROOT||!manifest.files||Object.keys(manifest.files).length>64)fail();
 const sources=new Map(),edges=new Map(),dirs=new Set(['/']);
 // Copy and validate every edge before reading/compiling any external module.
 for(const [rel,spec] of Object.entries(manifest.files)){
  if(typeof rel!=='string'||rel.startsWith('/')||rel.split('/').some(x=>!x||x==='.'||x==='..')||!rel.endsWith('.js')||!spec||!/^[a-f0-9]{64}$/.test(spec.sha256)||!spec.requires)fail();
  const graph=new Map();
  for(const [request,target] of Object.entries(spec.requires)){
   if(typeof request!=='string'||!(target===null||BUILTINS.has(target)||Object.hasOwn(manifest.files,target)))fail();
   if(target===null&&!(rel==='node_modules/debug/src/node.js'&&request==='supports-color'))fail();
   graph.set(request,target);
  }
  edges.set(rel,graph);
  let d=path.dirname(path.join(FIXED_ROOT,rel));
  while(d!=='/'){dirs.add(d);d=path.dirname(d);}
 }
 for(const d of dirs)checkDir(d);
 for(const [rel,spec] of Object.entries(manifest.files))sources.set(rel,readPinned(path.join(FIXED_ROOT,rel),spec.sha256));
 // Resolve all builtins before the first external load; these have no mutable
 // package path. No Module._load/resolveFilename interception or cache edits.
 const builtinModules=new Map([...BUILTINS].map(id=>[id,require(id)]));
 const cache=new Map();
 function load(rel){
  if(!sources.has(rel))fail();
  if(cache.has(rel))return cache.get(rel).exports;
  const filename=path.join(FIXED_ROOT,rel),m=new Module(filename);
  m.filename=filename;m.paths=[];
  m.require=function(request){
   const graph=edges.get(rel);
   if(!graph.has(request))fail();
   const target=graph.get(request);
   if(target===null){const e=Error('OPTIONAL_MODULE_DISABLED');e.code='MODULE_NOT_FOUND';throw e;}
   if(builtinModules.has(target))return builtinModules.get(target);
   return load(target);
  };
  cache.set(rel,m);
  try{m._compile(sources.get(rel),filename);m.loaded=true;return m.exports;}
  catch(e){cache.delete(rel);throw e;}
 }
 return Object.freeze({load});
}
module.exports={closedLoader};
