import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarSelectorCola,crearPipelineAsincrono} from '../../src/composition/asyncPipeline.js';
import {crearContenedor} from '../../src/composition/container.js';
function withEnv(value,fn){const prev=process.env.DAVIS_QUEUE;try{if(value===undefined)delete process.env.DAVIS_QUEUE;else process.env.DAVIS_QUEUE=value;return fn();}finally{if(prev===undefined)delete process.env.DAVIS_QUEUE;else process.env.DAVIS_QUEUE=prev;}}
test('only unset and exact sqlite selector are supported',()=>{withEnv(undefined,()=>assert.equal(validarSelectorCola(),'sqlite'));assert.equal(validarSelectorCola('sqlite'),'sqlite');assert.equal(validarSelectorCola('redis'),'redis');});
for(const value of ['','Redis',' sqlite','sqlite ','unknown'])test(`unsupported selector ${JSON.stringify(value)} fails before SQL/worker use`,()=>withEnv(value,()=>{let touches=0;const db={prepare(){touches++;throw new Error('must not reach SQL');}};assert.throws(()=>crearPipelineAsincrono({db,procesar:()=>{},cola:{publicar(){touches++;},consumir(){touches++;},cerrar(){}}}),/RF01_QUEUE_SELECTOR_UNSUPPORTED/);assert.equal(touches,0);}));
test('container rejects unsupported selector before provider getter, persistence or override pipeline',()=>withEnv('Redis',()=>{let touches=0;const overrides={get llmProvider(){touches++;throw new Error('must not construct provider');},pipelineAsincrono:{iniciar(){touches++;}}};assert.throws(()=>crearContenedor(overrides),/RF01_QUEUE_SELECTOR_UNSUPPORTED/);assert.equal(touches,0);}));
test('default selector keeps existing injected pipeline path available',()=>withEnv(undefined,()=>{const p={recibir(){return 'fake';},registrarCanal(){},iniciar(){}};const c=crearContenedor({memoryRepository:null,pipelineAsincrono:p});assert.equal(c.pipelineAsincrono,p);}));

test('redis selector cannot silently accept direct injected queue without claim bridge',()=>assert.throws(()=>crearPipelineAsincrono({selectorCola:'redis',cola:{},db:{}}),/RF01_REDIS_REQUIRES_CLAIM_BRIDGE/));
