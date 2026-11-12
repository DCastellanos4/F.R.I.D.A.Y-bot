import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyApiHealth}=require('../../deploy/api-health.cjs');
async function withServer(handler,run){
 const server=http.createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {await run(server.address().port);} finally {await new Promise(resolve=>server.close(resolve));}
}
test('private-token health requires authenticated200 ok and unauthenticated/wrong401',async()=>{
 const seen=[];
 await withServer((req,res)=>{
  seen.push(req.headers.authorization||'absent');
  const valid=req.headers.authorization==='Bearer SYNTHETIC_TOKEN';
  res.statusCode=valid?200:401;res.end(JSON.stringify(valid?{ok:true}:{error:'no'}));
 },async port=>assert.match(await verifyApiHealth({port,token:'SYNTHETIC_TOKEN'}),/authenticated200/));
 assert.equal(seen.length,3);assert.equal(seen[1],'absent');assert.notEqual(seen[2],seen[0]);
});
test('200 without auth, bad valid-token status, wrong token accepted, or okfalse fail closed',async()=>{
 for(const mode of ['public','valid503','wrong200','okfalse']){
  await withServer((req,res)=>{
   const header=req.headers.authorization;const valid=header==='Bearer SYNTHETIC_TOKEN';
   res.statusCode=mode==='public'?200:valid?(mode==='valid503'?503:200):(mode==='wrong200'&&header?200:401);
   res.end(JSON.stringify({ok:mode!=='okfalse'}));
  },async port=>assert.rejects(verifyApiHealth({port,token:'SYNTHETIC_TOKEN'}),/API_HEALTH_AUTH_CONTRACT/));
 }
});
test('legacy unconfigured API requires disabled503, never public200 or unexpectedbody',async()=>{
 await withServer((req,res)=>{res.statusCode=503;res.end(JSON.stringify({error:'API REST deshabilitada: define API_TOKEN en el entorno para habilitarla.'}));},async port=>assert.match(await verifyApiHealth({port}),/disabled503/));
 await withServer((req,res)=>{res.statusCode=200;res.end(JSON.stringify({ok:true}));},async port=>assert.rejects(verifyApiHealth({port}),/API_HEALTH_DISABLED_CONTRACT/));
});
