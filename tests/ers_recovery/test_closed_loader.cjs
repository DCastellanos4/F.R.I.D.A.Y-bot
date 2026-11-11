'use strict';
const assert=require('node:assert'),crypto=require('node:crypto'),fs=require('node:fs');
const {closedLoader}=require('../../deploy/ers_recovery/closed_loader.cjs');
const root='/usr/lib/node_modules/pm2',file='modules/a.js',child='modules/b.js';
const originals={};for(const key of ['lstatSync','fstatSync','realpathSync','openSync','closeSync','readFileSync'])originals[key]=fs[key];
let probes=0;
function test(name,fn){try{fn();probes++;}catch(e){console.error(name);throw e;}}
function fixture(sources,override={},requires={}){
 const manifest={schema:1,root,files:{}};let reads=0,closed=0;
 for(const [rel,source] of Object.entries(sources))manifest.files[rel]={sha256:crypto.createHash('sha256').update(source).digest('hex'),requires:requires[rel]||{}};
 const data=Object.fromEntries(Object.entries(sources).map(([rel,s])=>[root+'/'+rel,Buffer.from(s)]));
 function stat(p){const b=data[p];return {uid:0,nlink:1,mode:b?0o644:0o755,size:b?.length||0,dev:1,ino:1,mtimeMs:0,ctimeMs:0,isFile:()=>!!b,isDirectory:()=>!b,isSymbolicLink:()=>false,...override};}
 fs.lstatSync=stat;fs.fstatSync=stat;fs.realpathSync=p=>p;fs.openSync=p=>p;fs.closeSync=()=>closed++;
 fs.readFileSync=p=>{reads++;return data[p];};
 return {manifest,reads:()=>reads,closed:()=>closed};
}
try{
 test('closed local cache, relative graph',()=>{
  const f=fixture({[file]:"module.exports=require('./b')",[child]:"module.exports={value:7}"},{},{[file]:{'./b':child}});
  const loader=closedLoader(f.manifest);assert.equal(f.reads(),2);assert.equal(f.closed(),2);
  assert.equal(loader.load(file).value,7);assert.strictEqual(loader.load(file),loader.load(child));
 });
 test('unlisted require cannot use native fallback',()=>{
  const f=fixture({[file]:"module.exports=require('node:child_process')"});
  assert.throws(()=>closedLoader(f.manifest).load(file),/CLOSURE_UNVERIFIABLE/);
 });
 test('allowed builtin graph works',()=>{
  const f=fixture({[file]:"module.exports=require('util').format('%s', 'ok')"},{},{[file]:{'util':'node:util'}});
  assert.equal(closedLoader(f.manifest).load(file),'ok');
 });
 test('native require cache cannot substitute pinned module',()=>{
  const f=fixture({[file]:'module.exports={private:1}'});const key=root+'/'+file;
  require.cache[key]={exports:{private:99}};
  try{assert.equal(closedLoader(f.manifest).load(file).private,1);}finally{delete require.cache[key];}
 });
 test('separate loaders have separate caches',()=>{
  const f=fixture({[file]:'module.exports={value:1}'});const a=closedLoader(f.manifest),b=closedLoader(f.manifest);
  a.load(file).value=9;assert.equal(b.load(file).value,1);
 });
 test('bad pin blocks before first compile',()=>{
  const f=fixture({[file]:"throw Error('SHOULD_NOT_EXECUTE')",[child]:'module.exports=1'});f.manifest.files[child].sha256='0'.repeat(64);
  assert.throws(()=>closedLoader(f.manifest),/CLOSURE_UNVERIFIABLE/);assert.equal(f.closed(),2);
 });
 for(const override of [{uid:42420},{mode:0o666},{nlink:2},{isSymbolicLink:()=>true}]){
  test('custody rejection '+JSON.stringify(override),()=>{const f=fixture({[file]:'module.exports=1'},override);assert.throws(()=>closedLoader(f.manifest),/CLOSURE_UNVERIFIABLE/);});
 }
 test('path escape rejected',()=>{const f=fixture({'../bad.js':'module.exports=1'});assert.throws(()=>closedLoader(f.manifest),/CLOSURE_UNVERIFIABLE/);});
 test('bad edge rejected before reads',()=>{const f=fixture({[file]:'module.exports=1'},{},{[file]:{'x':'outside.js'}});assert.throws(()=>closedLoader(f.manifest),/CLOSURE_UNVERIFIABLE/);assert.equal(f.reads(),0);});
 test('optional null only explicit known debug edge',()=>{const f=fixture({[file]:'module.exports=1'},{},{[file]:{'x':null}});assert.throws(()=>closedLoader(f.manifest),/CLOSURE_UNVERIFIABLE/);});
 test('explicit optional disabled before native lookup',()=>{
  const name='node_modules/debug/src/node.js';const f=fixture({[name]:"try{require('supports-color')}catch(e){module.exports=e.code}"},{},{[name]:{'supports-color':null}});
  assert.equal(closedLoader(f.manifest).load(name),'MODULE_NOT_FOUND');
 });
}finally{Object.assign(fs,originals);}
console.log(probes+' closed-loader probes PASS (synthetic metadata; no HOST/PM2 RPC)');
