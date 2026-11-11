import {test} from 'node:test';import assert from 'node:assert/strict';
import {crearOllamaSlmAdapter} from '../../src/adapters/outbound/llm/ollamaSlmAdapter.js';
const tick=()=>new Promise(r=>setImmediate(r));
for(const settlement of ['resolve','reject'])test(`timeout preserves admission until real ${settlement}, no late answer or overlap`,async()=>{
 let active=0,peak=0,calls=0,settle;
 const cliente={chat(){calls++;active++;peak=Math.max(peak,active);if(calls===1)return new Promise((resolve,reject)=>{settle=()=>{active--;settlement==='resolve'?resolve({message:{content:'late'}}):reject(new Error('late failure'));};});active--;return Promise.resolve({message:{content:'second'}});}};
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:10,cliente});
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);
 const second=p.chatCompletion({});await tick();assert.equal(calls,1);assert.equal(active,1);
 settle();assert.equal((await second).message.content,'second');assert.equal(calls,2);assert.equal(peak,1);
});
test('shared serializador holds actual request, not timeout wrapper',async()=>{
 let tail=Promise.resolve(),held=false,settle;
 const serializador=fn=>{const task=tail.then(async()=>{held=true;try{return await fn();}finally{held=false;}});tail=task.catch(()=>{});return task;};
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:10,serializador,cliente:{chat:()=>new Promise(r=>{settle=()=>r({message:{content:'late'}});})}});
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);assert.equal(held,true);settle();await tail;assert.equal(held,false);
});
test('immediate SDK rejection releases admission and next explicit call works',async()=>{
 let calls=0;const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:100,cliente:{chat(){if(++calls===1)throw new Error('sdk failure');return {message:{content:'next'}};}}});
 await assert.rejects(p.chatCompletion({}),/sdk failure/);assert.equal((await p.chatCompletion({})).message.content,'next');assert.equal(calls,2);
});
for (const settlement of ['resolve','reject']) test(`queued deadline rejects without later SDK execution after ${settlement}`,async()=>{
 let calls=0,settle;
 const cliente={chat(){calls++;return new Promise((resolve,reject)=>{settle=()=>settlement==='resolve'?resolve({message:{content:'late'}}):reject(new Error('late'));});}};
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:20,cliente});
 const first=p.chatCompletion({});
 const second=p.chatCompletion({});
 await Promise.all([assert.rejects(first,/agoto su tiempo/),assert.rejects(second,/agoto su tiempo/)]);
 assert.equal(calls,1);settle();await tick();await tick();assert.equal(calls,1);
});
test('independent queued callers expire while active request stays pending; no overlap',async()=>{
 let calls=0,active=0,peak=0,finish;
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:15,cliente:{chat(){calls++;active++;peak=Math.max(peak,active);return new Promise(r=>{finish=()=>{active--;r({message:{content:'late'}});};});}}});
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);
 assert.equal(calls,1);assert.equal(active,1);assert.equal(peak,1);
 finish();await tick();await tick();assert.equal(calls,1);assert.equal(active,0);
});
test('queue wait and generation share one caller deadline',async()=>{
 let settle,calls=0;
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:60,cliente:{chat(){calls++;return calls===1?new Promise(r=>{settle=()=>r({message:{content:'first'}});}):new Promise(r=>setTimeout(()=>r({message:{content:'second'}}),45));}}});
 const first=p.chatCompletion({});const second=p.chatCompletion({});
 setTimeout(()=>settle(),35);assert.equal((await first).message.content,'first');
 await assert.rejects(second,/agoto su tiempo/);assert.equal(calls,2);
 await new Promise(r=>setTimeout(r,50));
});
test('expired caller is not submitted to an injected serializer later',async()=>{
 let run,calls=0;
 const p=crearOllamaSlmAdapter({modelo:'synthetic',timeoutMs:10,serializador:fn=>new Promise((resolve,reject)=>{run=()=>Promise.resolve().then(fn).then(resolve,reject);}),cliente:{chat(){calls++;return {message:{content:'bad'}};}}});
 await assert.rejects(p.chatCompletion({}),/agoto su tiempo/);await run();await tick();assert.equal(calls,0);
});
